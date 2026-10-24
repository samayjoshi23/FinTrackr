import { LinkedObject, TransactionRecord } from '../../shared/models/transaction.model';
import { docCalendarDate } from '../../core/date';

/** Firestore Timestamp / Date / unknown → valid `Date` or `null`. */
export function asFirestoreDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const fn = (v as { toDate?: () => Date }).toDate;
  if (typeof fn === 'function') {
    const d = fn.call(v);
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Maps a `transactions/{id}` Firestore doc to the app's record shape. */
export function mapTransactionDoc(id: string, data: Record<string, unknown>): TransactionRecord {
  const created = asFirestoreDate(data['createdAt']);
  return {
    uid: id,
    accountId: (data['accountId'] as string) ?? '',
    amount: data['amount'] as number | null,
    description: (data['description'] as string) ?? '',
    category: (data['category'] as string) ?? '',
    paidBy: (data['paidBy'] as string | null | undefined) ?? null,
    icon: data['icon'] as string | null,
    linkedObject: (data['linkedObject'] as LinkedObject | null | undefined) ?? null,
    isRecurring: (data['isRecurring'] as boolean) ?? false,
    recurringFrequency: (data['recurringFrequency'] as string) ?? null,
    recurringTransactionId: (data['recurringTransactionId'] as string) ?? null,
    type: (data['type'] as string) ?? 'expense',
    source: data['source'] as string | undefined,
    nextPaymentDate: asFirestoreDate(data['nextPaymentDate']),
    createdAt: created,
    updatedAt: asFirestoreDate(data['updatedAt']),
    date: docCalendarDate(data, created),
  } as TransactionRecord;
}

/** Soft-deleted docs carry `deletedAt`; they are tombstones, never shown. */
export function isTombstone(data: Record<string, unknown>): boolean {
  return data['deletedAt'] != null;
}
