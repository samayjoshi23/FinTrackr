import { booleanAttribute, Component, Input } from '@angular/core';
import { ReportSummary } from '../../../../shared/models/report.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-reports-savings-rate-card',
  standalone: true,
  imports: [SignedAmountPipe],
  templateUrl: './reports-savings-rate-card.html',
})
export class ReportsSavingsRateCard {
  @Input({ required: true }) summary!: ReportSummary;
  @Input() currency = 'INR';
  @Input({ transform: booleanAttribute }) barsShown = true;
}
