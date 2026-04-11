import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc } from '@angular/fire/firestore';
import { NetworkService } from './network.service';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { SyncQueueService } from './sync-queue.service';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { NotifierSeverity } from '../../shared/components/notifier/types';
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
  goals: 'goals',
  categories: 'categories',
  accounts: 'accounts',
  'monthly-reports': 'monthlyReports',
  'recurring-transactions': 'recurring-transactions',
};

@Injectable({ providedIn: 'root' })
export class OfflineCrudService {
  private readonly firestore = inject(Firestore);
  private readonly network = inject(NetworkService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly syncQueue = inject(SyncQueueService);
  private readonly notifier = inject(NotifierService);

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
      // Return cached data immediately; refresh in background for next visit
      if (this.network.isOnline()) {
        this.revalidateAll(storeName, firestoreFn, indexFilter);
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
        this.revalidateAll('transactions', firestoreFn, indexFilter);
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
      // Return cached doc immediately; refresh in background
      if (this.network.isOnline()) {
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
    options?: { fixedDocId?: string; syncRemoteInBackground?: boolean },
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

    const enqueuePending = async () => {
      await this.syncQueue.enqueue({
        storeName,
        operation: 'create',
        payload: { ...payload, _syncPreassignedId: assignedId },
        tempLocalId: assignedId,
        timestamp: Date.now(),
      });
      this.notifier.show('Saved locally. Will sync when connected.', NotifierSeverity.WARNING);
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return optimistic;
    }

    if (options?.syncRemoteInBackground) {
      void this.syncRemoteCreate(storeName, assignedId, firestoreFn, enqueuePending);
      return optimistic;
    }

    try {
      const result = await firestoreFn(assignedId);
      const merged = { ...(result as object), _pendingSync: false } as unknown as T;
      await this.cache.put(storeName, merged);
      return merged;
    } catch {
      await enqueuePending();
      return optimistic;
    }
  }

  /** Firestore write after optimistic IndexedDB row; failures fall back to sync queue. */
  private syncRemoteCreate<T>(
    storeName: string,
    assignedId: string,
    firestoreFn: (assignedId: string) => Promise<T>,
    enqueuePending: () => Promise<void>,
  ): void {
    void (async () => {
      try {
        const result = await firestoreFn(assignedId);
        const merged = { ...(result as object), _pendingSync: false } as unknown as T;
        await this.cache.put(storeName, merged);
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

    const enqueuePending = async () => {
      await this.syncQueue.enqueue({
        storeName,
        operation: 'update',
        payload: patch,
        docId,
        timestamp: Date.now(),
      });
      this.notifier.show('Saved locally. Will sync when connected.', NotifierSeverity.WARNING);
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return updated;
    }

    try {
      await firestoreFn();
      const done = { ...(updated as object), _pendingSync: false } as unknown as T;
      await this.cache.put(storeName, done);
      return done;
    } catch {
      await enqueuePending();
      return updated;
    }
  }

  /**
   * DELETE: remove from IndexedDB first, then Firestore when online (or queue delete for sync).
   */
  async remove(
    storeName: string,
    docId: string,
    firestoreFn: () => Promise<void>,
  ): Promise<void> {
    await this.cache.delete(storeName, docId);

    const enqueuePending = async () => {
      await this.syncQueue.enqueue({
        storeName,
        operation: 'delete',
        payload: {},
        docId,
        timestamp: Date.now(),
      });
      this.notifier.show('Deleted offline. Will sync when connected.', NotifierSeverity.WARNING);
    };

    if (!this.network.isOnline()) {
      await enqueuePending();
      return;
    }

    try {
      await firestoreFn();
    } catch {
      await enqueuePending();
    }
  }

  // ─── Background revalidation ──────────────────────────────────

  /** Fire-and-forget: fetch from Firestore and update cache for next read. */
  private revalidateAll<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): void {
    firestoreFn()
      .then((results) => this.replaceCache(storeName, results, indexFilter))
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
        }
      })
      .catch(() => {
        /* silent */
      });
  }

  /** Replace cached entries for a given filter with fresh server data. */
  private async replaceCache<T>(
    storeName: string,
    results: T[],
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): Promise<void> {
    if (indexFilter) {
      const old = await this.cache.getAllByIndex<Record<string, unknown>>(
        storeName,
        indexFilter.indexName,
        indexFilter.value,
      );
      const keyField = this.getKeyField(storeName);
      for (const item of old) {
        const key = item[keyField] as string | number;
        if (key) await this.cache.delete(storeName, key);
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
