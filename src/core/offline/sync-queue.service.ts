import { Injectable, inject } from '@angular/core';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { NetworkService } from './network.service';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { NotifierSeverity } from '../../shared/components/notifier/types';
import { StorageQuotaService } from './storage-quota.service';
import { SyncLoggerService } from './sync-logger.service';
import { SyncQueueEntry } from './sync-queue.model';

const STORE = 'sync-queue';

/** Exponential backoff schedule (ms) — 1s, 2s, 4s, 8s, 16s, then capped at 32s. */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 32_000;

/**
 * Soft cap on pending queue entries. Beyond this we notify the user — a queue
 * this large usually means the device has been offline for a long stretch or
 * something is systematically failing to sync (permission-denied, malformed
 * payloads). Notification fires once per session to avoid noise.
 */
const QUEUE_SIZE_WARN_THRESHOLD = 100;

/**
 * Trigger a storage-quota check every N enqueues so long offline sessions get
 * warned before writes start rejecting with `QuotaExceededError`. The regular
 * post-sync quota check can't help while the user is offline for hours writing
 * continuously — this fills that gap.
 */
const QUOTA_CHECK_ENQUEUE_INTERVAL = 25;

/** ms an entry should wait before its next attempt, given its current retryCount. */
export function backoffMsForRetry(retryCount: number): number {
  if (retryCount <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (retryCount - 1), BACKOFF_CAP_MS);
}

@Injectable({ providedIn: 'root' })
export class SyncQueueService {
  private readonly cache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);
  private readonly notifier = inject(NotifierService);
  private readonly logger = inject(SyncLoggerService);
  private readonly quota = inject(StorageQuotaService);
  /** One-shot flag so the "queue is large" warning only fires once per session. */
  private largeQueueWarned = false;

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
    const pendingCount = await this.updatePendingCount();
    this.maybeWarnLargeQueue(pendingCount);
    // Long offline session: check storage quota every N enqueues so we surface
    // the "almost full" banner BEFORE the user hits `QuotaExceededError`.
    // Fire-and-forget — must not slow down the write path.
    if (pendingCount > 0 && pendingCount % QUOTA_CHECK_ENQUEUE_INTERVAL === 0) {
      void this.quota.check();
    }
    this.logger.debug({
      event: 'queue.enqueue',
      storeName: entry.storeName,
      entryId: full.id,
      counts: { pending: pendingCount },
      extra: { operation: entry.operation },
    });
    return full;
  }

  private maybeWarnLargeQueue(pendingCount: number): void {
    if (pendingCount < QUEUE_SIZE_WARN_THRESHOLD || this.largeQueueWarned) return;
    this.largeQueueWarned = true;
    this.logger.warn({
      event: 'queue.size.large',
      counts: { pending: pendingCount, threshold: QUEUE_SIZE_WARN_THRESHOLD },
    });
    this.notifier.show(
      `${pendingCount}+ offline changes are waiting to sync. Connect to the internet to catch up.`,
      NotifierSeverity.WARNING,
    );
  }

  async getAllPending(): Promise<SyncQueueEntry[]> {
    const all = await this.cache.getAll<SyncQueueEntry>(STORE);
    return all
      .filter((e) => e.status === 'pending' || e.status === 'in-progress')
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Pending entries whose exponential-backoff window has elapsed and are ready
   * to attempt now. First-attempt entries (retryCount === 0) are always ready.
   */
  async getPendingReadyNow(): Promise<SyncQueueEntry[]> {
    const now = Date.now();
    const all = await this.getAllPending();
    return all.filter((e) => {
      if (e.retryCount === 0) return true;
      const wait = backoffMsForRetry(e.retryCount);
      const last = e.lastAttemptAt ?? 0;
      return now - last >= wait;
    });
  }

  /**
   * Earliest wall-clock time (ms) at which any waiting entry becomes eligible
   * for retry — used by SyncService to schedule the next sync pass. Returns
   * null when nothing is waiting on backoff.
   */
  async getNextRetryAt(): Promise<number | null> {
    const now = Date.now();
    const all = await this.getAllPending();
    let earliest: number | null = null;
    for (const e of all) {
      if (e.retryCount === 0) return now; // ready now
      const eligibleAt = (e.lastAttemptAt ?? 0) + backoffMsForRetry(e.retryCount);
      if (eligibleAt <= now) return now;
      if (earliest == null || eligibleAt < earliest) earliest = eligibleAt;
    }
    return earliest;
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
      // Stamp at FAILURE, not attempt start. If we stamped at attempt start and
      // the Firestore call itself took longer than the backoff window (e.g. 10s
      // timeout > 1s backoff), the next retry would be immediately eligible —
      // defeating the whole point of exponential backoff.
      entry.lastAttemptAt = Date.now();
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

  private async updatePendingCount(): Promise<number> {
    const pending = await this.getAllPending();
    this.network.pendingSyncCount.set(pending.length);
    // Reset the one-shot large-queue flag once the queue drains below threshold —
    // otherwise the warning would never fire again in this session even after
    // a long offline period followed by a manual clear.
    if (pending.length < QUEUE_SIZE_WARN_THRESHOLD) this.largeQueueWarned = false;
    return pending.length;
  }
}
