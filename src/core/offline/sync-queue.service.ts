import { Injectable, inject } from '@angular/core';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { NetworkService } from './network.service';
import { SyncQueueEntry } from './sync-queue.model';

const STORE = 'sync-queue';

@Injectable({ providedIn: 'root' })
export class SyncQueueService {
  private readonly cache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);

  async enqueue(
    entry: Omit<SyncQueueEntry, 'id' | 'status' | 'retryCount'>
  ): Promise<SyncQueueEntry> {
    const full: SyncQueueEntry = {
      ...entry,
      id: crypto.randomUUID(),
      status: 'pending',
      retryCount: 0,
    };
    await this.cache.put(STORE, full);
    await this.updatePendingCount();
    return full;
  }

  async getAllPending(): Promise<SyncQueueEntry[]> {
    const all = await this.cache.getAll<SyncQueueEntry>(STORE);
    return all
      .filter((e) => e.status === 'pending' || e.status === 'in-progress')
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async dequeue(entryId: string): Promise<void> {
    await this.cache.delete(STORE, entryId);
    await this.updatePendingCount();
  }

  async markInProgress(entryId: string): Promise<void> {
    const entry = await this.cache.getByKey<SyncQueueEntry>(STORE, entryId);
    if (entry) {
      entry.status = 'in-progress';
      await this.cache.put(STORE, entry);
    }
  }

  async markFailed(entryId: string, errorMessage: string): Promise<void> {
    const entry = await this.cache.getByKey<SyncQueueEntry>(STORE, entryId);
    if (entry) {
      entry.status = 'failed';
      entry.errorMessage = errorMessage;
      await this.cache.put(STORE, entry);
      await this.updatePendingCount();
    }
  }

  async incrementRetry(entryId: string): Promise<number> {
    const entry = await this.cache.getByKey<SyncQueueEntry>(STORE, entryId);
    if (entry) {
      entry.retryCount++;
      entry.status = 'pending';
      await this.cache.put(STORE, entry);
      return entry.retryCount;
    }
    return 0;
  }

  async resetInterruptedEntries(): Promise<void> {
    const all = await this.cache.getAll<SyncQueueEntry>(STORE);
    for (const entry of all) {
      if (entry.status === 'in-progress') {
        entry.status = 'pending';
        await this.cache.put(STORE, entry);
      }
    }
    await this.updatePendingCount();
  }

  async hasPendingForStore(storeName: string): Promise<boolean> {
    const pending = await this.getAllPending();
    return pending.some((e) => e.storeName === storeName);
  }

  /** Entries that exhausted their retries — excluded from normal flushes. */
  async getFailedEntries(): Promise<SyncQueueEntry[]> {
    const all = await this.cache.getAll<SyncQueueEntry>(STORE);
    return all.filter((e) => e.status === 'failed').sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Requeue a failed entry: back to `pending` with a fresh retry budget. */
  async retryFailed(entryId: string): Promise<void> {
    const entry = await this.cache.getByKey<SyncQueueEntry>(STORE, entryId);
    if (entry && entry.status === 'failed') {
      entry.status = 'pending';
      entry.retryCount = 0;
      entry.errorMessage = undefined;
      await this.cache.put(STORE, entry);
      await this.updatePendingCount();
    }
  }

  /** Permanently drop a failed entry the user chose not to retry. */
  async discardFailed(entryId: string): Promise<void> {
    const entry = await this.cache.getByKey<SyncQueueEntry>(STORE, entryId);
    if (entry && entry.status === 'failed') {
      await this.cache.delete(STORE, entryId);
      await this.updatePendingCount();
    }
  }

  async clearAll(): Promise<void> {
    await this.cache.clear(STORE);
    this.network.pendingSyncCount.set(0);
  }

  private async updatePendingCount(): Promise<void> {
    const pending = await this.getAllPending();
    this.network.pendingSyncCount.set(pending.length);
  }
}
