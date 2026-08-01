import { TransactionRecord } from './transaction.model';
import { transactionEventDate } from '../../core/date';

/** Preset date ranges for IndexedDB-backed transaction queries. */
export type TransactionDatePreset = 'month' | '3m' | '6m' | 'all' | 'custom';

/** Filters applied in the cache/offline layer after scoping by `accountId` in IndexedDB. */
export interface TransactionListFilter {
  search?: string;
  type?: 'all' | 'income' | 'expense';
  /** Exact category name, or `'all'` / `'All'` to skip. */
  category?: string;
  datePreset?: TransactionDatePreset;
  /** ISO local `YYYY-MM-DD`. Only honored when `datePreset === 'custom'`. */
  dateFrom?: string;
  /** ISO local `YYYY-MM-DD` (inclusive). Only honored when `datePreset === 'custom'`. */
  dateTo?: string;
  /** Match `transaction.paidBy` against this uid. `'all'` / undefined skips. */
  paidBy?: string;
}

export interface TransactionPagedResult {
  items: TransactionRecord[];
  total: number;
  hasMore: boolean;
  /** Sums across the entire filtered set (not just the returned page). */
  totals: {
    income: number;
    expense: number;
  };
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

  const pf = filter.paidBy;
  if (pf && pf !== 'all') {
    list = list.filter((t) => (t.paidBy ?? '') === pf);
  }

  const df = filter.datePreset;
  if (df && df !== 'all') {
    const range = resolvePresetRange(df, filter.dateFrom, filter.dateTo);
    if (range) {
      const { start, end } = range;
      list = list.filter((t) => {
        const d = transactionEventDate(t);
        if (!d) return false;
        return d >= start && d <= end;
      });
    } else if (df === 'custom') {
      // Custom with an incomplete range → show nothing rather than every row.
      list = [];
    }
  }

  return list;
}

/**
 * Resolve a date-preset chip to a concrete [start, end] range in local time.
 * `month`/`3m`/`6m` end at "now"; `custom` uses `dateFrom`/`dateTo` inclusive.
 * Returns `null` when the range is not resolvable (e.g. custom missing bounds).
 */
export function resolvePresetRange(
  preset: TransactionDatePreset,
  dateFrom?: string,
  dateTo?: string,
): { start: Date; end: Date } | null {
  const now = new Date();
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start, end: now };
  }
  if (preset === '3m') {
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
    return { start, end: now };
  }
  if (preset === '6m') {
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
    return { start, end: now };
  }
  if (preset === 'custom') {
    if (!dateFrom || !dateTo) return null;
    const [ys, ms, ds] = dateFrom.split('-').map(Number);
    const [ye, me, de] = dateTo.split('-').map(Number);
    if (!ys || !ms || !ds || !ye || !me || !de) return null;
    const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
    const end = new Date(ye, me - 1, de, 23, 59, 59, 999);
    return { start, end };
  }
  return null;
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
): TransactionPagedResult {
  const total = sortedRows.length;
  const items = sortedRows.slice(offset, offset + limit);
  const hasMore = offset + limit < total;
  let income = 0;
  let expense = 0;
  for (const t of sortedRows) {
    const amt = Number(t.amount ?? 0) || 0;
    if (t.type === 'income') income += amt;
    else expense += amt;
  }
  return { items, total, hasMore, totals: { income, expense } };
}
