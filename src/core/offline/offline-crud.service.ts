import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Firestore, collection, doc } from '@angular/fire/firestore';
import { NetworkService } from './network.service';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { RevalidationTrackerService, RevalIndexFilter } from './revalidation-tracker.service';
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
  private readonly tracker = inject(RevalidationTrackerService);
  private readonly syncQueue = inject(SyncQueueService);
  private readonly zone = inject(NgZone);

  /**
   * Per-store monotonic revalidation counter. Every successful background revalidation
   * (`revalidateAll` / `revalidateOne`) bumps the count for its store. Consumers
   * subscribe with:
   *
   * ```ts
   * const txReval = computed(() => crud.revalidationCounts()['transactions'] ?? 0);
   * effect(() => { txReval(); refetchTransactions(); });
   * ```
   *
   * Per-store keying is intentional: a single "last event" signal collapses when
   * two revalidations complete in the same microtask (Angular batches effect
   * runs to one per flush), so a consumer filtering `event.storeName === 'X'`
   * would silently miss events. A counter changes value distinctly per store,
   * so an effect on one store's count re-runs iff THAT store actually
   * revalidated — no lost updates.
   */
  readonly revalidationCounts = signal<Record<string, number>>({});

  /**
   * READ list — cache-first with background revalidation.
   *
   * 1. Read IndexedDB cache immediately.
   * 2. If cache has data → return it instantly, then revalidate from Firestore
   *    in the background so the next navigation is fresh.
   * 3. If cache is empty:
   *    - Check sync queue for pending items on this store → if yes, return [].
   *    - Queue empty + online → fetch Firestore (first-ever load, must wait).
   *    - Queue empty + offline → return [].
   */
  async fetchAll<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): Promise<T[]> {
    const cached = await this.readFromCache<T>(storeName, indexFilter);

    if (cached.length > 0) {
      // Return cached data immediately; refresh in background for next visit —
      // but only when the cached slice has outlived its TTL (skips redundant
      // Firestore reads on every navigation).
      if (this.network.isOnline()) {
        void this.maybeRevalidateAll(storeName, firestoreFn, indexFilter);
      }
      return cached;
    }

    // Cache is empty — decide whether to fetch from network
    const hasPending = await this.syncQueue.hasPendingForStore(storeName);
    if (hasPending) {
      return [];
    }

    if (!this.network.isOnline()) {
      return [];
    }

    // First-ever load (empty cache, no pending, online) — must wait for Firestore
    try {
      const results = await firestoreFn();
      await this.replaceCache(storeName, results, indexFilter);
      await this.tracker.markFresh(storeName, indexFilter);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * READ transactions — cache-first (IndexedDB `accountId` index), filter/sort/paginate in the
   * offline layer so feature components avoid scanning full lists.
   */
  async fetchTransactionsPage(
    accountKey: string,
    filter: TransactionListFilter,
    offset: number,
    limit: number,
    firestoreFn: () => Promise<TransactionRecord[]>,
  ): Promise<TransactionPagedResult> {
    const indexFilter = { indexName: 'accountId', value: accountKey };
    const cached = await this.readFromCache<TransactionRecord>('transactions', indexFilter);

    if (cached.length > 0) {
      if (this.network.isOnline()) {
        void this.maybeRevalidateAll('transactions', firestoreFn, indexFilter);
      }
      const pipeline = sortTransactionsByCreatedAtDesc(applyTransactionFilters(cached, filter));
      const { items, total, hasMore } = paginateTransactionRows(pipeline, offset, limit);
      return { items, total, hasMore };
    }

    const hasPending = await this.syncQueue.hasPendingForStore('transactions');
    if (hasPending) {
      return { items: [], total: 0, hasMore: false };
    }

    if (!this.network.isOnline()) {
      return { items: [], total: 0, hasMore: false };
    }

    try {
      const results = await firestoreFn();
      await this.replaceCache('transactions', results, indexFilter);
      await this.tracker.markFresh('transactions', indexFilter);
      const pipeline = sortTransactionsByCreatedAtDesc(applyTransactionFilters(results, filter));
      const { items, total, hasMore } = paginateTransactionRows(pipeline, offset, limit);
      return { items, total, hasMore };
    } catch {
      return { items: [], total: 0, hasMore: false };
    }
  }

  /**
   * READ single — cache-first with background revalidation.
   */
  async fetchOne<T>(
    storeName: string,
    key: string | number,
    firestoreFn: () => Promise<T | null>,
  ): Promise<T | null> {
    const cached = await this.cache.getByKey<T>(storeName, key);

    if (cached) {
      // Return cached doc immediately; refresh in background unless still fresh
      if (this.network.isOnline() && !this.tracker.isDocFresh(storeName, key)) {
        this.revalidateOne(storeName, key, firestoreFn);
      }
      return cached;
    }

    // Cache miss — try network if online
    if (!this.network.isOnline()) {
      return null;
    }

    try {
      const result = await firestoreFn();
      if (result) {
        await this.cache.put(storeName, result);
        this.tracker.markDocFresh(storeName, key);
      }
      return result;
    } catch {
      return null;
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
    options?: { fixedDocId?: string },
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
        const result = await firestoreFn(assignedId);
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
        const result = await firestoreFn(assignedId);
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
        await firestoreFn();
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

  /** Background Firestore delete; failures fall back to sync queue. */
  private syncRemoteDelete(
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

    const enqueuePending = async () => {
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
    // Do NOT markStale — the delete is already reflected locally.

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

    void this.syncRemoteDelete(firestoreFn, enqueuePending);
  }

  // ─── Background revalidation ──────────────────────────────────

  /**
   * Debounce map for background revalidations. Rapid navigation (back/forward,
   * multiple components mounting the same list) can trigger many `fetchAll` calls
   * for the same slice within milliseconds — without debouncing each one fires its
   * own Firestore query. Keyed by store+indexFilter so different slices don't
   * cancel each other.
   */
  private readonly revalDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly REVAL_DEBOUNCE_MS = 500;

  private revalDebounceKey(storeName: string, indexFilter?: RevalIndexFilter): string {
    const slice = indexFilter ? `${indexFilter.indexName}=${String(indexFilter.value)}` : 'all';
    return `${storeName}::${slice}`;
  }

  /** Fire-and-forget: revalidate only when the cached slice's TTL has expired. */
  private async maybeRevalidateAll<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: RevalIndexFilter,
  ): Promise<void> {
    if (await this.tracker.isFresh(storeName, indexFilter)) return;
    this.scheduleRevalidate(storeName, firestoreFn, indexFilter);
  }

  /**
   * Debounce a revalidation: only the last request within the window actually fires.
   *
   * Runs the setTimeout outside Angular's zone so the delay itself, the resulting
   * Firestore call, and the cache write don't trigger change detection. UI updates
   * happen naturally via signals when consumers next read the cache.
   */
  private scheduleRevalidate<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: RevalIndexFilter,
  ): void {
    const key = this.revalDebounceKey(storeName, indexFilter);
    const existing = this.revalDebounce.get(key);
    if (existing) clearTimeout(existing);
    this.zone.runOutsideAngular(() => {
      const handle = setTimeout(() => {
        this.revalDebounce.delete(key);
        this.revalidateAll(storeName, firestoreFn, indexFilter);
      }, OfflineCrudService.REVAL_DEBOUNCE_MS);
      this.revalDebounce.set(key, handle);
    });
  }

  /** Fire-and-forget: fetch from Firestore and update cache for next read. */
  private revalidateAll<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: RevalIndexFilter,
  ): void {
    firestoreFn()
      .then(async (results) => {
        await this.replaceCache(storeName, results, indexFilter);
        await this.tracker.markFresh(storeName, indexFilter);
        this.emitRevalidationEvent(storeName);
      })
      .catch(() => {
        /* silent — cached data already served */
      });
  }

  /** Fire-and-forget: fetch single doc from Firestore and update cache. */
  private revalidateOne<T>(
    storeName: string,
    key: string | number,
    firestoreFn: () => Promise<T | null>,
  ): void {
    firestoreFn()
      .then((result) => {
        if (result) {
          this.cache.put(storeName, result);
          this.tracker.markDocFresh(storeName, key);
          this.emitRevalidationEvent(storeName);
        }
      })
      .catch(() => {
        /* silent */
      });
  }

  /**
   * Bump the per-store revalidation counter so consumer effects/computeds re-run.
   * Signals have their own scheduler — they don't need to be written inside
   * Angular's zone to trigger effects, so we can update from the outside-zone
   * revalidation callback without wrapping in `zone.run()`.
   */
  private emitRevalidationEvent(storeName: string): void {
    this.revalidationCounts.update((counts) => ({
      ...counts,
      [storeName]: (counts[storeName] ?? 0) + 1,
    }));
  }

  /**
   * Replace cached entries for a given filter with fresh server data.
   *
   * Preserves rows with `_pendingSync: true` — they represent writes the user made
   * that haven't reached the server yet. Wiping them would make the UI "forget"
   * the user's own change until sync completes, which is confusing and looks like
   * data loss.
   *
   * If the server response ALSO contains a row with the same key, the server row
   * wins (the pending write already landed and this is the canonical version).
   */
  private async replaceCache<T>(
    storeName: string,
    results: T[],
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): Promise<void> {
    const keyField = this.getKeyField(storeName);
    const serverKeys = new Set<string | number>();
    for (const row of results as Array<Record<string, unknown>>) {
      const k = row?.[keyField] as string | number | undefined;
      if (k != null) serverKeys.add(k);
    }

    if (indexFilter) {
      const old = await this.cache.getAllByIndex<Record<string, unknown>>(
        storeName,
        indexFilter.indexName,
        indexFilter.value,
      );
      for (const item of old) {
        const key = item[keyField] as string | number;
        if (key == null) continue;
        // Keep local pending writes that the server response doesn't include —
        // they still need to sync, and the UI should keep showing them.
        if (item['_pendingSync'] === true && !serverKeys.has(key)) continue;
        await this.cache.delete(storeName, key);
      }
    }
    await this.cache.putAll(storeName, results);
  }

  // ─── Private helpers ───────────────────────────────────────────

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
