import { Injectable, inject } from '@angular/core';
import { IndexedDbCacheService } from './indexed-db-cache.service';

/**
 * Per-store default TTL in milliseconds. A read within `[lastFetchedAt, lastFetchedAt + ttl]`
 * is served straight from the IndexedDB cache with **no Firestore round-trip**. A read after
 * that window falls back to network AND writes a fresh timestamp, so the next N calls in the
 * window are again free. Overridable per-call via `maxAgeMs`; `0` forces a network read.
 *
 * Numbers tuned to the fintrackr access patterns discussed in the sync/perf review:
 *   - **transactions**: 30s — dashboard + list + filter + post-write refetch collapse to 1 read.
 *   - **accounts / groups / group-expenses**: 60s — multi-user, but not chat-frequency.
 *   - **budgets / monthly-reports**: 60s — user-initiated changes invalidate on write anyway.
 *   - **categories / budgetPlans / goals / recurring**: 5m — near-static in practice.
 *   - **notifications**: 0 — has its own `onSnapshot` listener; SWR must not shadow it.
 */
const DEFAULT_STORE_TTL_MS: Record<string, number> = {
  transactions: 30_000,
  'recurring-transactions': 5 * 60_000,
  accounts: 60_000,
  categories: 5 * 60_000,
  budgets: 60_000,
  budgetPlans: 5 * 60_000,
  goals: 5 * 60_000,
  'monthly-reports': 60_000,
  groups: 60_000,
  'group-expenses': 60_000,
  'group-settlements': 60_000,
  notifications: 0,
};

/** Fallback for stores not enumerated above. Chosen conservatively short. */
const FALLBACK_TTL_MS = 30_000;

/** IndexedDB store where TTL rows live. Reused across the app; namespaced with `ttl:` prefix. */
const META_STORE = 'sync-metadata';
const KEY_PREFIX = 'ttl:';

/**
 * How long a fetch result is held in the in-memory burst memo. The old per-service memos
 * (5s accounts, 10s categories) existed to collapse the 13+/30+ synchronous call sites
 * that happen inside a single render into ONE IDB round-trip. The SWR layer alone brings
 * those back to N IDB reads per render; this memo restores the burst dedup without
 * holding stale data across navigations (invalidated on every write; auto-expires fast).
 */
const BURST_MEMO_MS = 500;

interface CacheMetaRow {
  /** `ttl:<store>:<scope>` — deterministic fingerprint. */
  key: string;
  /** Wall-clock ms of the last successful network fetch that reconciled this cache slice. */
  lastFetchedAt: number;
}

export type CacheScope =
  | { kind: 'all' }
  | { kind: 'index'; indexName: string; value: IDBValidKey }
  | { kind: 'doc'; id: string | number };

export interface ReadCachePolicy {
  /**
   * Override the store's default TTL for this call.
   *   - `undefined` → use the store default from `DEFAULT_STORE_TTL_MS`.
   *   - `0`         → force a network read (pull-to-refresh, post-mutation refetch).
   *   - a positive number → serve cache if last fetch is within this many ms.
   */
  maxAgeMs?: number;
  /**
   * Never touch the network for this call — serve whatever's in IndexedDB, even if stale.
   * Use inside aggregators like the report rebuilder where the underlying stores are already
   * being kept fresh elsewhere.
   */
  cacheOnly?: boolean;
}

/**
 * Stale-while-revalidate policy + cross-tab TTL bookkeeping for the offline layer.
 *
 * Backed by the `sync-metadata` IndexedDB store so TTL survives page reloads AND is shared
 * across tabs — tab B skips a fetch that tab A already did 10 seconds ago. Also owns an
 * in-memory promise map to dedupe **concurrent** revalidations (e.g. dashboard + widget
 * both calling `getTransactions()` in the same tick).
 *
 * Ownership: only the offline-crud layer talks to this service. Feature services opt into
 * the SWR contract by passing a {@link ReadCachePolicy} down through their fetch calls.
 */
@Injectable({ providedIn: 'root' })
export class CachePolicyService {
  private readonly cache = inject(IndexedDbCacheService);

  /** Dedupe concurrent background revalidations for the same fingerprint. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Per-store monotonic epoch. Incremented every time the store is invalidated (i.e. a
   * local write). Callers `snapshotEpoch(store)` BEFORE starting a network read and pass
   * it to `markFresh`; if the epoch has moved, `markFresh` no-ops. This closes the race
   * where a user write during an in-flight revalidation would be silently reverted by
   * the trailing `markFresh` stamping a fresh TS on top of the invalidated row.
   *
   * In-memory only. If the tab crashes mid-revalidate we lose the counter, but the next
   * read simply finds no fresh row and hits network — same fail-safe as the base design.
   */
  private readonly storeEpochs = new Map<string, number>();

  /**
   * Short-lived (~{@link BURST_MEMO_MS}) in-memory value cache to collapse the 13+/30+
   * synchronous call sites `getCategories()`/`getSelectedAccount()` fire inside a single
   * render. Keyed by the same fingerprint used for TTL; cleared by `invalidateStore` so
   * a local write is never shadowed. Do NOT rely on this beyond a burst window — TTL
   * remains the source of truth for cross-tab / cross-session freshness.
   */
  private readonly burstMemo = new Map<string, { at: number; value: unknown }>();

