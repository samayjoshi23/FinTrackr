# FinTrackr — Architecture Review & Performance Guide

> Generated with `ng new` via Angular CLI v21.2.2. Run `ng serve` to start the dev server at `http://localhost:4200/`.

---

## What the App Does

FinTrackr is an **offline-first personal and shared expense tracker** built with Angular + Firebase. Core capabilities:

- **Multi-account finance tracking** — income/expense transactions across multiple accounts
- **Budgeting** — category-level monthly spending limits with visual progress
- **Goals** — financial targets with progress tracking
- **Group expense splitting** — shared expenses, settlement tracking, member invitations
- **Recurring transactions** — scheduled payments and income
- **Reports & analytics** — charts for income/expense trends, category breakdowns, savings rates
- **Offline-first** — all reads/writes work offline; a sync queue pushes changes to Firestore when online
- **Push notifications** — FCM-based alerts for budget overruns and group activities

---

## High-Level Architecture

```
Browser
  └── Angular (Signals + RxJS)
        ├── Feature modules (lazy-loaded routes)
        ├── Core offline engine
        │     ├── IndexedDB (ngx-indexed-db) — local cache (13 stores)
        │     ├── SyncQueue — offline write buffer
        │     └── SyncService — background reconciliation with Firestore
        └── Firebase SDK
              ├── Firestore — source of truth
              ├── Auth — email/password + Google SSO
              ├── Storage — profile images
              └── FCM — push notifications
```

**Read flow:**
1. Component calls service → `OfflineCrudService.fetchAll()`
2. IndexedDB cache hit → return immediately, trigger background Firestore revalidation
3. Cache miss + online → Firestore fetch, populate IndexedDB, return data
4. Cache miss + offline → return empty state

**Write flow:**
1. `OfflineCrudService.create/update/remove()`
2. Optimistic write to IndexedDB (UI updates immediately)
3. Entry added to sync queue
4. If online → Firestore write fires immediately
5. If offline → sync queue is flushed when network returns

---

## Folder Structure

```
src/
├── app/                    # Root bootstrap (app.ts, app.routes.ts, app.config.ts)
├── core/
│   ├── auth/              # Firebase Auth, user profile, onboarding guards
│   ├── offline/           # Offline engine (crud, sync, sync-queue, IndexedDB adapter, network)
│   ├── guards/            # Route guards (auth, onboarding, guest)
│   ├── interceptors/      # Auth token injection into HTTP headers
│   └── pages/             # Shell/layout components
├── features/
│   ├── home/dashboard/    # Main dashboard
│   ├── transactions/      # Transaction CRUD + pagination
│   ├── accounts/          # Account management + balance tracking
│   ├── budgets/           # Monthly budget CRUD
│   ├── categories/        # Custom category management
│   ├── goals/             # Goal tracking
│   ├── recurring/         # Recurring transaction schedules
│   ├── groups/            # Shared expense groups + settlements
│   ├── reports/           # Analytics + charts (ApexCharts)
│   ├── notifications/     # Real-time inbox + FCM + preferences
│   └── settings/          # App settings, account details, privacy
└── shared/
    ├── components/        # Reusable UI atoms
    ├── models/            # TypeScript interfaces
    ├── enums/             # App-wide enums
    └── pipes/             # Custom pipes (SignedAmount, etc.)
```

---

## Routes

