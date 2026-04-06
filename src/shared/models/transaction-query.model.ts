import { TransactionRecord } from './transaction.model';
import { transactionEventDate } from '../../core/date';

/** Preset date ranges for IndexedDB-backed transaction queries (matches previous UI). */
export type TransactionDatePreset = 'all' | 'today' | 'week' | 'month';

/** Filters applied in the cache/offline layer after scoping by `accountId` in IndexedDB. */
export interface TransactionListFilter {
  search?: string;
  type?: 'all' | 'income' | 'expense';
  /** Exact category name, or `'all'` / `'All'` to skip. */
  category?: string;
  datePreset?: TransactionDatePreset;
}

export interface TransactionPagedResult {
  items: TransactionRecord[];
  total: number;
  hasMore: boolean;
}

export function applyTransactionFilters(
  rows: TransactionRecord[],
  filter: TransactionListFilter,
): TransactionRecord[] {
  let list = rows;
  const q = filter.search?.trim().toLowerCase();
  if (q) {
    list = list.filter((t) => {
      const hay = [t.description, t.category, t.source, t.type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const tf = filter.type ?? 'all';
  if (tf !== 'all') {
    list = list.filter((t) => t.type === tf);
  }

  const cf = filter.category;
  if (cf && cf !== 'all' && cf !== 'All') {
    list = list.filter((t) => t.category === cf);
  }

  const df = filter.datePreset ?? 'all';
  if (df !== 'all') {
    const now = new Date();
    const start = new Date(now);
    if (df === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (df === 'week') {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
    } else if (df === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    list = list.filter((t) => {
      const d = transactionEventDate(t);
      if (!d) return false;
      return d >= start && d <= now;
    });
  }

  return list;
}

export function sortTransactionsByCreatedAtDesc(rows: TransactionRecord[]): TransactionRecord[] {
  return [...rows].sort((a, b) => {
    const ea = transactionEventDate(a);
    const eb = transactionEventDate(b);
    const ta = ea?.getTime() ?? 0;
    const tb = eb?.getTime() ?? 0;
    if (tb !== ta) return tb - ta;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });
}

export function paginateTransactionRows(
  sortedRows: TransactionRecord[],
  offset: number,
  limit: number,
): { items: TransactionRecord[]; total: number; hasMore: boolean } {
  const total = sortedRows.length;
  const items = sortedRows.slice(offset, offset + limit);
  const hasMore = offset + limit < total;
  return { items, total, hasMore };
}