  /** Deterministic cache-key fingerprint. Callers pass a `CacheScope`; we serialize. */
  cacheKey(storeName: string, scope: CacheScope = { kind: 'all' }): string {
    switch (scope.kind) {
      case 'all':
        return `${KEY_PREFIX}${storeName}:all`;
      case 'index':
        return `${KEY_PREFIX}${storeName}:idx:${scope.indexName}=${String(scope.value)}`;
      case 'doc':
        return `${KEY_PREFIX}${storeName}:doc:${String(scope.id)}`;
    }
  }

  /** Effective TTL after `maxAgeMs` override, clamped to `>= 0`. */
  ttlFor(storeName: string, maxAgeMs?: number): number {
    if (typeof maxAgeMs === 'number') return Math.max(0, maxAgeMs);
    return DEFAULT_STORE_TTL_MS[storeName] ?? FALLBACK_TTL_MS;
  }

  /**
   * Fresh iff a timestamp exists AND `now - lastFetchedAt < ttl`. A missing row is
   * treated as infinitely stale so first-ever reads always hit network when online.
   */
  async isFresh(key: string, ttlMs: number): Promise<boolean> {
    if (ttlMs <= 0) return false;
    const row = await this.cache.getByKey<CacheMetaRow>(META_STORE, key);
    if (!row || typeof row.lastFetchedAt !== 'number') return false;
    return Date.now() - row.lastFetchedAt < ttlMs;
  }

  /**
   * Snapshot the current epoch for `storeName` BEFORE starting a network read. Pass the
   * returned value to `markFresh` — if `invalidateStore(storeName)` runs while your
   * revalidation is in flight, the epoch will have moved and `markFresh` will no-op,
   * preserving the invalidation so the next read still hits network.
   */
  snapshotEpoch(storeName: string): number {
    return this.storeEpochs.get(storeName) ?? 0;
  }

  /**
   * Stamp a successful network read so subsequent reads in the TTL window skip Firestore.
   * If `epochAtStart` is provided and the store's epoch has moved since (i.e. a local
   * write invalidated the store while we were fetching), this call is a no-op — honoring
   * the invalidation over the stale-by-a-moment revalidation result.
   */
  async markFresh(key: string, storeName?: string, epochAtStart?: number): Promise<void> {
    if (
      storeName !== undefined &&
      epochAtStart !== undefined &&
      this.snapshotEpoch(storeName) !== epochAtStart
    ) {
      return; // invalidation raced this revalidation — do not re-freshen
    }
    await this.cache.put<CacheMetaRow>(META_STORE, { key, lastFetchedAt: Date.now() });
  }

  /**
   * Force the next read for this fingerprint to hit the network by dropping its TTL row.
   * Call after every local mutation so the user sees their own change reflected without
   * waiting for the TTL to expire.
   */
  async invalidate(key: string): Promise<void> {
    this.burstMemo.delete(key);
    await this.cache.delete(META_STORE, key);
  }

  /**
   * Invalidate every fingerprint for a store (all scopes: list, index-scoped, single-doc).
   * Used on writes where we don't know which scoped views the app has cached (e.g. an update
   * to `transactions` should invalidate the account-scoped list AND the by-id doc entry).
   *
   * Also bumps the store's epoch — any in-flight revalidation started before this call
   * will find its epoch stale on completion and skip `markFresh`, so the invalidation
   * survives the race — AND drops matching burst-memo entries so a subsequent read sees
   * the local write reflected within the same 500ms burst window.
   */
  async invalidateStore(storeName: string): Promise<void> {
    this.storeEpochs.set(storeName, this.snapshotEpoch(storeName) + 1);
    const prefix = `${KEY_PREFIX}${storeName}:`;
    for (const k of this.burstMemo.keys()) {
      if (k.startsWith(prefix)) this.burstMemo.delete(k);
    }
    const all = await this.cache.getAll<CacheMetaRow>(META_STORE);
    await Promise.all(
      all.filter((r) => typeof r?.key === 'string' && r.key.startsWith(prefix)).map((r) =>
        this.cache.delete(META_STORE, r.key),
      ),
    );
  }

  /** Retrieve a still-warm burst value for `key`, if any. Returns `undefined` past the window. */
  getBurst<T>(key: string): T | undefined {
    const hit = this.burstMemo.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= BURST_MEMO_MS) {
      this.burstMemo.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  /**
   * Store the just-returned value for burst dedup. Skip when the caller wants network
   * freshness (`maxAgeMs === 0`) — those calls are already the fresh-source-of-truth so
   * memoizing them briefly is fine; but skip when the value shouldn't be shared (e.g. a
   * `_pendingSync` short-circuit in `fetchOne`, which reflects local write state).
   */
  putBurst<T>(key: string, value: T): void {
    this.burstMemo.set(key, { at: Date.now(), value });
  }

  /**
   * Dedupe concurrent revalidations. If another caller is already fetching `key`, wait on
   * their promise; otherwise register and run `run`. Cleans up the map on settle so failed
   * fetches don't poison future reads.
   */
  async coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = (async () => {
      try {
        return await run();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }
}
