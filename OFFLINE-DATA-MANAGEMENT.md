# Offline CRUD & Data Management

## Architecture Overview

FinTrackr implements a **custom offline-first data layer** built on top of IndexedDB (`ngx-indexed-db`) instead of relying on Firestore's built-in offline persistence. The system follows a **cache-first with background revalidation** (stale-while-revalidate) strategy and uses an **optimistic UI** pattern where all writes land in IndexedDB immediately, and sync to Firestore when connectivity is available.

```
UI Component
     |
Feature Service (TransactionsService, AccountsService, etc.)
     |
OfflineCrudService  ← cache-first orchestrator
     |
     +-- READ:  IndexedDbCacheService → return cached → background revalidate via Firestore
     +-- WRITE: IndexedDbCacheService (optimistic) → Firestore (if online) → SyncQueueService (if offline/failed)
     |
SyncService  ← auto-triggered on reconnect
     |
     +-- consolidateQueue() → process each entry → Feature Service applyPending* → Firestore
     |
RevalidationTrackerService  ← TTL-based freshness
     |
IndexedDbRecoveryService  ← self-healing structural faults
```

---

## Proposed Fast CRUD Flow

**Goal:** User should never wait for a server round-trip. The loader only covers the IndexedDB write (~2-5ms), not the Firestore write (~200-800ms).

### The Flow

```
User Action (create / update / delete)
     |
     ▼
┌─────────────────────────┐
│  1. START LOADER         │
└─────────────────────────┘
     |
     ▼
┌─────────────────────────┐
│  2. WRITE TO IndexedDB   │  ← ~2-5ms (local disk)
│     (optimistic entry)   │
└─────────────────────────┘
     |
     ▼
┌─────────────────────────┐
│  3. RETURN RESPONSE      │  ← User sees success immediately
│     + notify user        │
│     (success toast)      │
└─────────────────────────┘
     |
     ▼
┌─────────────────────────┐
│  4. STOP LOADER          │  ← Total visible wait: ~5-10ms
└─────────────────────────┘
     |
     ▼
┌─────────────────────────────────────────────────────────┐
│  5. BACKGROUND SYNC (fire-and-forget)                    │
│     → Subscribe to Firestore write, don't await it       │
│     → If online: sync immediately in background          │
│     → If offline: already in IndexedDB, nothing to do    │
│                                                          │
│  6. ON SYNC FAILURE → silent enqueue to sync queue       │
│     → No toast per failure (noisy for the user)          │
│     → Queue picks it up on next connectivity event       │
│     → Only notify if retries exhausted (MAX_RETRIES)     │
└─────────────────────────────────────────────────────────┘
```

### Is This Possible? Yes.

The architecture already supports this pattern partially. Here is exactly what exists vs what needs to change:

### Current State vs Proposed

| Aspect | Current State | Proposed State | Status |
|---|---|---|---|
| **CREATE (transactions, recurring, group-expenses)** | Uses `syncRemoteInBackground: true` — fire-and-forget Firestore write | No change needed | DONE |
| **CREATE (accounts, budgets, budgetPlans, categories, goals, groups, reports)** | **Blocks on Firestore** — `await firestoreFn(assignedId)` when online | Switch to background sync (remove the blocking path, always fire-and-forget) | PENDING |
| **UPDATE (all entities)** | **Blocks on Firestore** — `await firestoreFn()` when online | Add `syncRemoteUpdate` background path, same pattern as `syncRemoteCreate` | PENDING |
| **DELETE (all entities)** | **Blocks on Firestore** — `await firestoreFn()` when online | Add `syncRemoteDelete` background path | PENDING |
| **Loader scope** | Loader wraps the entire operation including Firestore wait | Loader wraps only the IndexedDB write (~5ms) | PENDING |
| **Per-action offline toast** | Shows "Saved locally. Will sync when connected." on every queued action | Remove per-action toast. Only notify on permanent failure (after MAX_RETRIES) | PENDING |
| **READ (cache hit)** | Returns cache instantly, revalidates in background | No change needed | DONE |
| **READ (cache miss + online)** | Blocks on Firestore (first-ever load) | Keep blocking — no local data to return, must wait | DONE (correct) |
| **READ (cache miss + offline)** | Returns empty array | No change needed | DONE |
| **Sync on reconnect** | Auto-triggered via `effect()` watching `isOnline` + `pendingSyncCount` | No change needed | DONE |
| **Queue consolidation** | Collapses redundant ops before flushing | No change needed | DONE |
| **Crash recovery** | Resets `in-progress` entries to `pending` on startup | No change needed | DONE |

### What Changes in OfflineCrudService

#### CREATE — make background sync the default

The `syncRemoteInBackground` flag already implements the exact pattern. The change is to make it the **default behavior** instead of opt-in:

