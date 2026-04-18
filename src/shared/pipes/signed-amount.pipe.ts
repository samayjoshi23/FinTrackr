import { CurrencyPipe } from '@angular/common';
import { inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'signedAmount',
  standalone: true,
})
export class SignedAmountPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);
  private readonly currencyPipe = new CurrencyPipe(this.locale);

  transform(
    amount: number | string | null | undefined,
    type: string | null | undefined,
    currencyCode: string | null | undefined,
    digitsInfo = '1.0-2',
    forceSign = false,
  ): string {
    const numeric = Number(amount ?? 0);
    const absolute = Number.isFinite(numeric) ? Math.abs(numeric) : 0;
    const code = (currencyCode ?? 'USD').trim() || 'USD';
    const normalizedType = String(type ?? '').toLowerCase();
    let sign = '';
    if (normalizedType === 'income') sign = '+';
    else if (normalizedType === 'expense') sign = '-';
    else if (forceSign) sign = numeric >= 0 ? '+' : '-';
    const formatted =
      this.currencyPipe.transform(absolute, code, 'symbol-narrow', digitsInfo, this.locale) ??
      `${absolute}`;
    return `${sign}${formatted}`;
  }
}
