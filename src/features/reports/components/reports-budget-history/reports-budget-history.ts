import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Icon } from '../../../../shared/components/icon/icon';
import { BudgetHistoryMonth } from '../../../../shared/models/report.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

/**
 * Cross-month budget performance: one row per past month (income / expense /
 * savings / budget-used), expandable to per-category budget-vs-actual from the
 * frozen snapshot. Read-only — the Budgets page is where a month is inspected in
 * full and the current month is edited.
 */
@Component({
  selector: 'app-reports-budget-history',
  standalone: true,
  imports: [CommonModule, Icon, SignedAmountPipe],
  templateUrl: './reports-budget-history.html',
})
export class ReportsBudgetHistory {
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
}
