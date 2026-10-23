import { Injectable, inject, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import { SyncQueueService } from '../../core/offline/sync-queue.service';
import { SyncLoggerService } from '../../core/offline/sync-logger.service';
import { TransactionRecord } from '../../shared/models/transaction.model';
import { isTombstone, mapTransactionDoc } from './transaction-mapper';
import { RemoteTxChange, RemoteTxDoc, TransactionRemote } from './transaction-remote';

const STORE = 'transactions';
const META_STORE = 'sync-metadata';

/** Months of history fetched on a device's first sync (current month + previous ones). */
const BOOTSTRAP_MONTHS = 3;
/** Docs per "load older" page. */
export const HISTORY_PAGE_SIZE = 200;
/**
 * A device whose last sync is older than this re-bootstraps instead of catching up,
 * so it can't miss tombstones a `purgeAt` TTL policy (30 days) hard-deleted meanwhile.
 */
const MAX_CATCH_UP_AGE_MS = 25 * 24 * 60 * 60 * 1000;

/** Exact Firestore timestamp, persisted as plain numbers so it survives IndexedDB. */
interface StoredTimestamp {
  s: number;
  ns: number;
}

/** Per-account sync bookkeeping in `sync-metadata` (cleared on logout with the data). */
interface TransactionSyncMeta {
  /** `delta:transactions:<accountKey>` */
  key: string;
  /** Highest server `updatedAt` applied locally; deltas read strictly after it. */
  cursor: StoredTimestamp;
  /** Oldest `createdAt` whose history is loaded; older rows are fetched on demand. */
  historyFrom: StoredTimestamp;
  /** True once nothing older than `historyFrom` exists on the server. */
  historyComplete: boolean;
  /** Wall-clock ms of the last successful server sync on this device. */
  lastSyncedAt: number;
}

export interface TransactionHistoryInfo {
  /** Oldest creation date covered locally, or `null` when never synced. */
  loadedFrom: Date | null;
  complete: boolean;
}

/**
 * Delta sync + lazy history for the `transactions` collection.
 *
 * A plain `where('accountId','==',X)` listener bills EVERY matching doc each time it
 * attaches (resume tokens only help within ~30 min). Instead this service:
 *   1. **Bootstraps** a device once with the last {@link BOOTSTRAP_MONTHS} months.
 *   2. **Catches up / listens** with `updatedAt > cursor`, so an app open costs ~1 read
 *      when nothing changed.
 *   3. **Lazy-loads** older history in pages only when a screen needs it.
 *
 * Deletes are soft (`deletedAt`, see `TransactionsService.deleteTransaction`) so they
 * reach other devices through the same delta; tombstones are dropped from IndexedDB on
 * arrival, so every cache consumer only ever sees live rows.
 */
@Injectable({ providedIn: 'root' })
export class TransactionSyncService {
  private readonly remote = inject(TransactionRemote);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly syncQueue = inject(SyncQueueService);
  private readonly network = inject(NetworkService);
  private readonly logger = inject(SyncLoggerService);

  /** Bumped whenever server rows land in IndexedDB, so consumers re-hydrate. */
  readonly revision = signal(0);

  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly metaWrites = new Map<string, Promise<unknown>>();
  private stopListener: (() => void) | null = null;
  private listenerKey: string | null = null;
  private listenerStarting = false;

  /**
   * Make sure `accountKey` is bootstrapped on this device. A cheap no-op once done;
   * on a fresh device (online) it awaits the first window so callers get data.
   */
  async ensureReady(accountKey: string): Promise<void> {
    const meta = await this.readMeta(accountKey);
    if (meta && !this.needsRebootstrap(meta)) return;
    if (!this.network.isOnline()) return;
    await this.coalesce(`bootstrap:${accountKey}`, () => this.bootstrap(accountKey));
  }

  /**
   * One-shot catch-up for an account WITHOUT a live listener (e.g. a non-selected
   * account opened from settings). Reads only docs changed since the cursor.
   */
  async syncOnce(accountKey: string): Promise<void> {
    if (!this.network.isOnline()) return;
    if (this.listenerKey === accountKey && this.stopListener) return; // listener owns it
    const meta = await this.readMeta(accountKey);
    if (!meta || this.needsRebootstrap(meta)) {
      await this.ensureReady(accountKey); // bootstrap is already current
      return;
    }
    await this.coalesce(`catchup:${accountKey}`, () => this.catchUp(accountKey));
  }

  /** Bootstrap if needed, then keep `accountKey` live via an `updatedAt > cursor` listener. */
  startLive(accountKey: string): void {
    if (this.listenerKey === accountKey && (this.stopListener || this.listenerStarting)) return;
    this.stopLive();
    this.listenerKey = accountKey;
    this.listenerStarting = true;
    void (async () => {
      try {
        await this.ensureReady(accountKey);
        if (this.listenerKey !== accountKey) return; // switched while bootstrapping
        const meta = await this.readMeta(accountKey);
        if (!meta) return; // offline before first bootstrap — retried when back online
        this.stopListener = this.remote.listenUpdatedAfter(
          accountKey,
          toTimestamp(meta.cursor),
          (changes, fromCache) => void this.onLiveChanges(accountKey, changes, fromCache),
          (e) => {
            // A dead listener (e.g. index still building) is released so the next
            // `startLive` — account switch or reconnect — retries it.
            this.logger.warn({ event: 'tx-sync.listener.error', storeName: STORE }, e);
            if (this.listenerKey === accountKey) this.stopLive();
          },
        );
      } catch (e) {
        this.logger.warn({ event: 'tx-sync.start.failed', storeName: STORE }, e);
      } finally {
        if (this.listenerKey === accountKey) this.listenerStarting = false;
      }
    })();
  }

  stopLive(): void {
    this.stopListener?.();
    this.stopListener = null;
    this.listenerKey = null;
    this.listenerStarting = false;
  }

  async historyInfo(accountKey: string): Promise<TransactionHistoryInfo> {
    const meta = await this.readMeta(accountKey);
    return {
      loadedFrom: meta ? toTimestamp(meta.historyFrom).toDate() : null,
      complete: meta?.historyComplete ?? false,
    };
  }

  /** Fetch the next page of history older than what's loaded. `true` if rows were added. */
  async loadOlder(accountKey: string): Promise<boolean> {
    if (!this.network.isOnline()) return false;
    await this.ensureReady(accountKey);
    let added = false;
    await this.coalesce(`older:${accountKey}`, async () => {
      const meta = await this.readMeta(accountKey);
      if (!meta || meta.historyComplete) return;
      const docs = await this.remote.createdBefore(
        accountKey,
        toTimestamp(meta.historyFrom),
        HISTORY_PAGE_SIZE,
      );
      await this.applyDocs(docs);
      const oldest = docs.at(-1)?.data['createdAt'];
      await this.updateMeta(accountKey, {
        historyFrom: oldest instanceof Timestamp ? fromTimestamp(oldest) : meta.historyFrom,
        historyComplete: docs.length < HISTORY_PAGE_SIZE,
      });
      added = docs.length > 0;
      this.logger.info({
        event: 'tx-sync.history.page',
        storeName: STORE,
        counts: { docs: docs.length },
      });
    });
    if (added) this.bump();
    return added;
  }

  /**
   * Load history pages until everything created on/after `since` is local
   * (`null` = all history). Returns whether that range is now covered.
   */
  async ensureHistorySince(accountKey: string, since: Date | null): Promise<boolean> {
    await this.ensureReady(accountKey);
    for (let page = 0; page < 100; page++) {
      const info = await this.historyInfo(accountKey);
      if (!info.loadedFrom) return false; // never synced (offline)
      if (info.complete || (since && info.loadedFrom <= since)) return true;
      if (!(await this.loadOlder(accountKey))) {
        return (await this.historyInfo(accountKey)).complete;
      }
    }
    return false;
  }

  /** Live transaction count from the server; local row count when offline. */
  async countLive(accountKey: string): Promise<number> {
    const local = async () =>
      (await this.cache.getAllByIndex<TransactionRecord>(STORE, 'accountId', accountKey)).length;
    if (!this.network.isOnline()) return local();
    try {
      return await this.remote.countLive(accountKey);
    } catch (e) {
      this.logger.warn({ event: 'tx-sync.count.failed', storeName: STORE }, e);
      return local();
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * First sync for an account on this device: load the recent window and reset the
   * local slice to it. Older synced rows are dropped (they lazy-load again with their
   * CURRENT server state); un-synced local writes are kept.
   */
  private async bootstrap(accountKey: string): Promise<void> {
    const now = new Date();
    const from = Timestamp.fromDate(
      new Date(now.getFullYear(), now.getMonth() - (BOOTSTRAP_MONTHS - 1), 1),
    );
    let docs: RemoteTxDoc[];
    let historyFrom = from;
    let historyComplete: boolean;
    try {
      const [recent, older] = await Promise.all([
        this.remote.createdSince(accountKey, from),
        this.remote.createdBefore(accountKey, from, 1), // 1 read: anything older?
      ]);
      docs = recent;
      historyComplete = older.length === 0;
    } catch (e) {
      // Composite index not built yet — fall back to one full read so the device
      // still gets its data.
      if ((e as { code?: string }).code !== 'failed-precondition') throw e;
      this.logger.warn({ event: 'tx-sync.bootstrap.index-missing', storeName: STORE }, e);
      docs = await this.remote.allForAccount(accountKey);
      historyFrom = Timestamp.fromMillis(0);
      historyComplete = true;
    }

    const existing = await this.cache.getAllByIndex<TransactionRecord & { _pendingSync?: boolean }>(
      STORE,
      'accountId',
      accountKey,
    );
    for (const row of existing) {
      if (!row._pendingSync) await this.cache.delete(STORE, row.uid);
    }
    await this.applyDocs(docs);

    await this.writeMeta({
      key: metaKey(accountKey),
      cursor: maxUpdatedAt(docs) ?? fromTimestamp(from),
      historyFrom: fromTimestamp(historyFrom),
      historyComplete,
      lastSyncedAt: Date.now(),
    });
    this.logger.info({
      event: 'tx-sync.bootstrap',
      storeName: STORE,
      counts: { docs: docs.length },
    });
    this.bump();
  }

  private async catchUp(accountKey: string): Promise<void> {
    const meta = await this.readMeta(accountKey);
    if (!meta) return;
    const docs = await this.remote.updatedAfter(accountKey, toTimestamp(meta.cursor));
    await this.applyDocs(docs);
    await this.updateMeta(accountKey, {
      cursor: maxOf(meta.cursor, maxUpdatedAt(docs)),
      lastSyncedAt: Date.now(),
    });
    if (docs.length) this.bump();
  }

  private async onLiveChanges(
    accountKey: string,
    changes: RemoteTxChange[],
    fromCache: boolean,
  ): Promise<void> {
    if (this.listenerKey !== accountKey) return;
    const upserts = changes.filter((c) => c.type !== 'removed').map((c) => c.doc);
    await this.applyDocs(upserts);

    // A doc only leaves an `updatedAt > cursor` result set by being hard-deleted
    // (e.g. by an older app version or an account cascade) — mirror that locally.
    const pendingDeletes = await this.syncQueue.pendingDeleteIdsForStore(STORE);
    for (const c of changes) {
      if (c.type !== 'removed') continue;
      const local = await this.cache.getByKey<{ _pendingSync?: boolean }>(STORE, c.doc.id);
      if (local && !local._pendingSync && !pendingDeletes.has(c.doc.id)) {
        await this.cache.delete(STORE, c.doc.id);
      }
    }

    if (!fromCache) {
      const meta = await this.readMeta(accountKey);
      if (meta) {
        await this.updateMeta(accountKey, {
          cursor: maxOf(meta.cursor, maxUpdatedAt(upserts)),
          lastSyncedAt: Date.now(),
        });
      }
    }
    if (changes.length) this.bump();
  }

  /**
   * Write server docs into IndexedDB without clobbering the user's own un-synced work:
   * local `_pendingSync` rows and queued deletes win until the sync queue drains.
   * Tombstones remove the local row.
   */
  private async applyDocs(docs: RemoteTxDoc[]): Promise<void> {
    if (!docs.length) return;
    const pendingDeletes = await this.syncQueue.pendingDeleteIdsForStore(STORE);
    const toPut: TransactionRecord[] = [];
    for (const d of docs) {
      if (d.hasPendingWrites || pendingDeletes.has(d.id)) continue;
      const local = await this.cache.getByKey<{ _pendingSync?: boolean }>(STORE, d.id);
      if (local?._pendingSync) continue;
      if (isTombstone(d.data)) {
        if (local) await this.cache.delete(STORE, d.id);
      } else {
        toPut.push(mapTransactionDoc(d.id, d.data));
      }
    }
    if (toPut.length) await this.cache.putAll(STORE, toPut);
  }

  private bump(): void {
    this.revision.update((n) => n + 1);
  }

  private needsRebootstrap(meta: TransactionSyncMeta): boolean {
    return Date.now() - meta.lastSyncedAt > MAX_CATCH_UP_AGE_MS;
  }

  private async readMeta(accountKey: string): Promise<TransactionSyncMeta | null> {
    return (
      (await this.cache.getByKey<TransactionSyncMeta>(META_STORE, metaKey(accountKey))) ?? null
    );
  }

  private async writeMeta(meta: TransactionSyncMeta): Promise<void> {
    await this.cache.put(META_STORE, meta);
  }

  /** Read-modify-write serialized per account so concurrent syncs can't lose fields. */
  private updateMeta(accountKey: string, patch: Partial<TransactionSyncMeta>): Promise<void> {
    const key = metaKey(accountKey);
    const next = (this.metaWrites.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const meta = await this.readMeta(accountKey);
        if (meta) await this.writeMeta({ ...meta, ...patch });
      });
    this.metaWrites.set(key, next);
    return next;
  }

  /** One in-flight run per key; failures are logged, never thrown to callers. */
  private coalesce(key: string, run: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const p = run()
      .catch((e) =>
        this.logger.warn({ event: 'tx-sync.failed', storeName: STORE, extra: { key } }, e),
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }
}

function metaKey(accountKey: string): string {
  return `delta:${STORE}:${accountKey}`;
}

function fromTimestamp(t: Timestamp): StoredTimestamp {
  return { s: t.seconds, ns: t.nanoseconds };
}

function toTimestamp(t: StoredTimestamp): Timestamp {
  return new Timestamp(t.s, t.ns);
}

function maxOf(a: StoredTimestamp, b: StoredTimestamp | null): StoredTimestamp;
function maxOf(a: StoredTimestamp | null, b: StoredTimestamp | null): StoredTimestamp | null;
function maxOf(a: StoredTimestamp | null, b: StoredTimestamp | null): StoredTimestamp | null {
  if (!a) return b;
  if (!b) return a;
  return a.s > b.s || (a.s === b.s && a.ns >= b.ns) ? a : b;
}

function maxUpdatedAt(docs: RemoteTxDoc[]): StoredTimestamp | null {
  let max: StoredTimestamp | null = null;
  for (const d of docs) {
    const u = d.data['updatedAt'];
    if (u instanceof Timestamp) max = maxOf(max, fromTimestamp(u));
  }
  return max;
}
