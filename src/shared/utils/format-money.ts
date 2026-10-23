/** Formats an amount as currency in the `en-IN` locale, up to 2 decimals. */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
