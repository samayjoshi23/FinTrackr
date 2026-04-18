import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportSummary } from '../../../../shared/models/report.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-reports-summary-cards',
  standalone: true,
  imports: [CommonModule, SignedAmountPipe],
  templateUrl: './reports-summary-cards.html',
})
export class ReportsSummaryCards {
  @Input({ required: true }) summary!: ReportSummary;
  @Input() currency = 'INR';
}
