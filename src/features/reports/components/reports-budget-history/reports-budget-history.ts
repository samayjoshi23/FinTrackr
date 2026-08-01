import { Component, inject, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { BudgetHistoryMonth } from '../../../../shared/models/report.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';
import {
  currentMonthKey as currentMonthKeyFn,
  startOfMonth,
  endOfMonth,
  isoLocalDate,
} from '../../../../core/date';

/**
 * Cross-month budget performance: one row per past month (income / expense /
 * savings / budget-used), expandable to per-category budget-vs-actual from the
 * frozen snapshot. Edits happen on the Budgets page; the "See transactions"
 * action here deep-links into the transaction list scoped to that month.
 */
@Component({
  selector: 'app-reports-budget-history',
  standalone: true,
  imports: [CommonModule, Icon, SignedAmountPipe],
  templateUrl: './reports-budget-history.html',
})
export class ReportsBudgetHistory {
  private readonly router = inject(Router);

  @Input({ required: true }) months: BudgetHistoryMonth[] = [];
  @Input() currency = 'INR';

  /** Month key of the expanded row, or null. */
  readonly expanded = signal<string | null>(null);

  toggle(month: string): void {
    this.expanded.set(this.expanded() === month ? null : month);
  }

  isExpanded(month: string): boolean {
    return this.expanded() === month;
  }

  /**
   * Navigate to the transaction list scoped to this row's month. Clamps `dateTo`
   * to today when the row is the current month (avoids scoping into the future).
   */
  onSeeTransactions(event: Event, month: string): void {
    event.stopPropagation();
    const today = new Date();
    const rangeStart = startOfMonth(month);
    const rangeEndRaw = endOfMonth(month);
    const rangeEnd = month === currentMonthKeyFn() && rangeEndRaw > today ? today : rangeEndRaw;
    void this.router.navigate(['/user/transactions/list'], {
      queryParams: {
        dateFrom: isoLocalDate(rangeStart),
        dateTo: isoLocalDate(rangeEnd),
        advanced: '1',
      },
    });
  }
}