| Path | Purpose |
|------|---------|
| `/login` | Email / Google sign-in |
| `/register` | Sign-up |
| `/onboarding` | Post-signup account & category setup |
| `/reset-password` | Password recovery |
| `/user/dashboard` | Summary, recent transactions, budget progress |
| `/user/transactions/list` | Paginated list with type/date/category/search filters |
| `/user/transactions/add` | Create transaction |
| `/user/budgets` | Budget list with usage bars |
| `/user/budgets/new` | Create budget |
| `/user/budgets/edit/:id` | Edit budget |
| `/user/goals` | Goal list with progress |
| `/user/goals/new` | Create goal |
| `/user/categories` | Custom categories |
| `/user/categories/new` | Create category |
| `/user/categories/edit/:id` | Edit category |
| `/user/recurring` | Recurring schedules |
| `/user/recurring/add` | Create recurring schedule |
| `/user/recurring/view/:id` | View schedule + linked transactions |
| `/user/recurring/edit/:id` | Edit recurring |
| `/user/groups` | Group list |
| `/user/groups/:id` | Group detail (expenses, settlements, members) |
| `/user/groups/:id/add` | Add group expense |
| `/user/reports` | Analytics dashboard |
| `/user/notifications` | Notification inbox |
| `/user/settings` | Settings shell |
| `/user/settings/notifications` | Notification preferences |
| `/user/settings/accounts/:id` | Account detail/edit |
| `/user/settings/accounts/new` | Create additional account |
| `/user/settings/privacy` | Privacy & security |
| `/user/settings/about` | About page |

---

## Firestore Collections

```
users/{uid}
accounts/{accountId}
transactions/{transactionId}
recurring-transactions/{id}
budgets/{budgetId}
categories/{categoryId}
goals/{goalId}
monthlyReports/{reportId}
groups/{groupId}
  ├── expenses/{expenseId}
  └── settlements/{settlementId}
users/{uid}/notifications/{notificationId}
```

---

## State Management

| Layer | Technology | Role |
|-------|-----------|------|
| Local cache | IndexedDB (ngx-indexed-db, 13 stores) | Offline reads; optimistic write buffer |
| Sync queue | IndexedDB `sync-queue` store | Deferred Firestore writes while offline |
| UI state | Angular Signals | Fine-grained reactive component state |
| Async streams | RxJS | Auth state, HTTP interceptors |
| Cloud | Firestore | Source of truth |
| Real-time | `onSnapshot` | Notifications only |

No centralized state library (NgRx/Akita). Each feature manages local signals; shared state flows through injected services.

---

## Architectural Flaws

### Critical

#### 1. Silent sync failure — data can be permanently lost
**File:** `src/core/offline/sync.service.ts`

After `MAX_RETRIES = 5` attempts, a queued operation is marked failed and abandoned. There is no UI that lets the user see, inspect, or retry failed sync items. If a user creates a transaction while offline and the sync permanently fails (Firestore security rule mismatch, document ID collision), that transaction silently disappears from the cloud beyond a single toast notification.

**Fix:** Expose a `failedItems` signal in `SyncService`. Add a banner or settings entry that lists failed operations with options to retry or discard manually.

---

#### 2. Sensitive profile data stored unencrypted in localStorage
**File:** `src/core/auth/auth.service.ts`

`userId`, full user profile JSON, onboarding status, and selected account ID are stored in `localStorage` in plain text. Any injected script (XSS) can read these values. Auth tokens are not stored here (good), but the user's `uid` and full profile object expose PII.

**Fix:** Move non-token profile state to a Signal in `AuthService` populated once on auth init. Limit `localStorage` to non-sensitive preferences (theme, display currency).

---

#### 3. Firestore errors swallowed with no error-type discrimination
**File:** `src/core/offline/offline-crud.service.ts`

All `catch` blocks in the offline layer treat every error uniformly. A `permission-denied` error (Firestore security rule) is indistinguishable from a network timeout or `not-found`. This makes debugging access control issues in production nearly impossible.

**Fix:** Inspect `error.code` (`'permission-denied'`, `'unavailable'`, `'not-found'`) and route each to the appropriate path — surface permission errors to the user, log network errors as retryable, throw on unexpected codes.

---

### High Priority

#### 4. Two Firestore reads per groups page load — no union query
**File:** `src/features/groups/groups.service.ts`

`getMyGroups()` fires two separate Firestore queries (`creatorId == uid` and `memberIds array-contains uid`) then merges and deduplicates client-side. Firestore has no native `OR` with `array-contains`, so this is a workaround — but it doubles network reads on every groups page visit.

