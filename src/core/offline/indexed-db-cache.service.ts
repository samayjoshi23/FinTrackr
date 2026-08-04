import { Injectable, inject } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';
import { IndexedDbRecoveryService } from './indexed-db-recovery.service';

const DATE_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'lastPaymentDate', 'nextPaymentDate', 'readAt'];

/**
 * Thin, **fault-tolerant** wrapper over IndexedDB.
 *
 * IndexedDB can fail or be unavailable for reasons outside our control: the user
 * cleared site data, a schema upgrade was interrupted, private-browsing quotas,
 * a corrupt/blocked database, or an observable that completes without emitting.
 * None of those should crash the app. So:
 *   - **Reads** degrade to an empty result (treated as a cache miss upstream, which
 *     makes the offline-crud layer fall back to Firestore and repopulate the cache).
 *   - **Writes** are best-effort — a failure is logged and swallowed so the caller's
 *     flow (optimistic UI, sync queue) continues.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbCacheService {
  private readonly db = inject(NgxIndexedDBService);
  private readonly recovery = inject(IndexedDbRecoveryService);

  async getAll<T>(storeName: string): Promise<T[]> {
    try {
      const items = await firstValueFrom(this.db.getAll<Record<string, unknown>>(storeName));
      return (items ?? []).map((item) => this.deserializeDates<T>(item));
    } catch (err) {
      this.warn('getAll', storeName, err);
      return [];
    }
  }

  async getAllByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
    try {
      const items = await firstValueFrom(
        this.db.getAllByIndex<Record<string, unknown>>(storeName, indexName, IDBKeyRange.only(value))
      );
      return (items ?? []).map((item) => this.deserializeDates<T>(item));
    } catch (err) {
      this.warn('getAllByIndex', `${storeName}.${indexName}`, err);
      return [];
    }
  }

  async getByKey<T>(storeName: string, key: string | number): Promise<T | undefined> {
    try {
      const item = await firstValueFrom(this.db.getByID<Record<string, unknown>>(storeName, key));
      return item ? this.deserializeDates<T>(item) : undefined;
    } catch (err) {
      this.warn('getByKey', storeName, err);
      return undefined;
    }
  }

  async put<T>(storeName: string, value: T): Promise<T> {
    try {
      const serialized = this.serializeDates(value as Record<string, unknown>);
      await firstValueFrom(this.db.update(storeName, serialized));
    } catch (err) {
      this.warn('put', storeName, err);
    }
    // Always return the value: callers rely on it for optimistic UI even if the
    // local write failed (the change is still queued/sent to Firestore).
    return value;
  }

  async putAll<T>(storeName: string, values: T[]): Promise<void> {
    if (values.length === 0) return;
    try {
      const serialized = values.map((v) => this.serializeDates(v as Record<string, unknown>));
      await firstValueFrom(this.db.bulkPut(storeName, serialized));
    } catch (err) {
      this.warn('putAll', storeName, err);
    }
  }

  async delete(storeName: string, key: string | number): Promise<void> {
    try {
      await firstValueFrom(this.db.deleteByKey(storeName, key));
    } catch (err) {
      this.warn('delete', storeName, err);
    }
  }

  async clear(storeName: string): Promise<void> {
    try {
      await firstValueFrom(this.db.clear(storeName));
    } catch (err) {
      this.warn('clear', storeName, err);
    }
  }

  /**
   * Non-fatal IndexedDB diagnostics — never throws to the caller.
   *
   * If the failure looks structural (missing store / index), hand it to the recovery
   * service, which repairs the schema IN PLACE — no delete, no reload — so the next
   * cache read succeeds. The startup barrier catches most of these before the session
   * begins; this is the safety net for faults that surface mid-session. Concurrent
   * failures in the same tick are coalesced onto a single repair.
   */
  private warn(op: string, target: string, err: unknown): void {
    console.warn(`IndexedDbCacheService: ${op}(${target}) failed — falling back gracefully`, err);
    if (this.recovery.isStructuralFault(err)) {
      void this.recovery.repairInPlaceOnce(
        `${op}(${target}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private serializeDates(obj: Record<string, unknown>): Record<string, unknown> {
    const result = { ...obj };
    for (const key of DATE_FIELDS) {
      const val = result[key];
      if (val instanceof Date) {
        result[key] = val.toISOString();
      } else if (val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
        result[key] = (val as { toDate: () => Date }).toDate().toISOString();
      }
    }
    return result;
  }

  private deserializeDates<T>(obj: Record<string, unknown>): T {
    const result = { ...obj };
    for (const key of DATE_FIELDS) {
      if (typeof result[key] === 'string') {
        result[key] = new Date(result[key] as string);
      }
    }
    return result as T;
  }
}
