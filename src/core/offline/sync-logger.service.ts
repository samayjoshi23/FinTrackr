import { Injectable, isDevMode } from '@angular/core';

/** Structured log severity. `warn` and above always print; `info`/`debug` can be gated. */
export type SyncLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Common payload attached to every sync/queue/cache log event. Kept flat and
 * JSON-serializable so a future telemetry sink (Sentry, Datadog, custom API)
 * can forward the same shape without a translation layer.
 */
export interface SyncLogPayload {
  /** Short kebab-case event id, e.g. `sync.pass.start`, `queue.enqueue`, `cache.reval.success`. */
  event: string;
  /** Store name or subsystem the event pertains to. */
  storeName?: string;
  /** Sync-queue entry id when relevant. */
  entryId?: string;
  /** Numeric counters — e.g. `{ pending: 12, retries: 3 }`. */
  counts?: Record<string, number>;
  /** Duration in ms for timed operations. */
  durationMs?: number;
  /** Free-form context bag — keep values primitive. */
  extra?: Record<string, unknown>;
}

/**
 * Centralized sink for offline/sync/queue diagnostics. Today it writes to the
 * console with a stable `[fintrackr:sync]` prefix so filtering is easy; the
 * `emit` seam is designed so a telemetry forwarder can be added later without
 * touching every call site (see design item D15 in OFFLINE-DATA-MANAGEMENT.md).
 *
 * Intentionally NOT injecting NotifierService — user-facing notifications are
 * a separate concern and should be triggered explicitly at higher layers, not
 * as a side effect of every log call.
 */
@Injectable({ providedIn: 'root' })
export class SyncLoggerService {
  private static readonly PREFIX = '[fintrackr:sync]';
  /**
   * `debug`/`info` events print only when Angular is in dev mode; `warn`/`error`
   * always print. This way `ng serve` shows the full sync trace for debugging
   * while production builds stay quiet (a future telemetry sink can forward
   * all levels regardless — see design item D15).
   */
  private readonly verbose = isDevMode();

  debug(payload: SyncLogPayload): void {
    if (!this.verbose) return;
    this.emit('debug', payload);
  }

  info(payload: SyncLogPayload): void {
    if (!this.verbose) return;
    this.emit('info', payload);
  }

  warn(payload: SyncLogPayload, err?: unknown): void {
    this.emit('warn', payload, err);
  }

  error(payload: SyncLogPayload, err?: unknown): void {
    this.emit('error', payload, err);
  }

  private emit(level: SyncLogLevel, payload: SyncLogPayload, err?: unknown): void {
    const line = `${SyncLoggerService.PREFIX} ${payload.event}`;
    const body = { ...payload, ...(err !== undefined ? { error: this.describe(err) } : {}) };
    switch (level) {
      case 'debug':
      case 'info':
        console.log(line, body);
        break;
      case 'warn':
        console.warn(line, body);
        break;
      case 'error':
        console.error(line, body);
        break;
    }
  }

  private describe(err: unknown): string {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    const e = err as { name?: string; message?: string; code?: string };
    return [e.name, e.code, e.message].filter(Boolean).join(': ') || String(err);
  }
}
