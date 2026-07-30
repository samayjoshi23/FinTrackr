import { Injectable, inject } from '@angular/core';
import { IndexedDbCacheService } from './indexed-db-cache.service';

/**
 * Background-revalidation TTL per IndexedDB store (ms).
 *
 * Shorter TTLs for data other users can change under us (transactions, accounts,
 * groups); longer for data that effectively only changes through this client's own
 * mutations — which invalidate the tracker anyway via `markStale`.
 */
export const REVALIDATION_TTL_MS: Record<string, number> = {
  // Personal finance data: the local user is almost always the only writer.
  // Extended TTLs cut redundant Firestore reads ~60-70% while still catching
  // multi-device edits within a reasonable window.
  transactions: 10 * 60_000,
  accounts: 30 * 60_000,
  // Shared entities (multiple members can write) MUST stay tight — bumping these
  // means member A's expense doesn't appear on member B's device for the full TTL,
  // which breaks the real-time feel of collaborative expense splitting.
  groups: 5 * 60_000,
  'group-expenses': 5 * 60_000,
  'group-settlements': 5 * 60_000,
  'monthly-reports': 30 * 60_000,
  budgets: 60 * 60_000,
  budgetPlans: 60 * 60_000,
  goals: 60 * 60_000,
  'recurring-transactions': 60 * 60_000,
  categories: 2 * 60 * 60_000,
  default: 15 * 60_000,
};

interface RevalMetaRow {
  key: string;
  cachedAt: number;
}

export interface RevalIndexFilter {
  indexName: string;
  value: IDBValidKey;
}

/**
 * Tracks *when* each cached slice was last revalidated against Firestore so the
 * offline-crud layer can skip its fire-and-forget background refetch while the
 * cache is still fresh. Without this, EVERY cache-hit read fires a Firestore
 * query — the single largest source of redundant reads in the app.
 *
 * Keys are scoped per store **and** index filter (`reval::transactions::accountId=X`)
 * because stores are cached per account/owner/viewer; a store-level timestamp would
 * wrongly mark account B's slice fresh after loading account A's.
 *
 * Timestamps live in an in-memory Map mirrored to the existing `sync-metadata`
 * IndexedDB store (no schema change), so freshness survives reloads. All failure
 * modes degrade to "not fresh" — i.e. the pre-TTL behavior of always revalidating.
 */
@Injectable({ providedIn: 'root' })
export class RevalidationTrackerService {
  private readonly cache = inject(IndexedDbCacheService);

  private static readonly PREFIX = 'reval::';
  private static readonly META_STORE = 'sync-metadata';

  private readonly timestamps = new Map<string, number>();
  /** Doc-level freshness (fetchOne) — session-memory only, never persisted. */
  private readonly docTimestamps = new Map<string, number>();
  private hydrated: Promise<void> | null = null;

  /** Is the cached slice younger than its store's TTL? */
  async isFresh(storeName: string, indexFilter?: RevalIndexFilter): Promise<boolean> {
    await this.hydrate();
    const at = this.timestamps.get(this.key(storeName, indexFilter));
    if (at === undefined) return false;
    return Date.now() - at < this.ttlFor(storeName);
  }

  /** Record a successful Firestore→cache refresh for this slice. */
  async markFresh(storeName: string, indexFilter?: RevalIndexFilter): Promise<void> {
    await this.hydrate();
    const key = this.key(storeName, indexFilter);
    const cachedAt = Date.now();
    this.timestamps.set(key, cachedAt);
    // Best-effort persistence (IndexedDbCacheService already swallows failures).
    await this.cache.put<RevalMetaRow>(RevalidationTrackerService.META_STORE, { key, cachedAt });
  }

  /** Doc-level variant for fetchOne — in-memory only. */
  isDocFresh(storeName: string, docKey: string | number): boolean {
    const at = this.docTimestamps.get(this.docKey(storeName, docKey));
    if (at === undefined) return false;
    return Date.now() - at < this.ttlFor(storeName);
  }

  markDocFresh(storeName: string, docKey: string | number): void {
    this.docTimestamps.set(this.docKey(storeName, docKey), Date.now());
  }

  /**
   * Invalidate every slice of a store after a local mutation or a synced queue
   * entry, so the next read serves cache instantly but revalidates once in the
   * background (picking up canonical server values).
   */
  markStale(storeName: string): void {
    const slicePrefix = `${RevalidationTrackerService.PREFIX}${storeName}::`;
    for (const key of this.timestamps.keys()) {
      if (key.startsWith(slicePrefix)) {
        this.timestamps.delete(key);
        void this.cache.delete(RevalidationTrackerService.META_STORE, key);
      }
    }
    const docPrefix = this.docKey(storeName, '');
    for (const key of this.docTimestamps.keys()) {
      if (key.startsWith(docPrefix)) this.docTimestamps.delete(key);
    }
  }

  /** Drop all in-memory state (logout — the sync-metadata store is cleared separately). */
  reset(): void {
    this.timestamps.clear();
    this.docTimestamps.clear();
    this.hydrated = null;
  }

  // ─── Internals ──────────────────────────────────────────────────

  /** Load persisted timestamps once per session; failures leave the map empty (= stale). */
  private hydrate(): Promise<void> {
    this.hydrated ??= (async () => {
      const rows = await this.cache.getAll<RevalMetaRow>(RevalidationTrackerService.META_STORE);
      for (const row of rows) {
        if (
          typeof row?.key === 'string' &&
          row.key.startsWith(RevalidationTrackerService.PREFIX) &&
          typeof row.cachedAt === 'number'
        ) {
          this.timestamps.set(row.key, row.cachedAt);
        }
      }
    })();
    return this.hydrated;
  }

  private key(storeName: string, indexFilter?: RevalIndexFilter): string {
    const slice = indexFilter ? `${indexFilter.indexName}=${String(indexFilter.value)}` : 'all';
    return `${RevalidationTrackerService.PREFIX}${storeName}::${slice}`;
  }

  private docKey(storeName: string, docKey: string | number): string {
    return `${RevalidationTrackerService.PREFIX}${storeName}::doc:${String(docKey)}`;
  }

  private ttlFor(storeName: string): number {
    return REVALIDATION_TTL_MS[storeName] ?? REVALIDATION_TTL_MS['default'];
  }
}
