import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  onSnapshot,
  DocumentData,
  Query,
} from '@angular/fire/firestore';
import { NetworkService } from './network.service';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { SyncQueueService } from './sync-queue.service';
import { PostSyncCallable } from './sync-queue.model';
import { CachePolicyService, CacheScope, ReadCachePolicy } from './cache-policy.service';

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
  private readonly policy = inject(CachePolicyService);

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
   * READ list — **stale-while-revalidate with per-store TTL.**
   *
   * Behavior matrix:
   *   - **Offline** → serve IndexedDB, no revalidation attempt.
   *   - **`cacheOnly: true`** → serve IndexedDB unconditionally (aggregators / bulk report
   *     rebuilds should not re-hit Firestore for data that's already being kept fresh).
   *   - **Online + fresh** (last network read within TTL) → serve IndexedDB, no round-trip.
   *   - **Online + stale** → serve IndexedDB immediately AND kick off a background revalidation.
   *     When it lands, `revalidationCounts[storeName]` bumps and feature-service effects
   *     re-hydrate their signals so the UI updates.
   *
   * The TTL row lives in the `sync-metadata` IndexedDB store, so freshness survives page
   * reloads AND is shared across tabs. Concurrent callers for the same fingerprint share
   * one in-flight promise (see {@link CachePolicyService.coalesce}), so a dashboard mount
   * + list mount + widget refresh in the same tick collapse to a single Firestore query.
   *
   * On a Firestore error the cause is logged (esp. `permission-denied`) and the current
   * cache slice is what the UI keeps showing — no blanking.
   */
  async fetchAll<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter?: { indexName: string; value: IDBValidKey },
    policy?: ReadCachePolicy,
  ): Promise<T[]> {
    const scope: CacheScope = indexFilter
      ? { kind: 'index', indexName: indexFilter.indexName, value: indexFilter.value }
      : { kind: 'all' };
    const key = this.policy.cacheKey(storeName, scope);
    const ttl = this.policy.ttlFor(storeName, policy?.maxAgeMs);

    // Burst dedup — collapses the many synchronous call sites (e.g. `getCategories()` fired
    // 13+ times per render) into a single IDB round-trip. Bypass on force-refresh so
    // `maxAgeMs: 0` always hits the network.
    if (policy?.maxAgeMs !== 0) {
      const memoed = this.policy.getBurst<T[]>(key);
      if (memoed !== undefined) return memoed;
    }

    if (policy?.cacheOnly || !this.network.isOnline()) {
      const rows = await this.readFromCache<T>(storeName, indexFilter);
      this.policy.putBurst(key, rows);
      return rows;
    }

    const fresh = await this.policy.isFresh(key, ttl);
    if (fresh) {
      const rows = await this.readFromCache<T>(storeName, indexFilter);
      this.policy.putBurst(key, rows);
      return rows;
    }

    // Stale + online: return cached NOW, revalidate in background. If the caller
    // explicitly asked for `maxAgeMs: 0` (pull-to-refresh / post-write refetch) we still
    // want to AWAIT the network read — that's the whole point of the override. An
    // EMPTY slice is awaited too: on a device's first visit there's nothing to show
    // yet, and one-shot readers would otherwise render "no data" and never update.
    const revalidate = () =>
      this.policy.coalesce(key, () => this.revalidateList(storeName, firestoreFn, indexFilter, key));
    const cachedRows = await this.readFromCache<T>(storeName, indexFilter);

    if (policy?.maxAgeMs === 0 || cachedRows.length === 0) {
      try {
        await revalidate();
      } catch {
        /* revalidateList already logged and swallowed; fall through to cache read */
      }
      const rows = await this.readFromCache<T>(storeName, indexFilter);
      this.policy.putBurst(key, rows);
      return rows;
    }

    void revalidate();
    this.policy.putBurst(key, cachedRows);
    return cachedRows;
  }

  /**
   * Background revalidation body extracted so both blocking + non-blocking paths share it.
   * Snapshots the store's epoch BEFORE the network call so a racing local-write invalidation
   * makes `markFresh` no-op — preserving the invalidation instead of silently re-freshening
   * the cache on top of it.
   */
  private async revalidateList<T>(
    storeName: string,
    firestoreFn: () => Promise<T[]>,
    indexFilter: { indexName: string; value: IDBValidKey } | undefined,
    key: string,
  ): Promise<void> {
    const epochAtStart = this.policy.snapshotEpoch(storeName);
    try {
      const results = await this.withTimeout(firestoreFn());
      await this.replaceCache(storeName, results, indexFilter);
      await this.policy.markFresh(key, storeName, epochAtStart);
      this.emitRefreshed(storeName);
    } catch (e) {
      this.logReadError(storeName, e);
    }
  }

  /**
   * Subscribe to a Firestore Query and stream every server-side change into the local
   * cache using the same reconciliation path as SWR reads. This is the "real-time
   * listener" that closes the cross-device sync-lag gap SWR alone introduces —
   * particularly for shared-account transactions / budgets.
   *
   * Composition with SWR:
   *   1. On every server snapshot, `replaceCache` reconciles rows (preserving un-synced
   *      local writes and pending deletes) and `emitRefreshed` bumps the store's
   *      revalidation counter so feature-service effects re-hydrate.
   *   2. `markFresh` stamps a fresh TTL so subsequent `fetchAll` calls during the
   *      listener's lifetime skip Firestore entirely — the listener now owns freshness.
   *   3. Snapshots with `metadata.fromCache: true` are IGNORED — SWR already handles
   *      local reads via IndexedDB; the listener's job is to reflect SERVER truth.
   *      This also avoids a loop with our own optimistic writes.
   *
   * Returns the unsubscribe function. Callers MUST call it on account switch / group
   * close / logout — otherwise listeners leak and quota keeps ticking.
   *
   * @param indexFilter same shape as `fetchAll` — needed so `replaceCache` scopes
   *   the reconciliation to the same slice the query returned. MUST match the query's
   *   `where(...)` filter or you'll prune rows the query didn't cover.
   */
  subscribeQuery<T>(
    storeName: string,
    q: Query<DocumentData>,
    mapper: (id: string, data: DocumentData) => T,
    indexFilter?: { indexName: string; value: IDBValidKey },
  ): () => void {
    const scope: CacheScope = indexFilter
      ? { kind: 'index', indexName: indexFilter.indexName, value: indexFilter.value }
      : { kind: 'all' };
    const key = this.policy.cacheKey(storeName, scope);
    // We deliberately do NOT ask for metadata changes — `includeMetadataChanges: true`
    // fires extra events for pending-write state transitions we already track via the
    // sync queue and `_pendingSync` flag.
    const unsub = onSnapshot(
      q,
      // includeMetadataChanges:false → we only get callbacks when DATA changes, not
      // metadata alone. That's what makes it safe to consume every snapshot:
      //   - Firestore SDK persistent cache may emit an initial `fromCache: true`
      //     snapshot with the same data the server would return. Skipping it (an
      //     earlier design) meant `markFresh` never ran when the cache was already
      //     warm — the store's TTL stayed stale for the entire listener session.
      //   - Our own optimistic writes go through `setDoc`, which triggers the
      //     listener with the row we just wrote. `replaceCache` respects
      //     `_pendingSync: true` on the local IDB row, so an echo cannot clobber
      //     an in-flight local write. Redundant IDB writes here are trivial.
      { includeMetadataChanges: false },
      (snap) => {
        const results = snap.docs.map((d) => mapper(d.id, d.data()));
        void (async () => {
          await this.replaceCache(storeName, results, indexFilter);
          // Safe with no epoch guard: a concurrent local write invalidates the
          // store on its own path (`create`/`update`/`remove` → `invalidateStore`),
          // and the next snapshot after the server accepts it overwrites this.
          await this.policy.markFresh(key);
          this.emitRefreshed(storeName);
        })();
      },
      (err) => this.logReadError(storeName, err),
    );
    return unsub;
  }

  /**
   * READ single — SWR (same policy layer as {@link fetchAll}).
   *
   *   - Offline / `cacheOnly` → return the cache row (or `null`), no network.
   *   - Pending-delete for this id → `null` (do not resurrect an offline-deleted row).
   *   - Local `_pendingSync: true` → return the local row (server may still hold an older
   *     version until the sync queue drains).
   *   - Fresh within TTL → return the cache row.
   *   - Stale + online → return cache immediately AND revalidate in background. If the
   *     caller passed `maxAgeMs: 0`, block on the network read and return that.
   *
   * Contract preserved: any Firestore error degrades to the cached value or `null`, so
   * no caller has to handle a new throw.
   */
  async fetchOne<T>(
    storeName: string,
    key: string | number,
    firestoreFn: () => Promise<T | null>,
    policy?: ReadCachePolicy,
  ): Promise<T | null> {
    const fingerprint = this.policy.cacheKey(storeName, { kind: 'doc', id: key });

    // Burst dedup for repeat calls within ~500ms. Bypass on force-refresh.
    if (policy?.maxAgeMs !== 0) {
      const memoed = this.policy.getBurst<T | null>(fingerprint);
      if (memoed !== undefined) return memoed;
    }

    const cachedRow = await this.cache.getByKey<Record<string, unknown>>(storeName, key);

    if (policy?.cacheOnly || !this.network.isOnline()) {
      const out = ((cachedRow as T) ?? null);
      this.policy.putBurst(fingerprint, out);
      return out;
    }
    // The two short-circuits below reflect local-write state that another caller in the
    // burst window MUST NOT share (e.g. one call deletes, next call within 500ms would
    // otherwise see the pre-delete cached row). Do NOT burst-cache these paths.
    if ((await this.syncQueue.pendingDeleteIdsForStore(storeName)).has(String(key))) {
      return null;
    }
    if (cachedRow?.['_pendingSync'] === true) {
      return cachedRow as T;
    }

    const ttl = this.policy.ttlFor(storeName, policy?.maxAgeMs);
    const fresh = await this.policy.isFresh(fingerprint, ttl);
    if (fresh) {
      const out = ((cachedRow as T) ?? null);
      this.policy.putBurst(fingerprint, out);
      return out;
    }

    const revalidate = () =>
      this.policy.coalesce(fingerprint, () => this.revalidateOne(storeName, key, firestoreFn, fingerprint));

    // Cache miss → await the network (see `fetchAll`): returning `null` here made
    // one-shot readers show "not set" on a device's first visit.
    if (policy?.maxAgeMs === 0 || !cachedRow) {
      try {
        const out = await revalidate();
        this.policy.putBurst(fingerprint, out);
        return out;
      } catch {
        return ((await this.cache.getByKey<T>(storeName, key)) as T) ?? null;
      }
    }

    void revalidate();
    const out = ((cachedRow as T) ?? null);
    this.policy.putBurst(fingerprint, out);
    return out;
  }

  /**
   * Background single-doc revalidation body shared by blocking + non-blocking paths.
   * Snapshots the store epoch so a racing local write's invalidation can't be silently
   * clobbered by our trailing `markFresh` — see {@link revalidateList}.
   */
  private async revalidateOne<T>(
    storeName: string,
    key: string | number,
    firestoreFn: () => Promise<T | null>,
    fingerprint: string,
  ): Promise<T | null> {
    const epochAtStart = this.policy.snapshotEpoch(storeName);
    try {
      const result = await this.withTimeout(firestoreFn());
      if (result) {
        await this.cache.put(storeName, result);
      } else {
        await this.cache.delete(storeName, key);
      }
      await this.policy.markFresh(fingerprint, storeName, epochAtStart);
      this.emitRefreshed(storeName);
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
    // Do NOT re-fetch — the cache row we just wrote IS the local truth. But DO invalidate
    // the store's TTL so the next SWR read for this store is allowed to hit network and
    // pick up other devices' concurrent writes. Without this, a user who adds a row
    // wouldn't see other devices' additions for up to the TTL window.
    await this.policy.invalidateStore(storeName);

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
    // See {@link create} for the invalidation rationale.
    await this.policy.invalidateStore(storeName);

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
    // See {@link create} for the invalidation rationale.
    await this.policy.invalidateStore(storeName);

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
    // See {@link create} for the invalidation rationale.
    await this.policy.invalidateStore(storeName);

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
