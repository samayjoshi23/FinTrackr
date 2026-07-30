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
| **CREATE (all entities)** | All creates now fire-and-forget via `syncRemoteCreate`. `syncRemoteInBackground` option removed (it's the only path) | No change needed | DONE |
| **UPDATE (all entities)** | All updates now fire-and-forget via `syncRemoteUpdate` | No change needed | DONE |
| **DELETE (all entities)** | All deletes now fire-and-forget via `syncRemoteDelete` | No change needed | DONE |
| **Loader scope** | Loader wraps only IndexedDB write (~5ms) since service methods return immediately | No change needed | DONE |
| **Per-action offline toast** | Removed. Only notifies on permanent failure (MAX_RETRIES exhausted in SyncService) | No change needed | DONE |
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
| 1.1 | **Background sync all CREATEs** — removed blocking Firestore path from `create()`, all creates now fire-and-forget. Removed `syncRemoteInBackground` option (no longer needed — it's the only path) | HIGH | LOW | DONE |
| 1.2 | **Background sync all UPDATEs** — added `syncRemoteUpdate` private method to `OfflineCrudService`, same fire-and-forget pattern as `syncRemoteCreate`. All updates return after IndexedDB write | HIGH | LOW | DONE |
| 1.3 | **Background sync all DELETEs** — added `syncRemoteDelete` private method to `OfflineCrudService`. All deletes return after IndexedDB delete | HIGH | LOW | DONE |
| 1.4 | **Remove per-action offline toasts** — removed all "Saved locally. Will sync when connected." / "Deleted offline." toasts from `OfflineCrudService`. Removed unused `NotifierService` import | MEDIUM | LOW | DONE |
| 1.5 | **Shrink loader scope** — service methods now return after IndexedDB write (~5ms), so `saving` signal in feature pages effectively wraps only the local write + navigation. No feature page changes needed | HIGH | LOW | DONE |
| 1.6 | **Background sync for `createWithPath`** — added `syncRemoteCreateWithPath` method; all subcollection creates (group expenses, settlements) now fire-and-forget with `onSuccess` callback support | MEDIUM | LOW | DONE |

### Phase 2: Cost Reduction (Firestore Reads) — Sprint 2

These changes reduce Firestore read/write costs by being smarter about when and how much data is fetched.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 2.1 | **Extend revalidation TTLs** — Extended TTLs (transactions 2→10min, accounts 5→30min, budgets/goals 15→60min, categories 30min→2hr). Shared entities (groups/expenses) kept at 15min since multiple members can write | HIGH | LOW | DONE |
| 2.2 | **Paginated server fetches** — `fetchAll()` fetches ALL documents for a store/index in one query. For users with 1000+ transactions, this is expensive. Use Firestore `startAfter`/`limit` with cursor-based pagination | HIGH | MEDIUM | PENDING (deferred — requires per-service refactor of `applyPending*` methods and cursor state; needs dedicated design pass) |
| 2.3 | **Selective cache invalidation** — `replaceCache()` now preserves rows with `_pendingSync: true` that aren't present in the server response. Server-side rows still win when both exist (canonical version has landed) | HIGH | MEDIUM | DONE |
| 2.4 | **Debounced revalidation** — Added 500ms debounce map keyed per (store + indexFilter). Rapid navigation collapses to a single Firestore query per slice | MEDIUM | LOW | DONE |
| 2.5 | **Batch Firestore writes in sync queue** — currently each queued entry is a separate `setDoc`/`updateDoc`/`deleteDoc`. Use Firestore `writeBatch` to group up to 500 writes into one round-trip | MEDIUM | MEDIUM | PENDING (deferred — sync path calls `applyPending*` on each feature service which encapsulates its own `setDoc/updateDoc`; batching needs those methods to accept an optional `WriteBatch` param) |
| 2.6 | **Skip revalidation after own writes** — Removed `markStale()` from optimistic create/update/remove paths. The cache row we just wrote IS the local truth; no need to re-fetch it. TTL still triggers eventual revalidation to catch multi-device writes | MEDIUM | LOW | DONE |

### Phase 3: Resilience & Reliability — Sprint 3

These changes handle edge cases that cause data loss or sync failures.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 3.1 | **Conflict resolution beyond last-writer-wins** — add `_version` or `updatedAt` check before server write. If server version is newer, surface conflict to user instead of blindly overwriting. Critical for shared accounts (multi-device) | HIGH | HIGH | PENDING (deferred — requires schema-level `_version` on every entity plus per-entity conflict-resolution UX; needs dedicated design pass) |
| 3.2 | **Dependency-aware sync ordering** — if account create fails, abort dependent transaction creates instead of letting them fail independently. Prevents cascading failures and wasted Firestore writes | HIGH | MEDIUM | PENDING (deferred — needs a dependency-tracking field on queue entries and cascade-abort semantics; safer as its own PR) |
| 3.3 | **Retry with exponential backoff** — Added `lastAttemptAt` on `SyncQueueEntry`. `getPendingReadyNow()` filters out entries whose backoff (1s, 2s, 4s, 8s, 16s, capped 32s) hasn't elapsed. `scheduleNextBackoffRun()` uses `setTimeout` (outside Angular zone) to re-run `syncAll` at the earliest eligible time | MEDIUM | LOW | DONE |
| 3.4 | **Multi-tab coordination** — `syncAll` now runs inside `navigator.locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, ...)`. Only one tab holds the lock at a time; others no-op. Falls back gracefully on browsers without Web Locks (Safari <15.4) | MEDIUM | MEDIUM | DONE |
| 3.5 | **Background Sync API** — register a sync event in the service worker when entries are queued. Enables syncing even after the user closes the app | MEDIUM | MEDIUM | PENDING (deferred — Chrome/Edge only, requires SW-side queue mirroring since foreground IndexedDB access from SW is limited; nice-to-have not blocker) |
| 3.6 | **Sync queue crash recovery** — `resetInterruptedEntries` on startup resets `in-progress` back to `pending` | LOW | LOW | DONE |
| 3.7 | **Self-healing IndexedDB** — structural fault detection + auto-delete + reload with cooldown guard | LOW | LOW | DONE |

### Phase 4: Observability & Polish — Sprint 4

Quality-of-life improvements for users and developers.

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 4.1 | **Change detection on revalidation** — Added `revalidationEvents` signal on `OfflineCrudService`. Emits `{storeName, at}` after every successful `revalidateAll` / `revalidateOne`. Feature services and components can `effect(() => { const e = svc.revalidationEvents(); if (e?.storeName === 'transactions') refetch(); })` to refresh derived state without navigation. Signal write runs inside `zone.run()` since the revalidation itself runs outside the zone | MEDIUM | MEDIUM | DONE |
| 4.2 | **Per-record sync indicator** — show a small "pending sync" badge on items where `_pendingSync: true`. Gives users confidence about what reached the server | MEDIUM | MEDIUM | PENDING (deferred to D11 — UI work across every list/card component; needs design pass on badge placement and accessibility) |
| 4.3 | **Storage quota monitoring** — New `StorageQuotaService` calls `navigator.storage.estimate()`. Warns via notifier at 85% (once/session) and shows error banner at 95%. `check()` runs at app-init (via `provideAppInitializer`, non-blocking) and after every successful sync pass. Exposes `lastSnapshot` signal for optional UI display | LOW | LOW | DONE |
| 4.4 | **Sync queue size limit** — `SyncQueueService.enqueue` now checks pending count and warns via notifier once per session at 100+ entries. Flag resets when queue drains below threshold so a later long-offline stretch will warn again | LOW | LOW | DONE |
| 4.5 | **Structured logging for sync events** — New `SyncLoggerService` with typed `SyncLogPayload` (event, storeName, entryId, counts, durationMs, extra). Replaced `console.warn` / `console.error` in `SyncService` and instrumented: `sync.pass.start`, `sync.consolidate`, `sync.entry.failed`, `sync.entry.exhausted`, `sync.pass.complete` (with `durationMs`), `sync.callable.failed`, `queue.enqueue`, `queue.size.large`, `quota.warn`, `quota.critical`. `emit()` seam ready for future telemetry sink (Sentry/Datadog) without touching call sites | LOW | LOW | DONE |
| 4.6 | **Enable Firestore multi-tab persistence** — add `persistentLocalCache` with `persistentMultipleTabManager` as a safety-net fallback behind the custom IndexedDB layer | LOW | LOW | PENDING (deferred to D12 — would double-cache with the custom IndexedDB layer; needs design decision on whether Firestore's cache complements or conflicts with the custom layer) |
| 4.7 | **Test coverage for edge cases** — syncing during revalidation, replaceCache with pending creates, quota exceeded, auth token expiry mid-sync | LOW | HIGH | PENDING (deferred to D13 — no test infrastructure in repo today; needs Karma/Jest setup + IndexedDB mocks + Firestore emulator wiring before edge-case coverage is practical) |

---

## Summary Counts

| Phase | Total | Done | Pending |
|---|---|---|---|
| Phase 1: Instant Response & Offline Boot Fix | 11 | 11 | 0 |
| Phase 2: Cost Reduction | 6 | 4 | 2 |
| Phase 3: Resilience | 7 | 4 | 3 |
| Phase 4: Observability | 7 | 4 | 3 |
| **Total (Phases)** | **31** | **23** | **8** |
| Design Changes Required (see section below) | 15 | 0 | 15 |

---

## Design Changes Required

Items surfaced during implementation reviews that need dedicated design work before they can be safely implemented. Kept separate from the phased plan because they cross multiple layers (schema + service + UI) or require product-level decisions on tradeoffs.

| # | Item | Why it needs design | Blocking / When needed |
|---|---|---|---|
| D1 | **Cross-tab state broadcast** — Web Locks (item 3.4) coordinate WHO runs `syncAll`, but the resulting queue drain isn't visible to other tabs. Tab A dequeues 10 items; Tab B's `pendingSyncCount` signal still shows 10 until Tab B mutates the queue itself. UI banner shows stale count | Needs a `BroadcastChannel('fintrackr:queue')` in `SyncQueueService` + listener that re-reads count on message. Also decide whether to broadcast on EVERY mutation (chatty) vs. batched post-sync. Consider whether the same channel should also broadcast cache invalidation events for consistent UI across tabs | Medium — cosmetic issue today, but as multi-tab use grows, "why does my other tab still show 5 pending?" support tickets will start appearing |
| D2 | **Conflict resolution beyond last-writer-wins** (was 3.1) — server writes blindly overwrite. If User A edits budget on phone at t=0 and User A edits same budget on laptop at t=1, whichever hits Firestore last wins with no notification | Needs (a) schema-level `_version` or `updatedAt` on every entity, (b) pre-write server read to compare, (c) UX pattern for merge conflicts ("server has changed, keep yours / keep theirs / merge"), (d) decision on which fields are safe to auto-merge vs. always prompt | High — critical for shared groups feature; low priority for single-user data |
| D3 | **Dependency-aware sync ordering** (was 3.2) — if `create account` fails, dependent `create transaction` entries fire and fail independently. Wasted Firestore writes + confusing failure banner listing 20 unrelated failures | Needs `dependsOn?: string[]` field on `SyncQueueEntry` referencing parent queue ids, cascade-abort semantics (child fails immediately if parent fails), and handling of circular deps and multi-parent | Medium — currently masked because most cross-entity relationships (transaction→account) use pre-assigned ids that don't strictly require account to exist server-side first |
| D4 | **Background Sync API integration** (was 3.5) — sync only runs while a tab is open. Closing the app after making offline edits means changes wait until next app launch | Needs: (a) service worker to register `sync` events, (b) SW-side queue mirroring since Firebase SDK isn't available inside SW workers (would need REST API calls with saved auth token), (c) fallback for Safari/Firefox (no Background Sync support), (d) careful token refresh logic in SW | Low — Chrome/Edge only; app is PWA-installable but most users keep it open. Nice-to-have |
| D5 | **Paginated server fetches** (was 2.2) — `fetchAll` always fetches ALL docs for a store/index. Users with 5000+ transactions incur a full-collection read on every first-load and every TTL-triggered revalidation | Needs: (a) cursor-based `startAfter`/`limit` in every feature service's Firestore query, (b) cursor state persistence in `sync-metadata`, (c) `applyPending*` methods to understand incremental pages vs. full replace, (d) UI-level infinite scroll integration for pages that currently assume full arrays | High — becomes a real cost/perf issue as user data grows past ~1000 transactions |
| D6 | **Batch Firestore writes in sync queue** (was 2.5) — sync flushes each entry as an individual `setDoc`/`updateDoc`/`deleteDoc`. For a 50-item offline queue that's 50 round-trips instead of 1 `writeBatch` (up to 500 ops) | Needs each feature service's `applyPending*` method to accept an optional `WriteBatch` param, then `SyncService` to group same-store writes into batches before flushing. Touches 8+ services. Also need to preserve error attribution when a batch partially fails | Medium — reduces sync cost and latency significantly for users returning from long offline periods |
| D7 | **Delete-then-revalidate ghost race** — user deletes a doc; if revalidation fires before the server delete propagates, server returns the doc and `replaceCache` inserts it back into the UI | Two options: (a) tombstone approach — mark row `_pendingDelete: true` in cache and filter it from reads until sync confirms; (b) recently-deleted set — track deleted ids in memory for ~5s and filter them out of revalidation results. Option (a) survives page reloads and is more robust | Medium — user-visible bug that will get reported once someone hits it |
| D8 | **Error-class discrimination in sync retries** — `MAX_RETRIES = 5` treats `permission-denied` and `503 unavailable` identically. Terminal errors chew the whole retry budget then land in `failed` after ~63 seconds instead of failing immediately | Needs mapping of Firestore error codes to retry policy: `permission-denied`/`not-found`/`invalid-argument` → immediate `markFailed`; `unavailable`/`aborted`/`deadline-exceeded` → normal backoff. Also decide UX for permanent failures (auto-discard vs. show in banner) | Low — current behavior isn't wrong, just wasteful. Fix during Phase 4 observability work when we can measure which failure classes matter |
| D9 | **Backoff jitter + longer horizon** — current backoff is deterministic `2^n` seconds capped at 32s. With MAX_RETRIES=5, entire budget spent in ~63 seconds. Real outages last minutes-to-hours | Add ±25% random jitter to spread thundering-herd risk. Consider raising cap to 5min and MAX_RETRIES to 8-10 so a temporarily-unavailable server that recovers in an hour still succeeds automatically. Trade-off: longer time before user sees "failed" banner and can manually intervene | Low — jitter is trivial to add; the retry-budget question is a product decision |
| D10 | **Trigger-path consolidation** — `syncAll` is triggered by three independent sources: the constructor `effect()` (online/count changes), the `scheduleNextBackoffRun` `setTimeout`, and user actions (`retryAllFailed`). As we add D4 (Background Sync) and manual "Retry" buttons, race complexity grows | Consider centralizing on a `requestSync(reason: string)` method backed by an RxJS `Subject.pipe(exhaustMap)` that dedupes trigger sources and logs `reason` for diagnosability. Adds RxJS as a dep in this module (not currently used) | Low — current code works; refactor before adding Background Sync (D4) to avoid combinatorial complexity |
| D11 | **Per-record sync indicator** (was 4.2) — show a small "pending sync" badge on items where `_pendingSync: true`. Users lose confidence that their changes are safe when there's no visible indication of sync state on individual records | Needs: (a) shared `<sync-badge>` component with a11y label ("Syncing" / "Saved"), (b) design decision on placement (corner icon vs inline text vs opacity dimming), (c) audit of every list/card component that displays user data (transactions, budgets, goals, groups, expenses, categories, accounts) and adding the badge, (d) styling that works across light/dark themes without competing with existing status colors | Medium — user-perceived reliability of the whole offline story hinges on this being visible. High-value once designed |
| D12 | **Firestore `persistentLocalCache` as safety-net** (was 4.6) — the app uses `getFirestore()` with no built-in persistence because a custom IndexedDB layer handles caching. Enabling `persistentLocalCache(persistentMultipleTabManager())` would provide a fallback when the custom layer fails | Needs product decision: (a) benefits — Firestore's cache is battle-tested and handles multi-tab natively; queries against it work even when the custom layer is broken. (b) costs — doubles cache storage (custom IndexedDB + Firestore's own IndexedDB), invalidation semantics differ, may confuse debugging when data appears from two sources. (c) migration — decide whether to remove the custom layer over time or keep both permanently | Low — current custom layer works; only revisit if quota issues become common or the custom layer's complexity outweighs its benefit |
| D13 | **Test coverage for offline edge cases** (was 4.7) — no unit or integration tests exist for the offline layer. Bugs in sync semantics currently only surface in production | Needs: (a) test infra — Karma/Jest set up with `fake-indexeddb` for IDB mocking, (b) Firestore emulator wiring for integration tests, (c) test-only hooks in `SyncService` to fast-forward `setTimeout` (or use `fakeAsync/tick`), (d) baseline coverage: syncing-during-revalidation, replaceCache with pending creates, quota exceeded, auth token expiry mid-sync, backoff scheduling, multi-tab lock behavior. Substantial project, but pays back on every future change | Medium — becomes blocking as complexity grows; today the manual-test surface area is already too big to trust after every change |
| D14 | **Signal-as-event-bus impedance mismatch on `revalidationEvents`** (from 4.1 review) — signals model STATE, not EVENTS. When two stores revalidate within the same microtask, the signal set collapses to only the LAST value; effects watching `{storeName: 'transactions'}` will silently miss the event | Three viable patterns, pick one: (a) RxJS `Subject<{storeName, at}>` — natural fit for event bus, consumers filter, downside adds RxJS to this module. (b) Per-store counter signal `signal<Record<string, number>>({})` — bump per store, consumers `computed(() => counts()[store])`, stays in signal idiom. (c) Monotonic counter + separate lookup Map. Recommendation: (b) — no new deps, aligns with existing codebase style | Medium — becomes blocking the moment a feature service actually wires up to `revalidationEvents` (currently no consumers, so no observable bug yet). Fix before the first consumer lands |
| D15 | **Telemetry sink injection point for `SyncLoggerService`** — the current design comment mentions Sentry/Datadog as future targets, but swapping the console for a real sink requires editing `emit()` directly | Introduce an `InjectionToken<LogSink>` with a default console implementation; wire external sinks via `providers: [{provide: LOG_SINK, useClass: SentrySink}]` in a future PR. Small refactor now, prevents scattered call-site edits later | Low — no blockers until a telemetry backend is chosen; nice-to-have architectural cleanup |
