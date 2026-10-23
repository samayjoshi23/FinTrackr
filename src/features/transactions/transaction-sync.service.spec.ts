import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import { SyncLoggerService } from '../../core/offline/sync-logger.service';
import { SyncQueueService } from '../../core/offline/sync-queue.service';
import { HISTORY_PAGE_SIZE, TransactionSyncService } from './transaction-sync.service';
import { RemoteTxChange, RemoteTxDoc, TransactionRemote } from './transaction-remote';

const ACCOUNT = 'acc-1';
const now = new Date();
const monthsAgo = (n: number, day = 15) => new Date(now.getFullYear(), now.getMonth() - n, day);

/** In-memory Firestore stand-in that honors the same filters as the real queries. */
class FakeRemote {
  docs: RemoteTxDoc[] = [];
  reads = 0;
  listener: ((changes: RemoteTxChange[], fromCache: boolean) => void) | null = null;
  listenCursor: Timestamp | null = null;

  add(id: string, created: Date, updated: Date = created, extra: Record<string, unknown> = {}) {
    this.docs = this.docs.filter((d) => d.id !== id);
    this.docs.push({
      id,
      hasPendingWrites: false,
      data: {
        accountId: ACCOUNT,
        amount: 10,
        type: 'expense',
        createdAt: Timestamp.fromDate(created),
        updatedAt: Timestamp.fromDate(updated),
        ...extra,
      },
    });
  }

  private mine() {
    return this.docs.filter((d) => d.data['accountId'] === ACCOUNT);
  }
  private ts(d: RemoteTxDoc, f: string) {
    return (d.data[f] as Timestamp).toMillis();
  }
  private count<T>(rows: T[]): T[] {
    this.reads += Math.max(1, rows.length);
    return rows;
  }

  async createdSince(_: string, from: Timestamp) {
    return this.count(
      this.mine()
        .filter((d) => this.ts(d, 'createdAt') >= from.toMillis())
        .sort((a, b) => this.ts(b, 'createdAt') - this.ts(a, 'createdAt')),
    );
  }
  async createdBefore(_: string, before: Timestamp, size: number) {
    return this.count(
      this.mine()
        .filter((d) => this.ts(d, 'createdAt') < before.toMillis())
        .sort((a, b) => this.ts(b, 'createdAt') - this.ts(a, 'createdAt'))
        .slice(0, size),
    );
  }
  async allForAccount() {
    return this.count(this.mine());
  }
  async updatedAfter(_: string, cursor: Timestamp) {
    return this.count(this.mine().filter((d) => this.ts(d, 'updatedAt') > cursor.toMillis()));
  }
  listenUpdatedAfter(
    _: string,
    cursor: Timestamp,
    onChanges: (changes: RemoteTxChange[], fromCache: boolean) => void,
  ) {
    this.listenCursor = cursor;
    this.listener = onChanges;
    return () => (this.listener = null);
  }
  async countLive() {
    return this.mine().filter((d) => d.data['deletedAt'] == null).length;
  }
}

/** In-memory IndexedDB with the two indexes the sync uses. */
class FakeCache {
  stores = new Map<string, Map<string, Record<string, unknown>>>();
  private store(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return this.stores.get(name)!;
  }
  private keyOf(name: string, v: Record<string, unknown>) {
    return String(name === 'sync-metadata' ? v['key'] : v['uid']);
  }
  async getAllByIndex<T>(name: string, index: string, value: unknown) {
    return [...this.store(name).values()].filter((r) => r[index] === value) as T[];
  }
  async getByKey<T>(name: string, key: string) {
    return this.store(name).get(String(key)) as T | undefined;
  }
  async put<T>(name: string, v: T) {
    this.store(name).set(
      this.keyOf(name, v as Record<string, unknown>),
      v as Record<string, unknown>,
    );
    return v;
  }
  async putAll<T>(name: string, vs: T[]) {
    for (const v of vs) await this.put(name, v);
  }
  async delete(name: string, key: string) {
    this.store(name).delete(String(key));
  }
  ids() {
    return [...this.store('transactions').keys()].sort();
  }
}

