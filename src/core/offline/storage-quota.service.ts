import { Injectable, inject, signal } from '@angular/core';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { NotifierSeverity } from '../../shared/components/notifier/types';
import { SyncLoggerService } from './sync-logger.service';

export interface StorageQuotaSnapshot {
  usageBytes: number;
  quotaBytes: number;
  /** 0–1. `usageBytes / quotaBytes`, or 0 when quota is unknown. */
  usageRatio: number;
  measuredAt: number;
}

/**
 * Watches the origin's persistent-storage budget via `navigator.storage.estimate()`.
 *
 * Why this matters: when IndexedDB runs out of quota, subsequent writes reject
 * with `QuotaExceededError` and the whole offline layer silently degrades to
 * "reads work, writes don't". We surface a warning banner well before that so
 * the user can delete data or clear something proactively.
 *
 * Safari (especially private-browsing) reports very small quotas (~50MB) and
 * evicts aggressively, so this warning is meaningful there more than anywhere
 * else. On Chrome/Firefox with unlimited quota, the warning effectively never
 * fires.
 */
@Injectable({ providedIn: 'root' })
export class StorageQuotaService {
  private readonly notifier = inject(NotifierService);
  private readonly logger = inject(SyncLoggerService);

  /** Ratio at which we notify the user once per session. */
  private static readonly WARN_THRESHOLD = 0.85;
  /** Ratio at which we escalate to `error` severity — imminent write failure. */
  private static readonly CRITICAL_THRESHOLD = 0.95;

  /** Last successful snapshot, exposed reactively for optional UI display. */
  readonly lastSnapshot = signal<StorageQuotaSnapshot | null>(null);

  /**
   * De-dupe: once a threshold notification fires this session, don't repeat it
   * (would train users to ignore the banner). Reset by page reload.
   */
  private warnedThisSession = false;
  private criticalThisSession = false;

  /** True when the platform exposes the Storage API — SSR and older browsers fall back to false. */
  private get available(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.estimate === 'function'
    );
  }

  /**
   * Read current usage and quota. Returns null when the API is unavailable or
   * the call rejects (some private browsing modes throw). Safe to call from
   * app-init and after every successful sync.
   */
  async check(): Promise<StorageQuotaSnapshot | null> {
    if (!this.available) return null;
    let est: StorageEstimate;
    try {
      est = await navigator.storage.estimate();
    } catch (err) {
      this.logger.warn({ event: 'quota.estimate.failed' }, err);
      return null;
    }

    const usageBytes = est.usage ?? 0;
    const quotaBytes = est.quota ?? 0;
    const usageRatio = quotaBytes > 0 ? usageBytes / quotaBytes : 0;
    const snapshot: StorageQuotaSnapshot = {
      usageBytes,
      quotaBytes,
      usageRatio,
      measuredAt: Date.now(),
    };
    this.lastSnapshot.set(snapshot);
    this.maybeWarn(snapshot);
    return snapshot;
  }

  /** Force a re-notification on the next threshold crossing — call after the user frees space. */
  resetSessionDedupe(): void {
    this.warnedThisSession = false;
    this.criticalThisSession = false;
  }

  private maybeWarn(snapshot: StorageQuotaSnapshot): void {
    const { usageRatio, usageBytes, quotaBytes } = snapshot;
    if (quotaBytes === 0) return; // no quota info to compare against

    if (
      usageRatio >= StorageQuotaService.CRITICAL_THRESHOLD &&
      !this.criticalThisSession
    ) {
      this.criticalThisSession = true;
      this.warnedThisSession = true; // don't also fire the lower-severity warning
      this.logger.error({
        event: 'quota.critical',
        counts: { usageBytes, quotaBytes },
        extra: { usageRatio: Number(usageRatio.toFixed(3)) },
      });
      this.notifier.error(
        'Storage is almost full. New changes may fail to save until you free space.',
      );
      return;
    }

    if (usageRatio >= StorageQuotaService.WARN_THRESHOLD && !this.warnedThisSession) {
      this.warnedThisSession = true;
      this.logger.warn({
        event: 'quota.warn',
        counts: { usageBytes, quotaBytes },
        extra: { usageRatio: Number(usageRatio.toFixed(3)) },
      });
      this.notifier.show(
        `Storage is ${Math.round(usageRatio * 100)}% full. Consider clearing old data.`,
        NotifierSeverity.WARNING,
      );
    }
  }
}
