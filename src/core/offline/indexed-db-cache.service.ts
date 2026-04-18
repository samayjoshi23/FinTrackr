import { Injectable, inject } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';

const DATE_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'lastPaymentDate', 'nextPaymentDate', 'readAt'];

@Injectable({ providedIn: 'root' })
export class IndexedDbCacheService {
  private readonly db = inject(NgxIndexedDBService);

  async getAll<T>(storeName: string): Promise<T[]> {
    const items = await firstValueFrom(this.db.getAll<Record<string, unknown>>(storeName));
    return items.map((item) => this.deserializeDates<T>(item));
  }

  async getAllByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
    const items = await firstValueFrom(
      this.db.getAllByIndex<Record<string, unknown>>(storeName, indexName, IDBKeyRange.only(value))
    );
    return items.map((item) => this.deserializeDates<T>(item));
  }

  async getByKey<T>(storeName: string, key: string | number): Promise<T | undefined> {
    const item = await firstValueFrom(this.db.getByID<Record<string, unknown>>(storeName, key));
    return item ? this.deserializeDates<T>(item) : undefined;
  }

  async put<T>(storeName: string, value: T): Promise<T> {
    const serialized = this.serializeDates(value as Record<string, unknown>);
    await firstValueFrom(this.db.update(storeName, serialized));
    return value;
  }

  async putAll<T>(storeName: string, values: T[]): Promise<void> {
    if (values.length === 0) return;
    const serialized = values.map((v) => this.serializeDates(v as Record<string, unknown>));
    await firstValueFrom(this.db.bulkPut(storeName, serialized));
  }

  async delete(storeName: string, key: string | number): Promise<void> {
    await firstValueFrom(this.db.deleteByKey(storeName, key));
  }

  async clear(storeName: string): Promise<void> {
    await firstValueFrom(this.db.clear(storeName));
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
