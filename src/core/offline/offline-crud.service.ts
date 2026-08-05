import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, doc } from '@angular/fire/firestore';
import { NetworkService } from './network.service';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { SyncQueueService } from './sync-queue.service';
import { PostSyncCallable } from './sync-queue.model';
import { TransactionRecord } from '../../shared/models/transaction.model';
import {
  applyTransactionFilters,
  paginateTransactionRows,
  sortTransactionsByCreatedAtDesc,
  TransactionListFilter,
  TransactionPagedResult,
} from '../../shared/models/transaction-query.model';

/** Firestore collection id for each IndexedDB store (pre-assigned doc ids + setDoc). */
const FIRESTORE_COLLECTION_BY_STORE: Record<string, string> = {
  transactions: 'transactions',
  budgets: 'budgets',
  budgetPlans: 'budgetPlans',
  goals: 'goals',
  categories: 'categories',
  accounts: 'accounts',
  groups: 'groups',
  'monthly-reports': 'monthlyReports',
  'recurring-transactions': 'recurring-transactions',
};

@Injectable({ providedIn: 'root' })
export class OfflineCrudService {
  private readonly firestore = inject(Firestore);
  private readonly network = inject(NetworkService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly syncQueue = inject(SyncQueueService);

  /**
   * Per-store "data refreshed" counter, bumped after every successful online read
   * writes fresh Firestore data into the cache. Feature services subscribe to
   * re-hydrate their derived signals from the freshly-written cache:
   *
   * ```ts
   * effect(() => { crud.revalidationCounts()['transactions']; this.hydrateFromCache(); });
   * ```
   * Per-store keying avoids the "last event collapses in one flush" problem a single
   * signal would have.
   */
  readonly revalidationCounts = signal<Record<string, number>>({});

  private emitRefreshed(storeName: string): void {
    this.revalidationCounts.update((counts) => ({
      ...counts,
      [storeName]: (counts[storeName] ?? 0) + 1,
    }));
  }

  /**
   * Cap a Firestore call so a flaky connection (navigator says online but the server
   * is unreachable — captive portal, dead Wi-Fi) can't hang the UI. On timeout the
   * promise rejects, and callers degrade: reads fall back to cache, deletes to the
   * sync-queue. This app runs Firestore WITHOUT persistentLocalCache, so an un-guarded
   * `getDocs`/`deleteDoc` has no cache to fall back on and can block for a long time.
   */
  private static readonly NET_TIMEOUT_MS = 8_000;
  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error('firestore request timed out')),
          OfflineCrudService.NET_TIMEOUT_MS,
        ),
      ),
    ]);
  }

  /**
   * READ list — **network-first when online, cache when offline.**
   *
   * - Online → Firestore is the source of truth: fetch it, mirror it into IndexedDB
   *   (preserving un-synced local writes), and return the refreshed cache slice. This
   *   makes every navigation reflect the latest server state, so cross-device changes
   *   and deletes surface immediately and stale/deleted rows can't linger.
   * - Offline → serve the IndexedDB slice.
   * - On a Firestore error → log the cause (esp. `permission-denied`) and fall back to
   *   cache so the app degrades gracefully instead of blanking.
   */
  async fetchAll<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): Promise<T[]> {
    if (!this.network.isOnline()) {
      return this.readFromCache<T>(storeName, indexFilter);
    }
    try {
      const results = await this.withTimeout(firestoreFn());
      await this.replaceCache(storeName, results, indexFilter);
      this.emitRefreshed(storeName);
      // Return the reconciled cache (server truth + any un-synced local pending rows).
      return this.readFromCache<T>(storeName, indexFilter);
    } catch (e) {
      this.logReadError(storeName, e);
      return this.readFromCache<T>(storeName, indexFilter);
    }
  }

  /**
   * READ transactions — network-first (same model as {@link fetchAll}), then
   * filter/sort/paginate in the offline layer so components avoid scanning full lists.
   */
  async fetchTransactionsPage(
    accountKey: string,
    filter: TransactionListFilter,
    offset: number,
    limit: number,
    firestoreFn: () => Promise<TransactionRecord[]>,
  ): Promise<TransactionPagedResult> {
    const indexFilter = { indexName: 'accountId', value: accountKey };
    let rows: TransactionRecord[];
    if (!this.network.isOnline()) {
      rows = await this.readFromCache<TransactionRecord>('transactions', indexFilter);
    } else {
      try {
        const results = await this.withTimeout(firestoreFn());
        await this.replaceCache('transactions', results, indexFilter);
        this.emitRefreshed('transactions');
        rows = await this.readFromCache<TransactionRecord>('transactions', indexFilter);
      } catch (e) {
        this.logReadError('transactions', e);
        rows = await this.readFromCache<TransactionRecord>('transactions', indexFilter);
      }
    }
    const pipeline = sortTransactionsByCreatedAtDesc(applyTransactionFilters(rows, filter));
    return paginateTransactionRows(pipeline, offset, limit);
  }

  /**
   * READ single — network-first when online, cache when offline.
   * On any Firestore error (incl. `permission-denied`, which is logged distinctly)
   * it degrades to the cached value or `null` — matching the pre-refactor contract,
   * so no caller has to handle a new throw.
   */
  async fetchOne<T>(
    storeName: string,
    key: string | number,
    firestoreFn: () => Promise<T | null>,
  ): Promise<T | null> {
    const cachedRow = await this.cache.getByKey<Record<string, unknown>>(storeName, key);

    if (!this.network.isOnline()) {
      return (cachedRow as T) ?? null;
    }
    // A queued offline delete means this doc is gone locally — don't resurrect it.
    if ((await this.syncQueue.pendingDeleteIdsForStore(storeName)).has(String(key))) {
      return null;
    }
    // Never let a server read overwrite/delete an un-synced local write — the local
    // (optimistic create / offline edit) row is authoritative until the queue syncs it.
    if (cachedRow?.['_pendingSync'] === true) {
      return cachedRow as T;
    }
    try {
      const result = await this.withTimeout(firestoreFn());
      if (result) {
        await this.cache.put(storeName, result);
      } else {
        await this.cache.delete(storeName, key); // server says it's gone → mirror that
      }
      return result;
    } catch (e) {
      this.logReadError(storeName, e);
      return ((await this.cache.getByKey<T>(storeName, key)) as T) ?? null;
    }
  }

  /**
   * CREATE: IndexedDB first (accurate local state immediately), then Firestore when online.
   * Uses a pre-assigned Firestore doc id ({@link doc(collection()).id} or `fixedDocId` for accounts).
   */
  async create<T>(
    storeName: string,
    keyField: string,
    firestoreFn: (assignedId: string) => Promise<T>,
    payload: Record<string, unknown>,
    options?: {
      fixedDocId?: string;
      /**
       * When online, await the Firestore write before returning. Use for records
       * whose id is immediately referenced by follow-up Firestore writes (e.g.
       * account create → budgetPlans/goals/monthlyReports create) — otherwise
       * rules deny because `canAccessAccount(accountId)` can't `get()` a doc
       * that hasn't been committed yet.
       */
      awaitRemote?: boolean;
    },
  ): Promise<T> {
    const collectionPath = FIRESTORE_COLLECTION_BY_STORE[storeName];
    if (!collectionPath) {
      throw new Error(`Unknown offline store for create: ${storeName}`);
    }

    const assignedId =
      options?.fixedDocId ?? doc(collection(this.firestore, collectionPath)).id;
    const now = new Date();
    const optimistic = {
      ...payload,
      [keyField]: assignedId,
      createdAt: now,
      updatedAt: now,
      _pendingSync: true,
    } as unknown as T;

    if (storeName === 'accounts') {
      (optimistic as Record<string, unknown>)['uid'] = assignedId;
    }

    await this.cache.put(storeName, optimistic);
    // Do NOT markStale here — the cache row we just wrote IS the local truth.
    // A revalidation now would just re-fetch what we already have. The store's
    // TTL will trigger natural revalidation later to catch multi-device writes.

    const enqueuePending = async () => {
      await this.syncQueue.enqueue({
        storeName,
        operation: 'create',
        payload: { ...payload, _syncPreassignedId: assignedId },
        tempLocalId: assignedId,
        timestamp: Date.now(),
      });
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return optimistic;
    }

    if (options?.awaitRemote) {
      // Block until Firestore commits so downstream writes that reference this
      // id (accountId is the canonical case) don't race the rules `get()`. Capped by
      // a timeout so a flaky connection surfaces an error (and queues the create for
      // later) instead of hanging the flow forever.
      try {
        const result = await this.withTimeout(firestoreFn(assignedId));
        return (await this.mergePendingSyncFlag(storeName, assignedId, result)) as T;
      } catch (e) {
        await enqueuePending();
        throw e;
      }
    }

    void this.syncRemoteCreate(storeName, assignedId, firestoreFn, enqueuePending);
    return optimistic;
  }

  /**
   * CREATE for subcollections (e.g. `groups/{id}/expenses`).
   * Identical to {@link create} but takes an explicit Firestore `collectionPath` (slash-delimited)
   * instead of looking up from `FIRESTORE_COLLECTION_BY_STORE`, so it works for any depth.
   *
   * @param postSyncCallablesBuilder Optional factory called with the assigned id; its result is
   *   stored on the queue entry and invoked by `SyncService` after the server write succeeds.
   * @param onSuccess Optional fire-and-forget callback invoked after a **successful immediate**
   *   online write (not used in the offline/queued path — callables handle that).
   */
  async createWithPath<T>(
    storeName: string,
    collectionPath: string,
    keyField: string,
    firestoreFn: (assignedId: string) => Promise<T>,
    payload: Record<string, unknown>,
    options?: {
      fixedDocId?: string;
      postSyncCallablesBuilder?: (assignedId: string) => PostSyncCallable[];
      onSuccess?: (assignedId: string, result: T) => void;
    },
  ): Promise<T> {
    const assignedId =
      options?.fixedDocId ?? doc(collection(this.firestore, collectionPath)).id;
    const now = new Date();
    const optimistic = {
      ...payload,
      [keyField]: assignedId,
      createdAt: now,
      updatedAt: now,
      _pendingSync: true,
    } as unknown as T;

    await this.cache.put(storeName, optimistic);
    // Do NOT markStale here — the cache row we just wrote IS the local truth.
    // A revalidation now would just re-fetch what we already have. The store's
    // TTL will trigger natural revalidation later to catch multi-device writes.

    const postSyncCallables = options?.postSyncCallablesBuilder?.(assignedId);

    const enqueuePending = async () => {
      await this.syncQueue.enqueue({
        storeName,
        operation: 'create',
        payload: { ...payload, _syncPreassignedId: assignedId },
        tempLocalId: assignedId,
        timestamp: Date.now(),
        ...(postSyncCallables?.length ? { postSyncCallables } : {}),
      });
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return optimistic;
    }

    void this.syncRemoteCreateWithPath(storeName, assignedId, firestoreFn, enqueuePending, options?.onSuccess);
    return optimistic;
  }

  /**
   * Firestore write after optimistic IndexedDB row; failures fall back to sync queue.
   *
   * On success, re-reads the current cache row (which may include intervening client
   * writes like a follow-up update) and only flips `_pendingSync: false` — never writes
   * back the stale server snapshot, which would clobber any patches applied while the
   * background write was in flight. Server-only fields not yet in the cache are merged
   * UNDER the current row so client patches always win.
   */
  private syncRemoteCreate<T>(
    storeName: string,
    assignedId: string,
    firestoreFn: (assignedId: string) => Promise<T>,
    enqueuePending: () => Promise<void>,
  ): void {
    void (async () => {
      try {
        const result = await this.withTimeout(firestoreFn(assignedId));
        await this.mergePendingSyncFlag(storeName, assignedId, result);
      } catch {
        await enqueuePending();
      }
    })();
  }

  /** Same as syncRemoteCreate but fires an onSuccess callback after the server write. */
  private syncRemoteCreateWithPath<T>(
    storeName: string,
    assignedId: string,
    firestoreFn: (assignedId: string) => Promise<T>,
    enqueuePending: () => Promise<void>,
    onSuccess?: (assignedId: string, result: T) => void,
  ): void {
    void (async () => {
      try {
        const result = await this.withTimeout(firestoreFn(assignedId));
        const merged = await this.mergePendingSyncFlag(storeName, assignedId, result);
        onSuccess?.(assignedId, merged);
      } catch {
        await enqueuePending();
      }
    })();
  }

  /**
   * Background Firestore update; failures fall back to sync queue.
   * Re-reads the current cache row after success so any concurrent write (a rapid
   * follow-up update, revalidation, etc.) isn't clobbered by a stale snapshot.
   */
  private syncRemoteUpdate(
    storeName: string,
    docId: string,
    firestoreFn: () => Promise<void>,
    enqueuePending: () => Promise<void>,
  ): void {
    void (async () => {
      try {
        await this.withTimeout(firestoreFn());
        await this.mergePendingSyncFlag(storeName, docId, null);
      } catch {
        await enqueuePending();
      }
    })();
  }

  /**
   * After a background write succeeds, flip `_pendingSync: false` on the cache row
   * WITHOUT overwriting any intervening client writes. Merges server-only fields
   * (present in `serverResult` but not in current cache row) so nothing is lost, but
   * client patches take precedence for keys that exist in both. Returns the merged row.
   */
  private async mergePendingSyncFlag<T>(
    storeName: string,
    key: string | number,
    serverResult: T | null,
  ): Promise<T> {
    const current = await this.cache.getByKey<Record<string, unknown>>(storeName, key);
    const server = (serverResult ?? {}) as Record<string, unknown>;
    // Client patches (current cache row) win over server result — the server response
    // may be stale relative to a follow-up update that landed while we were waiting.
    const merged = { ...server, ...(current ?? {}), _pendingSync: false } as unknown as T;
    await this.cache.put(storeName, merged);
    return merged;
  }

  /**
   * UPDATE: patch IndexedDB first, then Firestore when online (or queue for sync).
   */
  async update<T>(
    storeName: string,
    docId: string,
    firestoreFn: () => Promise<void>,
    patch: Record<string, unknown>,
    currentDoc: Record<string, unknown>,
  ): Promise<T> {
    const updated = {
      ...currentDoc,
      ...patch,
      updatedAt: new Date(),
      _pendingSync: true,
    } as unknown as T;
    await this.cache.put(storeName, updated);
    // Do NOT markStale — the patched row we just wrote IS the local truth.

    // Monthly reports are derived from transactions/budgets — the sync pass rebuilds
    // them via `rebuildReportsForMonths`, so queuing raw patches would only race that
    // rebuild (and there's no `processUpdate` case for this store either).
    const enqueuePending = async () => {
      if (storeName === 'monthly-reports') return;
      await this.syncQueue.enqueue({
        storeName,
        operation: 'update',
        payload: patch,
        docId,
        timestamp: Date.now(),
      });
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return updated;
    }

    void this.syncRemoteUpdate(storeName, docId, firestoreFn, enqueuePending);
    return updated;
  }

  /**
   * DELETE: remove from IndexedDB first, then Firestore when online (or queue delete for sync).
   *
   * @param extraPayload Optional context stored in the queue entry (e.g. `{ _groupId }` for
   *   subcollection paths that the sync worker needs to reconstruct the Firestore ref).
   */
  async remove(
    storeName: string,
    docId: string,
    firestoreFn: () => Promise<void>,
    extraPayload?: Record<string, unknown>,
  ): Promise<void> {
    await this.cache.delete(storeName, docId);

    const enqueuePending = async () => {
      await this.syncQueue.enqueue({
        storeName,
        operation: 'delete',
        payload: extraPayload ?? {},
        docId,
        timestamp: Date.now(),
      });
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return;
    }

    // Online: AWAIT the Firestore delete so the doc is actually gone server-side
    // before we return — otherwise a network-first read racing this delete would
    // re-read the still-present doc and resurrect it. On failure OR timeout (flaky
    // connection), fall back to the queue, which network-first reads also honor via
    // pendingDeleteIdsForStore. A queued delete re-running against an already-deleted
    // doc is treated as success by the sync worker, so double-delete is harmless.
    try {
      await this.withTimeout(firestoreFn());
    } catch {
      await enqueuePending();
    }
  }

  /**
   * Reconcile a cache slice to the fresh Firestore result (network-first).
   *
   * The server response is authoritative EXCEPT for the user's own un-synced work:
   *   - rows with `_pendingSync: true` that the server doesn't return yet are kept
   *     (an offline/optimistic create or edit still waiting to sync);
   *   - ids with a queued offline `delete` are NOT written back and are removed —
   *     the delete just hasn't reached Firestore yet, so the server still returns them.
   * Everything else in the slice that the server no longer returns is pruned, so a
   * deleted or lost-access row can't linger.
   */
  private async replaceCache<T>(
    storeName: string,
    results: T[],
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): Promise<void> {
    const keyField = this.getKeyField(storeName);
    const pendingDeletes = await this.syncQueue.pendingDeleteIdsForStore(storeName);

    const serverKeys = new Set<string | number>();
    for (const row of results as Array<Record<string, unknown>>) {
      const k = row?.[keyField] as string | number | undefined;
      if (k != null) serverKeys.add(k);
    }

    // Keys with an un-synced local write (offline create/edit). Their local row is
    // authoritative until the queue syncs it, so a network read must NOT overwrite or
    // prune them — even when the server still returns an older version of the same id.
    const localPending = new Set<string>();
    if (indexFilter) {
      const old = await this.cache.getAllByIndex<Record<string, unknown>>(
        storeName,
        indexFilter.indexName,
        indexFilter.value,
      );
      for (const item of old) {
        const key = item[keyField] as string | number;
        if (key == null) continue;
        if (item['_pendingSync'] === true && !pendingDeletes.has(String(key))) {
          localPending.add(String(key));
        }
      }
      for (const item of old) {
        const key = item[keyField] as string | number;
        if (key == null) continue;
        if (serverKeys.has(key)) continue; // will be overwritten below (unless pending)
        if (localPending.has(String(key))) continue; // keep un-synced local create/edit
        await this.cache.delete(storeName, key); // server dropped it → prune
      }
    }

    // Write server rows, but skip ids the user deleted offline (not yet synced) and ids
    // with an un-synced local edit (keep the local version), then evict pending-deletes.
    const toWrite = (results as Array<Record<string, unknown>>).filter((r) => {
      const k = String(r?.[keyField]);
      return !pendingDeletes.has(k) && !localPending.has(k);
    });
    await this.cache.putAll(storeName, toWrite as T[]);
    for (const id of pendingDeletes) {
      await this.cache.delete(storeName, id).catch(() => {});
    }
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Log a read failure with enough detail to diagnose the cause. Silent failures
   * here have masked real issues before (rules denial, App Check, network error).
   */
  private logReadError(storeName: string, e: unknown): void {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'permission-denied') {
      console.warn(
        `offlineCrud read("${storeName}") denied by Firestore rules (permission-denied). ` +
          `Serving cache; check that firestore.rules is deployed.`,
        e,
      );
    } else {
      console.warn(`offlineCrud read("${storeName}") failed — serving cache`, e);
    }
  }

  private async readFromCache<T>(
    storeName: string,
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): Promise<T[]> {
    if (indexFilter) {
      return this.cache.getAllByIndex<T>(storeName, indexFilter.indexName, indexFilter.value);
    }
    return this.cache.getAll<T>(storeName);
  }

  private getKeyField(storeName: string): string {
    switch (storeName) {
      case 'transactions':
      case 'recurring-transactions':
      case 'categories':
      case 'monthly-reports':
        return 'uid';
      default:
        return 'id';
    }
  }
}

/** Re-exported so services can use the type without a separate import. */
export type { PostSyncCallable };