```typescript
// CURRENT: blocks on Firestore when online (most creates)
try {
  const result = await firestoreFn(assignedId);        // ← 200-800ms wait
  const merged = { ...(result as object), _pendingSync: false } as unknown as T;
  await this.cache.put(storeName, merged);
  return merged;
} catch {
  await enqueuePending();
  return optimistic;
}

// PROPOSED: always fire-and-forget (already exists as syncRemoteCreate)
void this.syncRemoteCreate(storeName, assignedId, firestoreFn, enqueuePending);
return optimistic;  // ← returns immediately after IndexedDB write
```

**The `syncRemoteCreate` private method already exists** at line 303 of `offline-crud.service.ts`. It does exactly the right thing: attempts Firestore write in background, falls back to sync queue on failure.

#### UPDATE — add background sync path (new)

Currently `update()` has no background sync option. Add the same fire-and-forget pattern:

```typescript
// PROPOSED: new private method
private syncRemoteUpdate(
  storeName: string,
  firestoreFn: () => Promise<void>,
  enqueuePending: () => Promise<void>,
): void {
  void (async () => {
    try {
      await firestoreFn();
    } catch {
      await enqueuePending();
    }
  })();
}

// In update(), replace the blocking path:
// OLD:
//   try { await firestoreFn(); ... } catch { await enqueuePending(); }
// NEW:
void this.syncRemoteUpdate(storeName, firestoreFn, enqueuePending);
return updated;
```

#### DELETE — add background sync path (new)

Same pattern for `remove()`:

```typescript
// PROPOSED: new private method
private syncRemoteDelete(
  storeName: string,
  firestoreFn: () => Promise<void>,
  enqueuePending: () => Promise<void>,
): void {
  void (async () => {
    try {
      await firestoreFn();
    } catch {
      await enqueuePending();
    }
  })();
}

// In remove(), replace the blocking path:
void this.syncRemoteDelete(storeName, firestoreFn, enqueuePending);
return; // ← immediate return after IndexedDB delete
```

#### Remove noisy per-action toasts

In `enqueuePending` lambdas across create/update/remove, the `notifier.show('Saved locally...')` fires on **every** queued action. This is unnecessary noise — the user already got a success response from the IndexedDB write. Only notify when something actually fails permanently:

```typescript
// REMOVE from all enqueuePending lambdas:
this.notifier.show('Saved locally. Will sync when connected.', NotifierSeverity.WARNING);

// KEEP only in SyncService when MAX_RETRIES exhausted:
this.notifier.error(`${failCount} change(s) failed to sync. Check your data.`);
```

### What Changes in Feature Pages

The `saving` signal in feature pages currently wraps the entire operation including Firestore. After the change, it wraps only IndexedDB:

```typescript
// CURRENT (e.g. new-budget.ts):
this.saving.set(true);
try {
  await this.budgetsService.upsertBudgetPlan({...});  // ← waits for Firestore
  await this.reportsService.rebuildCurrentAndFutureReports();
  this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
} finally {
  this.saving.set(false);  // ← stops after ~500-1000ms
}

// PROPOSED: same code, but budgetsService.upsertBudgetPlan now returns
// after IndexedDB write (~5ms), Firestore syncs in background.
// The saving signal is true for ~5-10ms — effectively invisible to the user.
// Navigation happens instantly.
```

### When to Still Wait for Firestore

There are cases where blocking on the server response is correct:

| Scenario | Why wait | Current handling |
|---|---|---|
| **First-ever data load** (empty cache) | No local data to return — must fetch from server | `fetchAll` already blocks here. Correct. |
| **Account creation with server-side validation** | Server checks for duplicates, generates derived fields | Consider keeping blocking for accounts specifically, or validate client-side first |
| **Operations that need server-generated values** | E.g. a Cloud Function that computes balances after a group expense | Already handled via `postSyncCallables` — runs after background sync |

---

## How It Works (Current Implementation)

### 1. Network Detection

**File:** `src/core/offline/network.service.ts`

- Uses `navigator.onLine` for initial state, then listens to `window` `online`/`offline` events.
- Exposes two Angular signals:
  - `isOnline()` — reactive boolean, SSR-safe (defaults to `true` when `navigator` is undefined).
  - `pendingSyncCount()` — number of queued sync entries; updated by `SyncQueueService`.
- On going offline, shows a warning toast. On reconnect, shows a success toast.
- Both event handlers run inside `NgZone.run()` to trigger Angular change detection.

The UI in `src/features/features.html` shows:
- An **amber banner** when offline, with a badge showing pending sync count.
- A **rose banner** when sync entries have permanently failed, with Retry All / Discard / Details actions.

---

### 2. Local Storage Layer (IndexedDB)

**Config:** `src/core/offline/indexed-db.config.ts`
**Wrapper:** `src/core/offline/indexed-db-cache.service.ts`

Database: `FinTrackrDB`, version `7`, with **14 object stores**:

