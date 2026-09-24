export type TypeFilter = 'all' | 'income' | 'expense';
export type DateFilter = 'month' | '3m' | '6m' | 'all' | 'custom';

export const typeFilterOptions: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

export const dateFilterOptions: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This Month' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: 'custom', label: 'Custom' },
];

export const paymentSourceOptions: { name: string; icon: string }[] = [
  {
    name: 'Card',
    icon: 'credit-card',
  },
  {
    name: 'Cash',
    icon: 'bank-notes',
  },
  {
    name: 'UPI',
    icon: 'qr-code',
  },
  {
    name: 'Bank',
    icon: 'bank',
  },
];

export const recurringFrequencyOptions: { name: string; value: string }[] = [
  { name: 'Daily', value: 'daily' },
  { name: 'Weekly', value: 'weekly' },
  { name: 'Bi-Weekly', value: 'bi-weekly' },
  { name: 'Monthly', value: 'monthly' },
  { name: 'Yearly', value: 'yearly' },
];

/**
 * Advance a date by one period of the given recurring frequency (calendar-based).
 * Defaults to monthly for unknown/blank values. Kept in sync with the server-side
 * `computeNextPaymentDate` in `functions/src/scheduled-notifications.ts`.
 */
export function advanceRecurringDate(prev: Date, frequency: string | null | undefined): Date {
  const f = (frequency ?? 'monthly').toLowerCase().trim();
  const d = new Date(prev.getTime());
  switch (f) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'bi-weekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

/**
 * Next payment date after `prev`, rolled forward by whole periods until it is
 * strictly after `notBefore` (default: now) — so paying a late/overdue schedule
 * realigns it to the future instead of leaving the due date in the past.
 */
export function nextRecurringDate(
  prev: Date,
  frequency: string | null | undefined,
  notBefore: Date = new Date(),
): Date {
  let d = advanceRecurringDate(prev, frequency);
  let guard = 0;
  while (d.getTime() <= notBefore.getTime() && guard < 4000) {
    d = advanceRecurringDate(d, frequency);
    guard++;
  }
  return d;
}
