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