| Store | keyPath | Notable Indexes |
|---|---|---|
| `accounts` | `id` | `ownerId`, `updatedAt` |
| `transactions` | `uid` | `accountId`, `type`, `category`, `createdAt` |
| `recurring-transactions` | `uid` | `accountId`, `transactionId` |
| `budgets` | `id` | `ownerId`, `accountId`, `month` |
| `budgetPlans` | `id` | `ownerId`, `accountId` |
| `goals` | `id` | `ownerId`, `accountId` |
| `categories` | `uid` | `accountId`, `name` |
| `sync-queue` | `id` | `storeName`, `operation`, `timestamp`, `status` |
| `sync-metadata` | `key` | _(none)_ |
| `monthly-reports` | `uid` | `accountId`, `month` |
| `notifications` | `id` | `receiverId`, `accountId`, `status`, `createdAt` |
| `groups` | `id` | `viewerUid`, `creatorId` |
| `group-expenses` | `id` | `groupId`, `date` |
| `group-settlements` | `id` | `groupId` |

#### Fault Tolerance

`IndexedDbCacheService` is designed to **never crash** the app:
- **Reads** degrade to empty results (cache miss) — upstream falls back to Firestore.
- **Writes** are best-effort — failures are logged and swallowed.
- **Structural faults** (wrong DB version, missing stores) are delegated to `IndexedDbRecoveryService` for self-healing.

#### Date Serialization

Handles `Date` objects and Firestore `Timestamp.toDate()` conversion for these fields:
`createdAt`, `updatedAt`, `dueDate`, `lastPaymentDate`, `nextPaymentDate`, `readAt`.
Stores as ISO strings in IndexedDB, converts back to `Date` on read.

---

### 3. CRUD Operations

**File:** `src/core/offline/offline-crud.service.ts`

Every feature service delegates to `OfflineCrudService`. All feature services (transactions, accounts, budgets, categories, goals, groups) use this pattern uniformly.

#### READ — `fetchAll<T>()`, `fetchOne<T>()`, `fetchTransactionsPage()`

```
1. Read IndexedDB cache immediately (optionally filtered by index, e.g. accountId).
2. If cache has data:
   → Return it instantly.
   → Fire-and-forget background revalidation from Firestore
     (only if online AND the cached slice's TTL has expired).
3. If cache is empty:
   → Check sync queue for pending items on this store.
     If yes: return [] (avoid reading stale server data).
   → If queue empty + online: fetch from Firestore (first-ever load), populate cache, return.
   → If queue empty + offline: return [].
```

`fetchTransactionsPage()` is a specialized variant that reads all transactions for an account from IndexedDB by `accountId` index, then applies filters/sort/pagination **in JavaScript** before returning one page.

#### CREATE — `create<T>()`, `createWithPath<T>()`

```
1. Generate a Firestore document ID upfront using doc(collection()).id.
2. Write optimistic record to IndexedDB immediately with _pendingSync: true.
3. If online:
   → Attempt Firestore write.
   → On success: update cache row with _pendingSync: false.
   → On failure: fall through to queue path.
4. If offline (or online-write failed):
   → Enqueue a SyncQueueEntry with operation: 'create' and the pre-assigned ID.
   → Show warning toast: "Saved locally. Will sync when connected."
```

`createWithPath` supports subcollection writes (e.g. `groups/{id}/expenses`) with optional `postSyncCallables` (Cloud Functions to invoke after sync).

The optional `syncRemoteInBackground` flag lets the Firestore write happen fire-and-forget while the optimistic result is returned immediately. Currently used by: transactions, recurring transactions, and group expenses.

#### UPDATE — `update<T>()`

```
1. Merge patch into existing cached doc with _pendingSync: true, write to IndexedDB.
2. If online:
   → Attempt Firestore updateDoc.
   → On success: flip _pendingSync: false.
   → On failure: enqueue.
3. If offline: enqueue with operation: 'update', docId, and the patch payload.
```

#### DELETE — `remove()`

```
1. Delete from IndexedDB immediately.
2. If online:
   → Attempt Firestore deleteDoc.
   → On failure: enqueue.
3. If offline: enqueue with operation: 'delete'.
```

Optional `extraPayload` for subcollection context (e.g. `_groupId`).

---

### 4. Sync Queue

#### Model

**File:** `src/core/offline/sync-queue.model.ts`

```typescript
interface SyncQueueEntry {
  id: string;                        // UUID
  storeName: string;                 // e.g. 'transactions', 'budgets'
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  tempLocalId?: string;              // pre-assigned doc ID for creates
  docId?: string;                    // existing doc ID for updates/deletes
  timestamp: number;                 // Date.now() at enqueue time
  status: 'pending' | 'in-progress' | 'failed';
  retryCount: number;
  errorMessage?: string;
  postSyncCallables?: PostSyncCallable[];  // Cloud Functions to invoke post-sync
}
```

#### Queue Service

**File:** `src/core/offline/sync-queue.service.ts`