describe('TransactionSyncService', () => {
  let remote: FakeRemote;
  let cache: FakeCache;
  let pendingDeletes: Set<string>;
  let online: ReturnType<typeof signal<boolean>>;
  let sync: TransactionSyncService;

  beforeEach(() => {
    remote = new FakeRemote();
    cache = new FakeCache();
    pendingDeletes = new Set();
    online = signal(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: TransactionRemote, useValue: remote },
        { provide: IndexedDbCacheService, useValue: cache },
        {
          provide: SyncQueueService,
          useValue: { pendingDeleteIdsForStore: async () => pendingDeletes },
        },
        { provide: NetworkService, useValue: { isOnline: online } },
        { provide: SyncLoggerService, useValue: { info() {}, warn() {}, debug() {}, error() {} } },
      ],
    });
    sync = TestBed.inject(TransactionSyncService);
  });

  it('bootstraps only the recent window and records that older history exists', async () => {
    remote.add('recent', monthsAgo(0, 1));
    remote.add('two-months', monthsAgo(2));
    remote.add('old', monthsAgo(6));

    await sync.ensureReady(ACCOUNT);

    expect(cache.ids()).toEqual(['recent', 'two-months']);
    const info = await sync.historyInfo(ACCOUNT);
    expect(info.complete).toBe(false);
    expect(info.loadedFrom).toEqual(new Date(now.getFullYear(), now.getMonth() - 2, 1));
  });

  it('bootstrap drops stale synced rows but keeps un-synced local writes', async () => {
    await cache.put('transactions', { uid: 'stale', accountId: ACCOUNT });
    await cache.put('transactions', { uid: 'offline-new', accountId: ACCOUNT, _pendingSync: true });
    remote.add('recent', monthsAgo(0, 1));

    await sync.ensureReady(ACCOUNT);

    expect(cache.ids()).toEqual(['offline-new', 'recent']);
  });

  it('catch-up reads only changes after the cursor and applies tombstones', async () => {
    remote.add('a', monthsAgo(0, 1));
    remote.add('b', monthsAgo(0, 2));
    await sync.ensureReady(ACCOUNT);
    remote.reads = 0;

    // Another device edits `a` and soft-deletes `b`.
    const later = new Date(Date.now() + 60_000);
    remote.add('a', monthsAgo(0, 1), later, { amount: 99 });
    remote.add('b', monthsAgo(0, 2), later, { deletedAt: Timestamp.fromDate(later) });
    await sync.syncOnce(ACCOUNT);

    expect(remote.reads).toBe(2); // just the two changed docs
    expect(cache.ids()).toEqual(['a']);
    expect((await cache.getByKey<{ amount: number }>('transactions', 'a'))?.amount).toBe(99);

    // Nothing changed since → a sync costs the 1-read minimum.
    remote.reads = 0;
    await sync.syncOnce(ACCOUNT);
    expect(remote.reads).toBe(1);
  });

  it('never overwrites a pending local edit or resurrects a queued delete', async () => {
    remote.add('edited', monthsAgo(0, 1));
    remote.add('deleted', monthsAgo(0, 2));
    await sync.ensureReady(ACCOUNT);
    await cache.put('transactions', {
      uid: 'edited',
      accountId: ACCOUNT,
      amount: 5,
      _pendingSync: true,
    });
    await cache.delete('transactions', 'deleted');
    pendingDeletes.add('deleted');

    const later = new Date(Date.now() + 60_000);
    remote.add('edited', monthsAgo(0, 1), later, { amount: 77 });
    remote.add('deleted', monthsAgo(0, 2), later, { amount: 1 });
    await sync.syncOnce(ACCOUNT);

    expect((await cache.getByKey<{ amount: number }>('transactions', 'edited'))?.amount).toBe(5);
    expect(cache.ids()).toEqual(['edited']);
  });

  it('lazy-loads older history page by page until complete', async () => {
    remote.add('recent', monthsAgo(0, 1));
    for (let i = 0; i < HISTORY_PAGE_SIZE + 5; i++) {
      remote.add(`old-${i}`, new Date(monthsAgo(4).getTime() - i * 60_000));
    }
    await sync.ensureReady(ACCOUNT);

    expect(await sync.loadOlder(ACCOUNT)).toBe(true);
    expect(cache.ids().length).toBe(1 + HISTORY_PAGE_SIZE);
    expect((await sync.historyInfo(ACCOUNT)).complete).toBe(false);

    expect(await sync.loadOlder(ACCOUNT)).toBe(true);
    expect(cache.ids().length).toBe(1 + HISTORY_PAGE_SIZE + 5);
    expect((await sync.historyInfo(ACCOUNT)).complete).toBe(true);
    expect(await sync.loadOlder(ACCOUNT)).toBe(false);
  });

  it('ensureHistorySince stops once the requested date is covered', async () => {
    remote.add('recent', monthsAgo(0, 1));
    remote.add('five', monthsAgo(5));
    remote.add('ten', monthsAgo(10));
    await sync.ensureReady(ACCOUNT);

    expect(await sync.ensureHistorySince(ACCOUNT, monthsAgo(4, 1))).toBe(true);
    expect(cache.ids()).toContain('five');

    expect(await sync.ensureHistorySince(ACCOUNT, null)).toBe(true);
    expect(cache.ids()).toContain('ten');
  });

  it('live listener applies changes and only advances the cursor on server snapshots', async () => {
    remote.add('a', monthsAgo(0, 1));
    await sync.ensureReady(ACCOUNT);
    const reattach = async () => {
      sync.stopLive();
      sync.startLive(ACCOUNT);
      await vi.waitFor(() => expect(remote.listener).not.toBeNull());
      return remote.listenCursor!.toMillis();
    };
    const cursorAtAttach = await reattach();

    const later = new Date(Date.now() + 60_000);
    remote.add('b', monthsAgo(0, 2), later);
    const b = remote.docs.find((d) => d.id === 'b')!;

    // SDK-cache snapshot: row applied, cursor unchanged.
    remote.listener!([{ type: 'added', doc: b }], true);
    await vi.waitFor(() => expect(cache.ids()).toEqual(['a', 'b']));
    expect(await reattach()).toBe(cursorAtAttach);

    // Server snapshot: cursor moves to the newest `updatedAt` seen.
    remote.listener!([{ type: 'modified', doc: b }], false);
    await vi.waitFor(async () => expect(await reattach()).toBe(later.getTime()));

    // A hard delete seen by the listener removes the local row.
    remote.listener!([{ type: 'removed', doc: b }], false);
    await vi.waitFor(() => expect(cache.ids()).toEqual(['a']));
  });

  it('does nothing offline and reports no loaded history', async () => {
    online.set(false);
    remote.add('a', monthsAgo(0, 1));

    await sync.ensureReady(ACCOUNT);
    expect(cache.ids()).toEqual([]);
    expect(await sync.ensureHistorySince(ACCOUNT, null)).toBe(false);
    expect(await sync.countLive(ACCOUNT)).toBe(0);
  });

  it('falls back to a full read when the composite index is missing', async () => {
    remote.add('recent', monthsAgo(0, 1));
    remote.add('old', monthsAgo(9));
    remote.createdSince = async () => {
      throw Object.assign(new Error('index'), { code: 'failed-precondition' });
    };

    await sync.ensureReady(ACCOUNT);

    expect(cache.ids()).toEqual(['old', 'recent']);
    expect((await sync.historyInfo(ACCOUNT)).complete).toBe(true);
  });
});
