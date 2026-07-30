# Cleared Site Data → App Unresponsive / Throws Errors — Diagnosis & Fix Planner

> Symptom: After clearing site data (cookies / localStorage / IndexedDB), the app becomes
> unresponsive and throws errors. Expected: it should silently re-fetch from Firebase,
> repopulate IndexedDB, and keep working.

---

## 1. Root cause

The app treats **`localStorage['userProfile']`** as a source of truth for the current user's `uid`,
but that key is **only written on an explicit login/signup** — never on **session restore** and never
**re-hydrated** when it goes missing. Firebase Auth itself restores the session (its persistence lives in
IndexedDB), so after a clear the user can still be authenticated **while `userProfile` is gone**.

Two concrete failure points:

### 1a. `AccountsService.requireUid()` reads localStorage (the outlier) — PRIMARY
[accounts.service.ts:385](src/features/accounts/accounts.service.ts#L385) was the **only** service that
resolved the uid from `localStorage['userProfile']`:
```ts
private requireUid(): string {
  const userProfile = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
  if (!userProfile) throw new Error('You must be signed in to manage accounts.');  // ← throws after clear
  return userProfile['uid'] as string;
}
```
Every other service (`goals`, `groups`, `budgets`, `categories`, `transactions`, …) already resolves the
uid from `this.auth.currentUser?.uid` — the authoritative, in-memory Firebase value that survives as long as
the session is valid. So `AccountsService` alone throws when `userProfile` is cleared but the session is intact,
and since account context drives the dashboard and most feature reads, the whole app looks "unresponsive."

### 1b. `userProfile` is never re-hydrated on session restore — SECONDARY
[auth.service.ts:253](src/core/auth/auth.service.ts#L253) `setUserProfile()` only runs after an explicit
login. On a normal reload (or after a clear) the `user$` restore emission repopulates notifications/FCM but
**not** the cached profile. Components and guards that read `userProfile` for `isOnboarded`, `displayName`,
`currency`, etc. then see `null`.

### Why data itself recovers automatically
The read path is already resilient: [offline-crud.service.ts fetchAll](src/core/offline/offline-crud.service.ts#L50)
is cache-first and, on an **empty cache + online**, fetches from Firestore and repopulates IndexedDB. So once the
`uid` is available again, accounts/transactions/budgets/etc. reappear on their own. The gap was purely the
**uid/profile resolution**, not the data fetch.

---

## 2. Fix plan

### Fix A — Resolve uid from Firebase Auth in `AccountsService` (matches every other service)
Change [accounts.service.ts requireUid](src/features/accounts/accounts.service.ts#L385) to use
`this.auth.currentUser?.uid` (already injected at line 53) instead of localStorage. Eliminates the throw
whenever the session is valid, with no dependency on cached data.

### Fix B — Re-hydrate `userProfile` from Firestore whenever it's missing/stale
In [auth.service.ts](src/core/auth/auth.service.ts), on **every** authenticated `user$` emission (login **and**
restore), ensure `localStorage['userProfile']` exists and matches the signed-in uid; if not, fetch `users/{uid}`
from Firestore and cache it. This is the "take data from Firebase and store it again" behavior for the profile
object, and it feeds the `userProfile` signal so the UI stays populated. Offline/transient fetch failures are
swallowed so any existing cached copy is preserved.

### What we deliberately do NOT change
- The offline-first data layer already re-fetches + repopulates IndexedDB (see §1). No change needed.
- Guards already use `onAuthStateChanged` when online, so they wait for real auth state rather than trusting
  stale localStorage.

---

## 3. Behavior after the fix

| Scenario                                             | Before                          | After                                                  |
|------------------------------------------------------|---------------------------------|--------------------------------------------------------|
| Clear localStorage only, session intact              | AccountsService throws → dead   | uid from Auth; profile re-fetched; data reloads        |
| Clear IndexedDB (incl. Firebase auth persistence)    | Errors / unresponsive           | Session gone → guards route to `/login` (graceful)     |
| Clear everything, then re-login                      | Worked, but no restore recovery | Works; profile also re-hydrates on later restores      |
| Normal reload of a returning user                    | userProfile could be stale/absent | Profile re-hydrated from Firestore on restore        |

---

---

## 3b. Follow-up: IndexedDB errors crashed pages (added after redeploy)

After redeploying Fixes A & B, the symptom changed to a **thrown IndexedDB error** ("can't see data
after login; other pages error"). Cause: the cache layer **propagated IndexedDB failures** instead of
degrading. In [offline-crud.service.ts fetchAll](src/core/offline/offline-crud.service.ts#L55) the very
first line — `readFromCache()` — runs **outside** the try/catch, so any IndexedDB rejection (cleared DB,
interrupted schema upgrade, quota/private-mode, blocked/corrupt DB, or an observable that completes without
emitting → RxJS `EmptyError`) bubbled up and killed the page. Every feature read starts there, so *every*
page broke.

### Fix C — Make `IndexedDbCacheService` fault-tolerant (single choke point)
All IndexedDB access funnels through [indexed-db-cache.service.ts](src/core/offline/indexed-db-cache.service.ts)
(verified: nothing calls `NgxIndexedDBService` directly). It now:
- **Reads** (`getAll`/`getAllByIndex`/`getByKey`) catch errors and return empty/`undefined` → treated upstream
  as a **cache miss**, which triggers the existing Firestore fetch + cache repopulation.
- **Writes** (`put`/`putAll`/`delete`/`clear`) are best-effort: failures are `console.warn`-logged and swallowed
  so optimistic UI and the sync queue keep working.

Result: a broken/empty IndexedDB can no longer throw. The app pulls from Firebase and shows data; when the DB
is healthy again, writes repopulate it.

> **Note on the underlying DB error:** the app now *survives* it, but offline caching stays degraded until the
> DB itself is healthy. The new `console.warn("IndexedDbCacheService: … failed …")` lines reveal the real cause
> (commonly `VersionError` from a previously-installed higher DB version, or a blocked upgrade with another tab
> open). If offline caching must be fully restored, bump `version` in
> [indexed-db.config.ts](src/core/offline/indexed-db.config.ts) or delete the `FinTrackrDB` database once.
> A possible future hardening: add a short timeout to each op to also cover the rare *blocked* (hangs, never
> rejects) case.

## 4. Verification checklist

- [ ] Log in, then DevTools → Application → Local Storage → delete `userProfile` only → reload ⇒ dashboard loads,
      accounts/transactions visible (re-fetched), no thrown errors.
- [ ] DevTools → Application → Clear site data (everything) → reload ⇒ redirected to `/login` cleanly (no error spam).
- [ ] After re-login, IndexedDB `FinTrackrDB` stores repopulate from Firestore.
- [ ] `localStorage['userProfile']` reappears automatically after a missing-profile reload while signed in.