- `enqueue`: creates entries with UUID, status `pending`, retryCount 0.
- `getAllPending`: returns entries with status `pending` or `in-progress`, sorted by timestamp (FIFO).
- `markInProgress` / `markFailed` / `incrementRetry`: lifecycle transitions.
- `resetInterruptedEntries`: on app startup, resets any `in-progress` entries back to `pending` (crash recovery).
- `retryFailed` / `discardFailed`: user-facing actions for permanently failed entries.
- `hasPendingForStore`: checks if a store has queued entries (used by `fetchAll` to avoid stale server reads).
- Updates `NetworkService.pendingSyncCount` after every mutation.

#### Queue Consolidation

**File:** `src/core/offline/sync-queue-consolidator.ts`

Before flushing, the queue is **consolidated** to minimize Firestore writes:

| Scenario | Result |
|---|---|
| `create` + `update(s)` | One `create` with updates merged in (`_syncPreassignedId` preserved) |
| `update` + `update(s)` | One `update`, payloads shallow-merged (later wins per field) |
| `update(s)` + `delete` | Just the `delete` |
| `create` + ... + `delete` | **Dropped entirely** (doc never existed server-side) |
| `create` + ... + `delete` (with `postSyncCallables`) | Kept as-is (side effects must run) |

Entries for different documents are never merged. Output preserves timestamp order for cross-store dependency ordering (e.g. account created before its transactions).

---

### 5. Sync Service

**File:** `src/core/offline/sync.service.ts`

The orchestrator that replays queued operations to Firestore.

#### Auto-Trigger

An Angular `effect()` watches `network.isOnline()` and `network.pendingSyncCount()`. When both are positive and no sync is running, `syncAll()` fires automatically.

#### Sync Flow

```
1. Get all pending entries from sync queue.
2. Run consolidateQueue() to collapse redundant ops.
3. Dequeue entries that were fully cancelled by consolidation (create-then-delete chains).
4. Process each consolidated entry sequentially:
   → Mark source entries as in-progress.
   → Route to processCreate / processUpdate / processDelete based on operation.
   → On success: dequeue all source entries, mark store stale for revalidation.
   → On failure: increment retry count.
     After MAX_RETRIES (5): mark as 'failed'.
5. Rebuild monthly reports for affected months (batched — one per distinct month,
   not one per entry).
6. Show success/failure notification.
```

#### Crash Recovery

On construction, calls `syncQueue.resetInterruptedEntries()` to reset any `in-progress` entries back to `pending`. This handles the case where the app crashed or was closed mid-sync.

#### Conflict Resolution

**Last-writer-wins.** No merge or version-checking logic. The sync replays the queued payload to Firestore:
- Creates use `setDoc` with the pre-assigned ID.
- Updates use `updateDoc` with the queued patch.
- Deletes use `deleteDoc` — if doc is "not found", treated as success.

#### Failed Entries

The `failedEntries` signal is surfaced in the UI as a rose-colored warning banner with Retry All / Discard options. Failed entries are never silently lost.

---

### 6. Revalidation & TTL

**File:** `src/core/offline/revalidation-tracker.service.ts`

Controls how often background revalidation fires per store:

| Store | TTL |
|---|---|
| `transactions` | 2 minutes |
| `accounts`, `groups`, `group-expenses`, `group-settlements`, `monthly-reports` | 5 minutes |
| `budgets`, `budgetPlans`, `goals`, `recurring-transactions` | 15 minutes |
| `categories` | 30 minutes |
| Default | 5 minutes |

**Key behaviors:**
- Timestamps are persisted in the `sync-metadata` IndexedDB store (keyed as `reval::{store}::{index}={value}`), so freshness survives page reloads.
- `markStale()` is called after every local mutation, forcing the next read to trigger a background Firestore fetch.
- Doc-level freshness for `fetchOne` is in-memory only (not persisted across reloads).
- All failure modes degrade to "not fresh" (pre-TTL behavior of always revalidating).

---

### 7. Self-Healing & Recovery

**File:** `src/core/offline/indexed-db-recovery.service.ts`

Handles two structural fault classes:
1. **VersionError** — the browser holds `FinTrackrDB` at a version higher than configured (leftover from older/newer deploy).
2. **Missing object stores** — the DB is at the correct version but an expected store is absent (interrupted upgrade / corruption).

**Startup probe:** Runs as an app initializer (`provideAppInitializer` in `app.config.ts`) BEFORE `ngx-indexed-db` opens the database. Inspects the on-disk DB version and object stores. If broken, deletes the database and reloads the page.

**Mid-session recovery:** If `IndexedDbCacheService` encounters a structural fault during an operation, it calls `recover()`, which deletes and reloads — guarded by a **60-second localStorage cooldown** to prevent reload loops.

---

### 8. Service Worker / PWA

**Config:** `ngsw-config.json`, `angular.json` (line 56), `app.config.ts` (lines 64-67)

- Angular's `@angular/service-worker` is enabled in production only, with `registerImmediately` strategy.
- Two asset groups:
  - **`app`** (prefetch): Pre-caches the app shell (HTML, CSS, JS, icons).
  - **`assets`** (lazy): Lazily caches images, fonts, and static assets.
