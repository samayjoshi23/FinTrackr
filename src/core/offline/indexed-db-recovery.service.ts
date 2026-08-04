import { Injectable } from '@angular/core';
import { indexedDbConfig } from './indexed-db.config';

/** On-disk shape of the DB, as read by the side-effect-free {@link inspect} probe. */
interface DbShape {
  version: number;
  stores: string[];
  /** index names keyed by store name */
  indexes: Record<string, string[]>;
}

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

  /** Live configured version — mutated by {@link alignConfigVersion} so ngx opens at the repaired version. */
  private get expectedVersion(): number {
    return indexedDbConfig.version ?? 1;
  }

  /** localStorage key holding the last recovery attempt timestamp (reload-loop guard). */
  private static readonly GUARD_KEY = 'fintrackr:idb-recovery';
  /** Don't attempt another delete+reload within this window of the previous one. */
  private static readonly COOLDOWN_MS = 60_000;

  private recovering = false;

  /** Coalesces concurrent mid-session in-place repairs onto one in-flight attempt. */
  private repairInFlight: Promise<boolean> | null = null;

  private get available(): boolean {
    return typeof indexedDB !== 'undefined' && !!indexedDB;
  }

  /**
   * Startup barrier — MUST run and be awaited before ngx-indexed-db opens the DB
   * (see the app initializer in `app.config.ts`). It brings the on-disk schema up to
   * {@link indexedDbConfig} **in place**: any missing object store or index is created
   * via a synchronous `onupgradeneeded`, preserving existing cached rows. No reload,
   * no wipe, no user action — the common failure modes (a store/index missing after a
   * deploy) self-heal silently on the very next load.
   *
   * Delete + reload is now a genuine last resort, used only when the DB is a *newer*
   * version than this build and is missing something we need (an unclean rollback), or
   * when it can't be opened at all (corruption). A blocked open (another tab holds an
   * older version) is left alone: the app runs on the Firestore fallback this load and
   * repairs itself once the other tab closes — never a reload loop.
   *
   * @returns `true` only if a delete+reload was triggered (boot should stop). `false`
   *   when the schema is healthy, was repaired in place, or we degraded gracefully.
   */
  async checkAndRecover(): Promise<boolean> {
    if (!this.available) return false;

    try {
      const outcome = await this.ensureSchema();
      if (outcome === 'unrepairable') {
        // Newer-than-code DB missing a store/index we need — can't downgrade to repair.
        return this.recover('on-disk schema is newer than this build and missing required stores');
      }
      this.clearGuard(); // healthy / repaired in place → reset the reload-loop guard
      return false;
    } catch (err) {
      if (this.isBlocked(err)) {
        console.warn(
          `IndexedDbRecoveryService: schema check blocked by another open connection ` +
            `(${this.describe(err)}). Skipping repair this load; the app runs on the Firestore ` +
            `fallback and heals once the other tab/window closes.`,
        );
        return false;
      }
      // Couldn't open the DB at all → treat as corrupt; last-resort delete+reload.
      return this.recover(`could not open database to repair schema: ${this.describe(err)}`);
    }
  }

  /**
   * Bring the on-disk schema up to the configured one without destroying data.
   *
   * Returns:
   *  - `'fresh'`      — no DB yet; ngx will build a clean one at the configured version.
   *  - `'ok'`         — already complete at (or compatibly above) the configured version.
   *  - `'repaired'`   — created the missing stores/indexes via an in-place upgrade.
   *  - `'unrepairable'` — DB is a newer version than this build AND missing something we
   *                       need; can't be fixed by upgrading, so the caller falls back to
   *                       delete+reload.
   *
   * Throws only if the DB can't be inspected/opened (corruption, or a blocked open).
   */
  async ensureSchema(): Promise<'fresh' | 'ok' | 'repaired' | 'unrepairable'> {
    const probe = await this.inspect();
    if (probe === 'missing') return 'fresh';

    const missing = this.computeMissing(probe.stores, probe.indexes);
    const needsRepair = missing.stores.length > 0 || missing.indexCount > 0;
    const configured = this.expectedVersion;

    if (probe.version > configured) {
      // DB was written by a newer build. If it already has everything this build needs,
      // just let ngx open at the existing higher version (opening at `configured` would
      // throw VersionError). Otherwise we can't downgrade to add stores → last resort.
      if (!needsRepair) {
        this.alignConfigVersion(probe.version);
        return 'ok';
      }
      return 'unrepairable';
    }

    if (!needsRepair && probe.version === configured) return 'ok';

    // Something is missing, or we're upgrading from a lower version. Force an upgrade
    // that creates exactly what's absent. A same-version-but-incomplete DB needs
    // version + 1 to make `onupgradeneeded` fire at all.
    const target = probe.version < configured ? configured : probe.version + 1;
    console.warn(
      `IndexedDbRecoveryService: repairing "${this.dbName}" in place → v${target} ` +
        `(missing stores: [${missing.stores.join(', ')}], missing indexes: ${missing.indexCount}). ` +
        `No data wipe.`,
    );
    await this.applySchemaUpgrade(target);
    this.alignConfigVersion(target); // ngx must open at the same version we just wrote
    return 'repaired';
  }

  /**
   * Reactive entry point for {@link IndexedDbCacheService}: when a live operation hits
   * a structural fault mid-session, repair the schema **in place** — create the missing
   * store/index and carry on. No delete, no reload; the next cache read succeeds.
   *
   * Concurrent callers (many cache ops can fail in the same tick) are coalesced onto a
   * single in-flight repair. If the repair can't run (DB newer than this build, or an
   * open blocked by another tab that never closes), we log and stay on the Firestore
   * fallback — the startup barrier finishes the job on the next load. This path never
   * reloads the page.
   *
   * @returns `true` if the schema is believed healthy afterwards, `false` if we degraded.
   */
  repairInPlaceOnce(reason: string): Promise<boolean> {
    if (!this.available) return Promise.resolve(false);
    this.repairInFlight ??= this.doRepairInPlace(reason).finally(() => {
      this.repairInFlight = null;
    });
    return this.repairInFlight;
  }

  private async doRepairInPlace(reason: string): Promise<boolean> {
    try {
      const outcome = await this.ensureSchema();
      if (outcome === 'unrepairable') {
        console.warn(
          `IndexedDbRecoveryService: cannot repair in place (${reason}) — on-disk DB is newer ` +
            `than this build. Staying on the Firestore fallback; resolves on the next load.`,
        );
        return false;
      }
      if (outcome === 'repaired') {
        console.warn(`IndexedDbRecoveryService: repaired schema in place (${reason}); no reload needed.`);
      }
      return true;
    } catch (err) {
      console.warn(
        `IndexedDbRecoveryService: in-place repair could not run (${reason}: ${this.describe(err)}); ` +
          `staying on the Firestore fallback.`,
      );
      return false;
    }
  }

  /**
   * Reactive entry point for {@link IndexedDbCacheService}: delete + reload when a
   * live operation hits a structural fault mid-session. No-ops (returns `false`)
   * while already recovering or inside the cooldown window.
   */
  async recover(reason: string): Promise<boolean> {
    if (this.recovering || !this.available) return false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.warn(
        `IndexedDbRecoveryService: fault detected (${reason}) but device is offline — ` +
          `skipping delete+reload (would show "page can't be reached"); app continues on the Firestore fallback.`,
      );
      return false;
    }

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
  private inspect(): Promise<'missing' | DbShape> {
    return (async () => {
      if (typeof indexedDB.databases === 'function') {
        try {
          const dbs = await indexedDB.databases();
          if (!dbs.some((d) => d.name === this.dbName)) return 'missing';
        } catch {
          /* fall through to open-based inspection */
        }
      }

      return new Promise<'missing' | DbShape>((resolve, reject) => {
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

          if (createdByProbe) {
            db.close();
            // Undo the empty DB our probe accidentally created so ngx builds it fresh.
            indexedDB.deleteDatabase(this.dbName);
            resolve('missing');
            return;
          }

          // Read the existing indexes per store so we can detect indexes that were
          // added to an already-existing store (ngx never creates those on upgrade).
          const indexes: Record<string, string[]> = {};
          try {
            if (stores.length) {
              const tx = db.transaction(stores, 'readonly');
              for (const s of stores) indexes[s] = Array.from(tx.objectStore(s).indexNames);
            }
          } catch {
            /* couldn't read index names — leave empty; repair will add any missing ones */
          }
          db.close();
          resolve({ version, stores, indexes });
        };
        req.onerror = () => reject(req.error ?? new Error('open failed'));
        req.onblocked = () => reject(new Error('open blocked'));
      });
    })();
  }

  /**
   * Open at `target` and, inside a **synchronous** `onupgradeneeded`, create every
   * missing object store (with its indexes) and every missing index on an existing
   * store. Existing stores and their data are left untouched.
   *
   * The handler must stay fully synchronous: any `await` inside `onupgradeneeded`
   * lets the `versionchange` transaction auto-commit, silently dropping the schema
   * changes (this is the bug behind the original "empty v8 DB").
   */
  private applySchemaUpgrade(target: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const ok = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const req = indexedDB.open(this.dbName, target);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction; // the active versionchange transaction
        if (!tx) {
          fail(new Error('no versionchange transaction during upgrade'));
          return;
        }
        for (const meta of indexedDbConfig.objectStoresMeta) {
          const store = db.objectStoreNames.contains(meta.store)
            ? tx.objectStore(meta.store)
            : db.createObjectStore(meta.store, meta.storeConfig);
          for (const idx of meta.storeSchema ?? []) {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keypath, idx.options);
            }
          }
        }
      };
      req.onsuccess = () => {
        req.result.close();
        ok();
      };
      req.onerror = () => fail(req.error ?? new Error('schema upgrade failed'));
      // A blocked open does NOT abort the request — it stays pending and proceeds once
      // the blocking connection closes. Mid-session that blocker is our own ngx handle,
      // which closes right after its operation, so we just wait it out. Only a blocker
      // that never closes (another tab on an older version) trips the timeout below.
      req.onblocked = () => {
        console.warn(
          `IndexedDbRecoveryService: schema upgrade to v${target} is blocked; ` +
            `waiting for other connections to close…`,
        );
      };
      timer = setTimeout(() => fail(new Error('schema upgrade blocked (timed out)')), 3000);
    });
  }

  /** Stores/indexes present in the config but absent from the on-disk DB. */
  private computeMissing(
    stores: string[],
    indexes: Record<string, string[]>,
  ): { stores: string[]; indexCount: number } {
    const missingStores: string[] = [];
    let indexCount = 0;
    for (const meta of indexedDbConfig.objectStoresMeta) {
      const wantIndexes = (meta.storeSchema ?? []).map((i) => i.name);
      if (!stores.includes(meta.store)) {
        missingStores.push(meta.store);
        indexCount += wantIndexes.length; // the whole store (and its indexes) is missing
        continue;
      }
      const have = indexes[meta.store] ?? [];
      for (const idx of wantIndexes) if (!have.includes(idx)) indexCount++;
    }
    return { stores: missingStores, indexCount };
  }

  /**
   * Point ngx-indexed-db's configured version at the one we just materialised, so its
   * own open finds the current version and skips straight to using the DB. Mutating the
   * shared config object is safe: ngx reads `version` only when it first opens the DB,
   * which (by construction) happens after this startup barrier completes.
   */
  private alignConfigVersion(version: number): void {
    if ((indexedDbConfig.version ?? 0) !== version) {
      (indexedDbConfig as { version: number }).version = version;
    }
  }

  private isBlocked(err: unknown): boolean {
    return this.describe(err).toLowerCase().includes('block');
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
