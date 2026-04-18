import { booleanAttribute, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportSummary } from '../../../../shared/models/report.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-reports-savings-rate-card',
  standalone: true,
  imports: [CommonModule, SignedAmountPipe],
  templateUrl: './reports-savings-rate-card.html',
})
export class ReportsSavingsRateCard {
  @Input({ required: true }) summary!: ReportSummary;
  @Input() currency = 'INR';
  @Input({ transform: booleanAttribute }) barsShown = true;
}