- One data group for Google Fonts (performance strategy, 20 entries, 30-day max age).
- **No Firestore data caching** via service worker `dataGroups` — all data caching is handled by the custom IndexedDB layer.
- Old Firestore API caches are explicitly purged on logout.

---

### 9. Auth Guard Offline Tolerance

**File:** `src/core/guards/auth.guard.ts`

When `getIdToken()` fails (offline), the auth guard still resolves `true` as long as a Firebase Auth user object is present. It does **not** trust `localStorage.userProfile`.

---

### 10. Logout Cleanup

**File:** `src/core/auth/auth.service.ts`

On logout, `syncService.clearAllData()`:
1. Resets the revalidation tracker.
2. Clears session caches in AccountsService and CategoriesService.
3. Clears the sync queue.
4. Clears all 14 IndexedDB stores individually.
5. Purges service worker Firestore caches.

---

## Known Bug: "This page can't be reached" When Opening Offline

### The Problem

If the app is **already open** when the device goes offline, everything works — CRUD operations use IndexedDB, the sync queue collects changes, and the UI stays functional. But if the user **closes the app and re-opens it while offline** (or opens a new tab), the browser shows **"This page can't be reached"** instead of loading the app.

This means the **Service Worker is not serving the app shell offline**. The Angular code, IndexedDB layer, and sync queue are all fine — the problem is the app never gets to boot.

### Root Cause Analysis

After investigating every layer of the offline stack, here are all the issues found, ranked by severity:

#### 1. CRITICAL — Google Fonts `<link rel="stylesheet">` is render-blocking offline

**File:** `src/index.html` (lines 17-20)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=DM+Sans:...&family=Space+Grotesk:...&display=swap"
/>
```

**What happens offline:** The `<link rel="stylesheet">` is **render-blocking**. The browser must download and parse this CSS file before it can render the page. While the `ngsw-config.json` has a `dataGroups` entry for Google Fonts with `strategy: "performance"`, this only caches fonts **after the first successful fetch**. The CSS stylesheet URL (`/css2?family=...`) returns a dynamically-generated response that may not match the cached pattern, and `performance` strategy serves from cache but still tries network first for the CSS file.

**The real killer:** On a completely cold offline start (service worker hasn't cached this specific CSS response yet, or cache expired), the browser **hangs waiting for the font stylesheet** before it even starts parsing the `<body>`. On mobile browsers, this can time out and show "This page can't be reached" if the browser interprets the hanging resource as a network failure for the entire page.

Even when the NGSW serves `index.html` from cache, the browser still tries to fetch the external stylesheet. If the font CSS is not in the NGSW data cache, the browser blocks rendering.

**Fix:**

```html
<!-- Option A (recommended): load fonts non-blocking with swap -->
<link
  rel="preload"
  as="style"
  href="https://fonts.googleapis.com/css2?family=DM+Sans:...&display=swap"
  onload="this.onload=null;this.rel='stylesheet'"
/>
<noscript>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?..." />
</noscript>

<!-- Option B (simplest): just add media="print" with onload swap -->
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=DM+Sans:...&display=swap"
  media="print"
  onload="this.media='all'"