**Fix (short-term):** Ensure both queries are returned from IndexedDB on re-navigation to avoid hitting Firestore after the first load. Mark cache as warm after the first successful combined fetch.

**Fix (long-term):** Add `memberAndCreatorIds: string[]` to each group document (always includes the creator). One `array-contains` query is sufficient. Maintain this field in every group write and via a Cloud Function on member changes.

---

#### 5. Monthly report recomputed from scratch on every dashboard load
**File:** `src/features/reports/reports.service.ts`

`ensureCurrentMonthReport()` re-reads all transactions for the current month and sums them on every call — triggered at dashboard init and after every transaction mutation. With 500+ transactions this is a blocking O(n) computation on the main thread.

**Fix:** Track the monthly report as a running total. On transaction **create/update/delete**, apply only the delta to the cached report rather than reaggregating. Alternatively, move aggregation to a Firestore Cloud Function triggered on transaction writes and treat `monthlyReports/{id}` as read-only on the client.

---

#### 6. Categories loaded redundantly on every navigation
**Files:** `src/features/transactions/pages/transaction-list/`, `src/features/transactions/pages/add-transaction/`

`CategoriesService.getCategories()` is called independently in the transaction list (filter chips) and the add-transaction form (dropdown). Each call issues an IndexedDB read and a background Firestore revalidation. No in-memory deduplication exists between navigations within the same session.

**Fix:** Add a session-scoped in-memory cache at the service level using a Signal or `BehaviorSubject`. The first call populates it; subsequent calls return the memoized value and only trigger background revalidation once per TTL. Invalidate when a category is mutated.

---

#### 7. No sync queue deduplication for repeated offline edits
**File:** `src/core/offline/sync-queue.service.ts`

If a user edits the same transaction three times while offline, three separate `UPDATE` operations are queued and all three are synced to Firestore on reconnect. The final state is correct but bandwidth and write cost are tripled.

**Fix:** Before flushing the queue, scan for multiple `UPDATE` operations targeting the same `docId` and merge their payloads into one. A `CREATE` followed by `UPDATE(s)` can be consolidated into a single `CREATE` with the merged fields.

```ts
function consolidateQueue(items: SyncQueueItem[]): SyncQueueItem[] {
  const map = new Map<string, SyncQueueItem>();
  for (const item of items) {
    if (item.operation === 'UPDATE' && map.has(item.docId)) {
      map.get(item.docId)!.payload = { ...map.get(item.docId)!.payload, ...item.payload };
    } else {
      map.set(item.docId, item);
    }
  }
  return [...map.values()];
}
```

---

#### 8. `JSON.parse(localStorage.getItem('user'))` without try-catch in every service
**Files:** `src/features/accounts/accounts.service.ts`, `src/features/budgets/budgets.service.ts`, `src/features/goals/goals.service.ts`, `src/features/categories/categories.service.ts`

If `localStorage` is cleared or the stored value is corrupted, the inline `JSON.parse` throws an uncaught exception that crashes the service method call stack.

**Fix:** Use a centralized `AuthService.currentUid` computed signal. All services inject `AuthService` and read from the signal instead of parsing `localStorage` directly.

```ts
// AuthService
readonly currentUid = computed(() => this._userProfile()?.uid ?? null);

// In any service
private requireUid(): string {
  const uid = this.auth.currentUid();
  if (!uid) throw new Error('Not authenticated');
  return uid;
}
```

---

### Medium Priority

#### 9. No virtual scrolling on long lists
**Files:** `src/features/transactions/pages/transaction-list/`, `src/features/notifications/pages/notification-list/`

Both lists render all fetched items as live DOM nodes. As users load more pages, all previously fetched items stay in the DOM. With 200+ loaded items, layout recalculation during scroll is noticeable.

**Fix:** Use Angular CDK `VirtualScrollViewport` with a fixed item height. Keeps ~30 DOM nodes alive regardless of total loaded items.

