import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportSummary } from '../../../../shared/models/report.model';

@Component({
  selector: 'app-reports-summary-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reports-summary-cards.html',
})
export class ReportsSummaryCards {
  @Input({ required: true }) summary!: ReportSummary;
  @Input() currency = 'INR';
}
