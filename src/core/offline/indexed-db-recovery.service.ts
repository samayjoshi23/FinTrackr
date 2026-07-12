import { Injectable } from '@angular/core';
import { indexedDbConfig } from './indexed-db.config';

/**
 * Self-healing for the local IndexedDB (`FinTrackrDB`).
 *
 * ngx-indexed-db opens the DB at a **fixed** `version` (see {@link indexedDbConfig})
 * on every operation. Two structural faults make every one of those opens throw,
 * which is what breaks reads across the whole app (accounts, transactions, …):
 *
 *   1. **VersionError** — the browser already holds `FinTrackrDB` at a version
 *      *higher* than the configured one (e.g. left behind by an older/newer deploy).
 *      `indexedDB.open(name, 7)` can only ever fail against a v8+ database.
 *   2. **Missing object stores** — the DB is at the configured version but an
 *      expected store is absent (interrupted schema upgrade / corruption), so reads
 *      reject with NotFoundError.
 *
 * The {@link IndexedDbCacheService} already degrades these to a cache miss so the
 * app keeps working off Firestore. This service goes one step further and *repairs*
 * the root fault: it deletes the broken database so ngx-indexed-db recreates a clean
 * one at the configured version on the next load, after which the Firestore fallback
 * repopulates it.
 *
 * Deletion requires a page reload (ngx recreates the schema only when it re-opens),
 * so a localStorage-backed cooldown guards against reload loops: if a fresh load is
 * still faulty within {@link COOLDOWN_MS}, we stop healing and fall back to graceful
 * degradation instead of reloading forever.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbRecoveryService {
  private readonly dbName = indexedDbConfig.name;
  private readonly expectedVersion = indexedDbConfig.version ?? 1;
  private readonly expectedStores = indexedDbConfig.objectStoresMeta.map((s) => s.store);

  /** localStorage key holding the last recovery attempt timestamp (reload-loop guard). */
  private static readonly GUARD_KEY = 'fintrackr:idb-recovery';
  /** Don't attempt another delete+reload within this window of the previous one. */
  private static readonly COOLDOWN_MS = 60_000;

  private recovering = false;

  private get available(): boolean {
    return typeof indexedDB !== 'undefined' && !!indexedDB;
  }

  /**
   * Startup probe — run before ngx-indexed-db touches the DB (see the app initializer
   * in `app.config.ts`). Inspects the on-disk database and, if it is structurally
   * broken, deletes it and reloads so a clean one is built.
   *
   * @returns `true` if recovery was triggered (a reload is pending — the caller should
   *   not continue initialising). `false` when the DB is healthy or unavailable.
   */
  async checkAndRecover(): Promise<boolean> {
    if (!this.available) return false;

    let fault: string | null = null;
    try {
      const info = await this.inspect();
      if (info === 'missing') {
        // No DB yet (fresh install / already deleted) — ngx will build it cleanly.
      } else if (info.version > this.expectedVersion) {
        fault = `existing version ${info.version} is higher than configured ${this.expectedVersion} (VersionError)`;
      } else if (info.version === this.expectedVersion && !this.hasAllStores(info.stores)) {
        fault = `object store(s) missing at version ${info.version}: [${this.missingStores(info.stores).join(', ')}]`;
      }
    } catch (err) {
      // Couldn't even open the DB to inspect it → treat as corrupt.
      fault = `could not open database for inspection: ${this.describe(err)}`;
    }

    if (!fault) {
      this.clearGuard(); // healthy load → reset the reload-loop guard
      return false;
    }
    return this.recover(fault);
  }

  /**
   * Reactive entry point for {@link IndexedDbCacheService}: delete + reload when a
   * live operation hits a structural fault mid-session. No-ops (returns `false`)
   * while already recovering or inside the cooldown window.
   */
  async recover(reason: string): Promise<boolean> {
    if (this.recovering || !this.available) return false;

    if (!this.canAttempt()) {
      console.warn(
        `IndexedDbRecoveryService: fault detected (${reason}) but a recovery was attempted recently — ` +
          `skipping reload to avoid a loop; app continues on the Firestore fallback.`,
      );
      return false;
    }

    this.recovering = true;
    this.markAttempt(reason);
    console.warn(
      `IndexedDbRecoveryService: structural fault in "${this.dbName}" (${reason}). ` +
        `Deleting the local database and reloading to self-heal…`,
    );

    try {
      await this.deleteDatabase();
    } catch (err) {
      console.warn('IndexedDbRecoveryService: deleteDatabase failed', err);
    }

    // ngx-indexed-db only (re)builds the schema when it re-opens the DB, which happens
    // on a fresh page load. Reload so the clean DB is created at the configured version.
    location.reload();
    return true;
  }

  /** Heuristic: does this error look like a structural IndexedDB fault worth healing? */
  isStructuralFault(err: unknown): boolean {
    const hay = this.describe(err).toLowerCase();
    return [
      'versionerror',
      'notfounderror',
      'invalidstateerror',
      'was not found',
      'not initialized',
      'is not a known object store',
      'object store',
    ].some((needle) => hay.includes(needle));
  }

  // ─── Internals ──────────────────────────────────────────────────

  /**
   * Read the current version + object stores of `FinTrackrDB` without side effects.
   * Uses `indexedDB.databases()` (when available) to avoid materialising a database
   * that doesn't exist; otherwise opens without a version and cleans up if the open
   * ended up creating an empty DB.
   */
  private inspect(): Promise<'missing' | { version: number; stores: string[] }> {
    return (async () => {
      if (typeof indexedDB.databases === 'function') {
        try {
          const dbs = await indexedDB.databases();
          if (!dbs.some((d) => d.name === this.dbName)) return 'missing';
        } catch {
          /* fall through to open-based inspection */
        }
      }

      return new Promise<'missing' | { version: number; stores: string[] }>((resolve, reject) => {
        const req = indexedDB.open(this.dbName);
        let createdByProbe = false;

        req.onupgradeneeded = (event) => {
          // oldVersion === 0 means the DB didn't exist and this open just created it.
          if ((event.oldVersion ?? 0) === 0) createdByProbe = true;
        };
        req.onsuccess = () => {
          const db = req.result;
          const version = db.version;
          const stores = Array.from(db.objectStoreNames);
          db.close();
          if (createdByProbe) {
            // Undo the empty DB our probe accidentally created so ngx builds it fresh.
            indexedDB.deleteDatabase(this.dbName);
            resolve('missing');
          } else {
            resolve({ version, stores });
          }
        };
        req.onerror = () => reject(req.error ?? new Error('open failed'));
        req.onblocked = () => reject(new Error('open blocked'));
      });
    })();
  }

  private deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
      // Another tab/connection is holding the DB open. The delete is deferred until
      // those close — which our own reload will do — so resolve and let the reload run.
      req.onblocked = () => resolve();
    });
  }

  private hasAllStores(stores: string[]): boolean {
    return this.expectedStores.every((s) => stores.includes(s));
  }

  private missingStores(stores: string[]): string[] {
    return this.expectedStores.filter((s) => !stores.includes(s));
  }

  private canAttempt(): boolean {
    try {
      const raw = localStorage.getItem(IndexedDbRecoveryService.GUARD_KEY);
      if (!raw) return true;
      const { at } = JSON.parse(raw) as { at?: number };
      return typeof at !== 'number' || Date.now() - at > IndexedDbRecoveryService.COOLDOWN_MS;
    } catch {
      return true;
    }
  }

  private markAttempt(reason: string): void {
    try {
      localStorage.setItem(
        IndexedDbRecoveryService.GUARD_KEY,
        JSON.stringify({ at: Date.now(), reason }),
      );
    } catch {
      /* localStorage unavailable (private mode / disabled) — proceed without the guard */
    }
  }

  private clearGuard(): void {
    try {
      localStorage.removeItem(IndexedDbRecoveryService.GUARD_KEY);
    } catch {
      /* ignore */
    }
  }

  private describe(err: unknown): string {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    const e = err as { name?: string; message?: string };
    return [e.name, e.message].filter(Boolean).join(': ') || String(err);
  }
}