```html
<cdk-virtual-scroll-viewport itemSize="72" class="scroll-viewport">
  <div *cdkVirtualFor="let tx of transactions()">
    <app-transaction-item [transaction]="tx" />
  </div>
</cdk-virtual-scroll-viewport>
```

---

#### 10. ApexCharts is a CommonJS module — entire library bundled regardless of usage
**File:** `angular.json` (`allowedCommonJsDependencies`)

ApexCharts (~350 kB gzipped) is CommonJS and cannot be tree-shaken by Angular's build. All chart types are included even though the app uses 2–3. The reports feature is already lazy-loaded which limits this to users who navigate to reports.

**Fix (short-term):** Ensure each chart component inside the reports feature is also lazy-loaded individually.

**Fix (long-term):** Migrate to `chart.js` with tree-shakable ESM imports for only the chart types used, or `lightweight-charts` (~40 kB ESM).

---

#### 11. Date field serialization is manual and divergence-prone
**File:** `src/core/offline/indexed-db-cache.service.ts` (`DATE_FIELDS` constant)

Every `Date`/`Timestamp` field must be explicitly listed in the `DATE_FIELDS` constant for correct IndexedDB round-tripping. If a new date field is added to a model but not to the constant, it silently persists as a plain string, causing `.getTime()` / `.toDate()` runtime errors.

**Fix:** Replace the manual constant with schema-level serialization (e.g. Zod schemas per model that auto-handle date conversion). Date handling becomes part of the model definition rather than a shared list that can drift.

---

#### 12. Notification listener races when network flips rapidly
**File:** `src/features/notifications/notification.service.ts`

The `onSnapshot` listener is set up and torn down inside an `effect()` triggered by network status changes. If the network toggles offline→online→offline in quick succession, listener teardown and setup can race, potentially leaving an orphaned Firestore listener open.

**Fix:** Introduce a generation counter (`listenerGeneration: number`). Increment it on every setup. Any callback from an older generation is discarded. Alternatively, use an `AbortController` pattern.

---

### Low Priority

#### 13. CATEGORY_COLORS array cycles at 11+ categories
**File:** `src/features/reports/reports.service.ts`

The color palette is hard-coded with 10 entries. Category 11 gets the same color as category 1 in charts, making them visually indistinguishable.

**Fix:** Generate colors procedurally:
```ts
const color = `hsl(${(index * 360) / total}, 65%, 50%)`;
```

---

#### 14. No cross-tab Firestore deduplication
**File:** `src/core/offline/offline-crud.service.ts`

Two open tabs each run their own background revalidation loop against Firestore independently. There is no coordination via `BroadcastChannel` or `SharedWorker`.

**Fix (pragmatic):** Use a `BroadcastChannel` to broadcast cache freshness timestamps. A tab that just revalidated broadcasts the store name + timestamp; other tabs skip their own revalidation if the received timestamp is within the TTL.

---

## Performance Improvement Recommendations

### 1. Memoize categories and accounts at the service level

Both change rarely but are loaded on every navigation to transactions, add-transaction, and dashboard pages. Add a `private _cache = signal<T[] | null>(null)` in each service and invalidate only after mutations.

**Impact:** Eliminates 2–4 redundant IndexedDB reads and background Firestore network calls per navigation within a session.

---

### 2. Switch monthly report to delta patching

On transaction create/update/delete, apply only the monetary delta to the cached monthly report instead of re-reading and re-summing all transactions.

**Impact:** Turns an O(n) blocking scan into an O(1) patch. Most impactful on the dashboard hot path.

---

### 3. Deduplicate sync queue before flush

Merge multiple `UPDATE` entries for the same `docId` before syncing to Firestore. Consolidate `CREATE` + subsequent `UPDATE(s)` into a single `CREATE`.

**Impact:** Reduces Firestore write operations proportionally to offline edit frequency. Reduces post-reconnect latency and cost.

---

### 4. Denormalize groups for single-query load

Add `memberAndCreatorIds` to each group document. Replace the current two-query pattern with a single `array-contains` query.

**Impact:** Halves Firestore reads on the groups page. Removes client-side merge/dedup logic.

