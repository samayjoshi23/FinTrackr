import { Injectable, inject } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class OfflineCrudService {
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
   * CREATE: tries Firestore if online. If offline or fails, queues + caches locally.
   */
  async create<T>(
    storeName: string,
    keyField: string,
    firestoreFn: () => Promise<T>,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (this.network.isOnline()) {
      try {
        const result = await firestoreFn();
        await this.cache.put(storeName, result);
        return result;
      } catch {
        return this.createOffline<T>(storeName, keyField, payload);
      }
    }

    return this.createOffline<T>(storeName, keyField, payload);
  }

  /**
   * UPDATE: tries Firestore if online. If offline or fails, queues + patches cache.
   */
  async update<T>(
    storeName: string,
    docId: string,
    firestoreFn: () => Promise<void>,
    patch: Record<string, unknown>,
    currentDoc: Record<string, unknown>,
  ): Promise<T> {
    if (this.network.isOnline()) {
      try {
        await firestoreFn();
        const updated = { ...currentDoc, ...patch, updatedAt: new Date() } as T;
        await this.cache.put(storeName, updated);
        return updated;
      } catch {
        return this.updateOffline<T>(storeName, docId, patch, currentDoc);
      }
    }

    return this.updateOffline<T>(storeName, docId, patch, currentDoc);
  }

  /**
   * DELETE: tries Firestore if online. If offline or fails, queues + removes from cache.
   */
  async remove(
    storeName: string,
    docId: string,
    firestoreFn: () => Promise<void>,
  ): Promise<void> {
    if (this.network.isOnline()) {
      try {
        await firestoreFn();
        await this.cache.delete(storeName, docId);
        return;
      } catch {
        return this.deleteOffline(storeName, docId);
      }
    }

    return this.deleteOffline(storeName, docId);
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

  private async createOffline<T>(
    storeName: string,
    keyField: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const tempId = `offline_${crypto.randomUUID()}`;
    const now = new Date();
    const tempDoc = {
      ...payload,
      [keyField]: tempId,
      createdAt: now,
      updatedAt: now,
      _pendingSync: true,
    } as unknown as T;

    await this.cache.put(storeName, tempDoc);

    await this.syncQueue.enqueue({
      storeName,
      operation: 'create',
      payload,
      tempLocalId: tempId,
      timestamp: Date.now(),
    });

    this.notifier.show('Saved offline. Will sync when connected.', NotifierSeverity.WARNING);
    return tempDoc;
  }

  private async updateOffline<T>(
    storeName: string,
    docId: string,
    patch: Record<string, unknown>,
    currentDoc: Record<string, unknown>,
  ): Promise<T> {
    const updated = { ...currentDoc, ...patch, updatedAt: new Date(), _pendingSync: true } as unknown as T;
    await this.cache.put(storeName, updated);

    await this.syncQueue.enqueue({
      storeName,
      operation: 'update',
      payload: patch,
      docId,
      timestamp: Date.now(),
    });

    this.notifier.show('Saved offline. Will sync when connected.', NotifierSeverity.WARNING);
    return updated;
  }

  private async deleteOffline(storeName: string, docId: string): Promise<void> {
    await this.cache.delete(storeName, docId);

    await this.syncQueue.enqueue({
      storeName,
      operation: 'delete',
      payload: {},
      docId,
      timestamp: Date.now(),
    });

    this.notifier.show('Deleted offline. Will sync when connected.', NotifierSeverity.WARNING);
  }

  private getKeyField(storeName: string): string {
    switch (storeName) {
      case 'transactions':
      case 'recurring-transactions':
      case 'categories':
        return 'uid';
      default:
        return 'id';
    }
  }
}
