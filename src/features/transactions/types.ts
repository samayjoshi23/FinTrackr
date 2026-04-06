export type TypeFilter = 'all' | 'income' | 'expense';
export type DateFilter = 'all' | 'today' | 'week' | 'month';

export const typeFilterOptions: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

export const dateFilterOptions: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
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