/>
```

This makes the font stylesheet **non-render-blocking** — the page loads and renders with system fonts first, then swaps to custom fonts when/if they load. Offline, the page renders immediately without waiting.

#### 2. HIGH — `index.csr.html` referenced in `ngsw-config.json` but does not exist

**File:** `ngsw-config.json` (line 19)

```json
"files": [
  ...
  "/index.csr.html",   // ← referenced but never generated by the build
  "/index.html",
  ...
]
```

**Verified:** The file does NOT exist in `dist/fintrackr/browser/` and is NOT in the generated `ngsw.json` manifest (Angular silently skips missing files). This is harmless for the prefetch itself (Angular ignores it), but it indicates the config is stale — `index.csr.html` is a build artifact from Angular's CSR output mode which this project doesn't use. Clean it up to avoid confusion.

**Fix:** Remove `/index.csr.html` from `ngsw-config.json`.

#### 3. HIGH — `checkOnboardingStatus()` makes a blocking Firestore call in the route guard chain

**File:** `src/core/auth/auth.service.ts` (line 280-284)

```typescript
async getUserProfile(uid: string) {
  const userRef = doc(this.firestore, `users/${uid}`);
  const userDoc = await getDoc(userRef);  // ← BLOCKS on Firestore network call
  return userDoc.data();
}
```

This is called by `checkOnboardingStatus()` (line 298), which is called by:
- `requireOnboardedGuard` (for `/user/**` routes)
- `appEntryGuard` (for `/` root route)
- `guestGuard` (for `/login`, `/register`)

**What happens offline:** The `getDoc()` call attempts a network read. Without Firestore offline persistence enabled (the project uses `getFirestore()` with no `persistentLocalCache`), this call has **no local cache to fall back to**. It either:
- Times out after ~10 seconds (Firestore's default timeout)
- Throws immediately if the SDK detects no connectivity

The `catch` block in `checkOnboardingStatus` does fall back to `localStorage` — but the **delay** before the error is thrown can make the app appear stuck on the boot spinner for 10+ seconds while the guard chain is frozen.

**Fix:** Check network status before attempting the Firestore call, or set a short timeout:

```typescript
async checkOnboardingStatus(uid: string): Promise<boolean> {
  // Skip the Firestore call entirely when offline — go straight to cache
  if (!inject(NetworkService).isOnline()) {
    return this.readIsOnboardedFromCachedUserProfile(uid);
  }
  try {
    const profile = await this.getUserProfile(uid);
    ...
  } catch {
    return this.readIsOnboardedFromCachedUserProfile(uid);
  }
}
```

#### 4. HIGH — `IndexedDbRecoveryService.checkAndRecover()` can trigger reload loops offline

**File:** `src/core/offline/indexed-db-recovery.service.ts` (line 54-77)
**File:** `src/app/app.config.ts` (line 39)

```typescript
provideAppInitializer(() => inject(IndexedDbRecoveryService).checkAndRecover()),
```

This runs as an `APP_INITIALIZER` — Angular **blocks the entire app bootstrap** until it resolves. If the IndexedDB probe detects a "fault" (which can be a false positive from a flaky IndexedDB open on mobile), it calls `recover()` which:
1. Deletes the database
2. Calls `location.reload()`

**What happens offline:** The reload fires, but if the service worker hasn't cached everything properly, the reload request can't be served → "This page can't be reached". The 60-second cooldown guard prevents an infinite loop, but the user is stuck for 60 seconds staring at an error page before the guard allows the app to proceed without healing.

**Additionally:** The `inspect()` method opens IndexedDB with `indexedDB.open(this.dbName)` without a version parameter. On some mobile browsers (especially iOS Safari), this can hang or fail in unexpected ways when the browser is under memory pressure or in low-power mode, blocking the `APP_INITIALIZER` indefinitely.

**Fix:** Add a timeout to the `APP_INITIALIZER` so it can't block bootstrap forever, and skip the recovery-reload path when offline:

```typescript
provideAppInitializer(() => {
  const recovery = inject(IndexedDbRecoveryService);
  // Don't block app boot for more than 3 seconds
  return Promise.race([
    recovery.checkAndRecover(),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
}),
```

And in `recover()`, check connectivity before reloading:
```typescript
if (!navigator.onLine) {
  console.warn('Skipping recovery reload while offline');
  return false;
}
```

#### 5. MEDIUM — `authInterceptor` calls `getIdToken()` which can hang offline

**File:** `src/core/interceptors/auth.interceptor.ts` (line 57)

```typescript
return from(auth.currentUser?.getIdToken() ?? Promise.resolve(null)).pipe(...)
```

When the Firebase ID token has expired and the device is offline, `getIdToken()` attempts a token refresh over the network. This can hang or throw after a delay. While this doesn't block initial page load (it only affects `HttpClient` calls), it can cause UI spinners to hang on any feature that makes an HTTP request during initialization.

**Fix:** Already partially handled since the guard allows through on `getIdToken()` failure, but the interceptor should also handle the offline case gracefully by checking `navigator.onLine` before attempting the token refresh.

#### 6. MEDIUM — Lazy-loaded route chunks may not be cached if never visited

**Verified:** The `ngsw.json` manifest confirms all 80 chunk files ARE in the `app` prefetch group — they are downloaded and cached when the service worker installs. However:

- The service worker only prefetches on **install** (first visit after deploy). If the user visits the app once, the SW installs and starts prefetching in the background. If the user **closes the app before prefetching completes** and then goes offline, some chunks will be missing.
- On slow mobile connections, prefetching 80 chunks (several MB) can take minutes. The user might navigate to 2-3 pages and close the app before all 80 are cached.

**Fix:** This is inherent to the `prefetch` strategy and is generally acceptable. For critical paths (dashboard, transactions), the chunks will be among the first prefetched. Lower-priority routes (settings, about) might fail offline on first visit — this is an acceptable tradeoff. To mitigate further, consider adding a `navigationUrls` config to `ngsw-config.json` to ensure navigation requests always serve `index.html` from cache even when sub-resources are missing.

#### 7. LOW — `provideServiceWorker` configuration is correct

**File:** `src/app/app.config.ts` (lines 64-67)

```typescript
provideServiceWorker('ngsw-worker.js', {
  enabled: !isDevMode(),
  registrationStrategy: 'registerImmediately',
}),
```

**Verified:** This is correct. `registerImmediately` is the right choice for offline-first — it registers the SW on first page load rather than waiting for the app to stabilize. The SW is only enabled in production mode, which is correct.

**Note:** The `navigationRequestStrategy` in the generated `ngsw.json` is `"performance"` (the default), which serves navigation requests from cache first and checks the network in the background. This is correct for offline-first behavior.

#### 8. LOW — FCM service worker scope is correctly isolated

**File:** `src/features/notifications/fcm.service.ts` (line 46-48)

```typescript
swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
  scope: '/firebase-cloud-messaging-push-scope',
});
```

**Verified:** The FCM worker is scoped to `/firebase-cloud-messaging-push-scope` so it never competes with the NGSW worker at `/`. This is correct and not a factor in the offline loading issue.

However, `firebase-messaging-sw.js` itself uses `importScripts()` from `https://www.gstatic.com/firebasejs/12.0.0/...` — if this file were to somehow take over the root scope (e.g., via a browser bug or manual registration without the scope), it would break offline loading entirely because it can't serve cached assets. The current scoping prevents this, so this is a low risk.

### Summary: Why the App Fails Offline (Priority Order)

| Priority | Issue | Root Cause | Fix Effort |
|---|---|---|---|
| **P0** | Google Fonts `<link>` is render-blocking | Browser hangs waiting for external stylesheet before rendering cached `index.html` | LOW — change to `preload`/`media="print"` swap |
| **P1** | `checkOnboardingStatus()` blocks on Firestore `getDoc()` | No offline persistence, 10s timeout before fallback to localStorage | LOW — check `isOnline()` before calling |
| **P1** | `IndexedDbRecoveryService` can reload offline | `location.reload()` fails when SW cache is incomplete | LOW — skip reload when offline, add timeout |
| **P2** | `index.csr.html` stale reference | In ngsw-config but doesn't exist; harmless but confusing | LOW — remove from config |
| **P2** | `authInterceptor` token refresh hangs | `getIdToken()` attempts network call for expired tokens | LOW — guard with `navigator.onLine` check |
| **P3** | Incomplete chunk prefetch | User may close app before all 80 chunks are cached | NONE — inherent to prefetch strategy |

**The most likely cause of "This page can't be reached" is P0 (Google Fonts).** Even when the NGSW correctly serves `index.html` from its cache, the render-blocking font stylesheet triggers a network request that the browser cannot fulfill offline, and some mobile browsers interpret this as a page load failure rather than a degraded render.

---

## What Can Be Done Better — Phased Improvement Plan

### Phase 1: Instant Response & Offline Boot Fix — Sprint 1

These changes fix the offline loading failure and make every write feel instant.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 1.0a | **Fix render-blocking Google Fonts** — change `<link rel="stylesheet">` to non-render-blocking `media="print"` swap pattern in `index.html`. This is the primary cause of "This page can't be reached" offline | CRITICAL | LOW | DONE |
| 1.0b | **Skip `checkOnboardingStatus` Firestore call when offline** — check `navigator.onLine` before `getUserProfile()` in `auth.service.ts`. Fall back to `localStorage` immediately instead of waiting 10s for Firestore timeout | CRITICAL | LOW | DONE |
| 1.0c | **Guard `IndexedDbRecoveryService` reload against offline** — skip `location.reload()` in `recover()` when `navigator.onLine` is false. Add a 3-second timeout to the `APP_INITIALIZER` so a stuck probe can't block bootstrap forever | CRITICAL | LOW | DONE |
| 1.0d | **Remove stale `index.csr.html` from `ngsw-config.json`** — file does not exist in build output; clean up config | LOW | LOW | DONE |
| 1.0e | **Guard `authInterceptor` token refresh** — check `navigator.onLine` before calling `getIdToken()` for expired tokens; return `null` token immediately when offline | MEDIUM | LOW | DONE |
| 1.1 | **Background sync all CREATEs** — remove blocking Firestore path from `create()`, make `syncRemoteInBackground` the default behavior for all entities (accounts, budgets, budgetPlans, categories, goals, groups, reports) | HIGH | LOW | PENDING |
| 1.2 | **Background sync all UPDATEs** — add `syncRemoteUpdate` private method to `OfflineCrudService`, same fire-and-forget pattern as `syncRemoteCreate` | HIGH | LOW | PENDING |
| 1.3 | **Background sync all DELETEs** — add `syncRemoteDelete` private method to `OfflineCrudService` | HIGH | LOW | PENDING |
| 1.4 | **Remove per-action offline toasts** — stop showing "Saved locally. Will sync when connected." on every queue entry. Only notify on permanent failure (MAX_RETRIES exhausted) | MEDIUM | LOW | PENDING |
| 1.5 | **Shrink loader scope** — in feature pages, the `saving` signal should only wrap the IndexedDB write + navigation, not the Firestore round-trip | HIGH | LOW | PENDING |
| 1.6 | **Background sync for `createWithPath`** — apply the same pattern for subcollection creates (group expenses, group settlements) | MEDIUM | LOW | DONE (partially — group expenses already use it) |

### Phase 2: Cost Reduction (Firestore Reads) — Sprint 2

These changes reduce Firestore read/write costs by being smarter about when and how much data is fetched.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 2.1 | **Extend revalidation TTLs** — current TTLs are aggressive (transactions: 2min, accounts: 5min). For a personal finance app, 10min/30min is safe since the user is typically the only writer. Reduces Firestore reads by ~60-70% | HIGH | LOW | PENDING |
| 2.2 | **Paginated server fetches** — `fetchAll()` fetches ALL documents for a store/index in one query. For users with 1000+ transactions, this is expensive. Use Firestore `startAfter`/`limit` with cursor-based pagination | HIGH | MEDIUM | PENDING |
| 2.3 | **Selective cache invalidation** — `replaceCache()` currently deletes ALL cached entries for an index, then re-inserts server results. Pending-sync items (`_pendingSync: true`) get wiped. Preserve them during revalidation | HIGH | MEDIUM | PENDING |
| 2.4 | **Debounced revalidation** — rapid navigation (back/forward) can trigger multiple revalidation calls for the same store. Debounce by 500ms so only the last one fires | MEDIUM | LOW | PENDING |
| 2.5 | **Batch Firestore writes in sync queue** — currently each queued entry is a separate `setDoc`/`updateDoc`/`deleteDoc`. Use Firestore `writeBatch` to group up to 500 writes into one round-trip | MEDIUM | MEDIUM | PENDING |
| 2.6 | **Skip revalidation after own writes** — after a successful background sync, the cache already has the correct data. The current code calls `markStale()` forcing a redundant Firestore read. Instead, update the cache row with the server response and mark fresh | MEDIUM | LOW | PENDING |

### Phase 3: Resilience & Reliability — Sprint 3

These changes handle edge cases that cause data loss or sync failures.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 3.1 | **Conflict resolution beyond last-writer-wins** — add `_version` or `updatedAt` check before server write. If server version is newer, surface conflict to user instead of blindly overwriting. Critical for shared accounts (multi-device) | HIGH | HIGH | PENDING |
| 3.2 | **Dependency-aware sync ordering** — if account create fails, abort dependent transaction creates instead of letting them fail independently. Prevents cascading failures and wasted Firestore writes | HIGH | MEDIUM | PENDING |
| 3.3 | **Retry with exponential backoff** — current retries fire 5 times immediately in the same sync pass. Use 1s, 2s, 4s, 8s, 16s delays or defer failed entries to the next sync pass | MEDIUM | LOW | PENDING |
| 3.4 | **Multi-tab coordination** — use `navigator.locks` API to prevent two tabs from running `syncAll()` simultaneously (duplicate writes) or revalidating the same store concurrently | MEDIUM | MEDIUM | PENDING |
| 3.5 | **Background Sync API** — register a sync event in the service worker when entries are queued. Enables syncing even after the user closes the app | MEDIUM | MEDIUM | PENDING |
| 3.6 | **Sync queue crash recovery** — `resetInterruptedEntries` on startup resets `in-progress` back to `pending` | LOW | LOW | DONE |
| 3.7 | **Self-healing IndexedDB** — structural fault detection + auto-delete + reload with cooldown guard | LOW | LOW | DONE |

### Phase 4: Observability & Polish — Sprint 4

Quality-of-life improvements for users and developers.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 4.1 | **Change detection on revalidation** — when background revalidation updates the cache, emit a signal so the UI re-renders without requiring navigation. Currently the user sees stale data until they leave and return | MEDIUM | MEDIUM | PENDING |
| 4.2 | **Per-record sync indicator** — show a small "pending sync" badge on items where `_pendingSync: true`. Gives users confidence about what reached the server | MEDIUM | MEDIUM | PENDING |
| 4.3 | **Storage quota monitoring** — use `navigator.storage.estimate()` to warn users approaching IndexedDB limits (especially Safari/private browsing) | LOW | LOW | PENDING |
| 4.4 | **Sync queue size limit** — soft cap with user notification ("100+ pending changes, connect to sync") to prevent queue processing from taking too long | LOW | LOW | PENDING |
| 4.5 | **Structured logging for sync events** — replace `console.warn` with structured telemetry for sync successes, failures, consolidation stats | LOW | LOW | PENDING |
| 4.6 | **Enable Firestore multi-tab persistence** — add `persistentLocalCache` with `persistentMultipleTabManager` as a safety-net fallback behind the custom IndexedDB layer | LOW | LOW | PENDING |
| 4.7 | **Test coverage for edge cases** — syncing during revalidation, replaceCache with pending creates, quota exceeded, auth token expiry mid-sync | LOW | HIGH | PENDING |

---

## Summary Counts

| Phase | Total | Done | Pending |
|---|---|---|---|
| Phase 1: Instant Response & Offline Boot Fix | 11 | 6 | 5 |
| Phase 2: Cost Reduction | 6 | 0 | 6 |
| Phase 3: Resilience | 7 | 2 | 5 |
| Phase 4: Observability | 7 | 0 | 7 |
| **Total** | **31** | **8** | **23** |
