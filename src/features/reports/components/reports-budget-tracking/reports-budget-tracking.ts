import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Icon } from '../../../../shared/components/icon/icon';
import { BudgetTrackingCard } from '../../../../shared/models/report.model';

@Component({
  selector: 'app-reports-budget-tracking',
  standalone: true,
  imports: [CommonModule, Icon],
  templateUrl: './reports-budget-tracking.html',
})
export class ReportsBudgetTracking {
  @Input({ required: true }) cards: BudgetTrackingCard[] = [];
  @Input() currency = 'INR';

  get overspentCards(): BudgetTrackingCard[] {
    return this.cards.filter((c) => c.overspent);
  }
}