---

### 5. Add CDK virtual scrolling to lists

Replace static `*ngFor` with `*cdkVirtualFor` on the transaction and notification lists.

**Impact:** DOM node count stays constant (~30) regardless of loaded items. Scroll performance scales to any dataset size.

---

### 6. Add a revalidation TTL to `OfflineCrudService`

Track `cachedAt` per store in IndexedDB. Skip the background Firestore revalidation if the cache is younger than the TTL (e.g. 60 s for transactions, 5 min for categories).

```ts
async shouldRevalidate(storeName: string, ttlMs = 60_000): Promise<boolean> {
  const meta = await this.idb.getByKey<{ cachedAt: number }>('cache-meta', storeName);
  return !meta || Date.now() - meta.cachedAt > ttlMs;
}
```

**Impact:** On subsequent navigations within a session, zero Firestore network calls are made for stable data (categories, accounts, goals).

---

### 7. Centralize `localStorage` reads in `AuthService`

Replace all inline `JSON.parse(localStorage.getItem('user'))` calls with a `currentUid` computed signal on `AuthService`.

**Impact:** Eliminates 6–10 redundant `localStorage` reads per page load. Removes the crash risk on malformed JSON.

---

### 8. Batch onboarding writes

During onboarding, replace sequential `setDoc()` calls for accounts and default categories with a single `writeBatch()`.

**Impact:** Reduces onboarding from N+1 sequential Firestore writes to 1 atomic commit. Prevents partial onboarding state if a write fails mid-sequence.

---

### 9. Expose failed sync items in the UI

Add a `failedSyncItems` computed signal to `SyncService`. Show a dismissible warning banner when `failedSyncItems().length > 0`.

**Impact:** Prevents silent data loss. Users can decide to retry, discard, or re-enter lost transactions manually.

---

### 10. Lazy-load ApexCharts with dynamic import

Even within the already-lazy reports feature, import ApexCharts dynamically on first chart render:

```ts
async initChart() {
  const { default: ApexCharts } = await import('apexcharts');
  // init
}
```

**Impact:** Removes ApexCharts from the reports lazy chunk's parse cost until the user actually views a chart.

---

## Issues Priority Matrix

| # | Issue | Severity | Effort |
|---|-------|---------|--------|
| 1 | Silent sync failure — no user-visible recovery | Critical | Medium |
| 2 | PII in unencrypted localStorage | Critical | Low |
| 3 | Swallowed Firestore errors — no error-code discrimination | High | Low |
| 4 | Double Firestore query on groups page | High | Medium |
| 5 | Monthly report full recompute on every call | High | Medium |
| 6 | Categories fetched redundantly across components | High | Low |
| 7 | No sync queue deduplication for repeated offline edits | Medium | Low |
| 8 | `JSON.parse(localStorage)` without try-catch in services | Medium | Low |
| 9 | No virtual scrolling on large lists | Medium | Medium |
| 10 | ApexCharts CommonJS — not tree-shaken | Medium | Low |
| 11 | Manual DATE_FIELDS constant — fragile date serialization | Medium | High |
| 12 | Notification listener race on rapid network toggle | Low | Medium |
| 13 | CATEGORY_COLORS cycles at 11+ categories | Low | Low |
| 14 | No cross-tab Firestore deduplication | Low | High |

---

## Bundle Budget Reference

From `angular.json`:

| Budget | Warning | Error |
|--------|---------|-------|
| Initial bundle | 500 kB | 1 MB |
| Lazy chunk | 900 kB | 1.5 MB |

Largest contributors:
1. ApexCharts — ~350 kB gzipped, CommonJS, in reports lazy chunk
2. Firebase SDK — ~150 kB gzipped
3. Angular framework + CDK — ~150–200 kB gzipped
4. ngx-indexed-db — ~20 kB

---

## Development Commands

```bash
# Start dev server
ng serve

# Production build
ng build

# Run unit tests (Vitest)
ng test

# Generate a component
ng generate component component-name
```
