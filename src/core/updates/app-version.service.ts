import { inject, Injectable } from '@angular/core';
import { IndexedDbRecoveryService } from '../offline/indexed-db-recovery.service';

/** Shape of `/version.json` emitted by `scripts/generate-version.mjs`. */
interface VersionManifest {
  /** Always changes per build (git SHA + timestamp) — used by SwUpdate, not us. */
  buildId: string;
  /** Developer-controlled — bump the constant in `src/environment/version-config.ts`. */
  breakingBuild: string;
  builtAt: string;
}

/** localStorage key holding the last-seen `breakingBuild` from `/version.json`. */
const STORAGE_KEY = 'fintrackr:breakingBuild';

/** Race timeout for the network fetch — a broken/slow request must never block boot. */
const FETCH_TIMEOUT_MS = 2_000;

/**
 * localStorage keys that MUST survive a breaking-build wipe. Anything not on this
 * allow-list gets removed when the wipe fires. The list is intentionally strict:
 * anything the app can rebuild from Firestore should be dropped so a "wipe"
 * actually gives users the fresh state we shipped.
 *
 * Also survives (managed by their own SDKs, not touched by name here):
 *   - `firebase:authUser:*` — Firebase Auth session token.
 *   - `firebase:host:*`, `firebase:heartbeat` — Firebase infra.
 * We check with `startsWith('firebase:')` below.
 */
const KEEP_KEYS = new Set<string>([
  'userProfile',
  'fintrackr-device-id',
  'fintrackr:idb-recovery',
  STORAGE_KEY,
]);

/**
 * Boot-time wipe trigger. Fetches `/version.json` (served no-cache) and compares
 * `breakingBuild` to the value saved on the last boot. On mismatch, wipes safe
 * localStorage keys and hands off to {@link IndexedDbRecoveryService.recover}
 * which deletes IndexedDB and reloads.
 *
 * The recovery service has its own 60-second cooldown guard (`fintrackr:idb-recovery`)
 * so if a wipe fails partway or the compare is misconfigured, we can't reload-loop.
 *
 * Runs in a `provideAppInitializer` slot before the router bootstraps.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly recovery = inject(IndexedDbRecoveryService);

  async hydrateAndCompare(): Promise<void> {
    const manifest = await this.fetchManifest();
    if (!manifest) return; // offline / 404 / bad JSON — defer to next online boot

    const seen = safeGet(STORAGE_KEY);

    if (seen === null) {
      // First-ever boot on this device — save the current token, no wipe.
      safeSet(STORAGE_KEY, manifest.breakingBuild);
      return;
    }

    if (seen === manifest.breakingBuild) {
      // No wipe requested this deploy. Nothing to do.
      return;
    }

    // Developer flipped `BREAKING_BUILD` — wipe this device once and reload.
    console.warn(
      `AppVersionService: breakingBuild changed (${seen} → ${manifest.breakingBuild}). ` +
        `Wiping local caches and reloading.`,
    );

    this.clearSafeLocalStorage();
    // Save the new token BEFORE recover() reloads so the next boot sees a match
    // and doesn't wipe again.
    safeSet(STORAGE_KEY, manifest.breakingBuild);

    // Reuses the recovery service's cooldown guard + reload. Fires-and-forgets
    // from our POV — the reload aborts the current JS context.
    await this.recovery.recover(`breaking-build: ${seen} → ${manifest.breakingBuild}`);
  }

  private async fetchManifest(): Promise<VersionManifest | null> {
    if (typeof fetch !== 'function') return null;

    // Race the fetch against a short timeout so an unreachable /version.json
    // (offline, CDN hiccup, wrong host) never blocks boot.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch('/version.json', {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const parsed = (await res.json()) as Partial<VersionManifest>;
      if (typeof parsed?.breakingBuild !== 'string') return null;
      return parsed as VersionManifest;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private clearSafeLocalStorage(): void {
    if (typeof localStorage === 'undefined') return;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (KEEP_KEYS.has(key)) continue;
      if (key.startsWith('firebase:')) continue;
      toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  }
}

function safeGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* full quota / private browsing — non-fatal */
  }
}
