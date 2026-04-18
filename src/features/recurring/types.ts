import { recurringFrequencyOptions } from '../transactions/types';

export function frequencyLabel(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '—';
  const opt = recurringFrequencyOptions.find((o) => o.value === v);
  return opt?.name ?? v;
}
