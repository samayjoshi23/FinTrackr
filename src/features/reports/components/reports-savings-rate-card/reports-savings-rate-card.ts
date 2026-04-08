import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportSummary } from '../../../../shared/models/report.model';

@Component({
  selector: 'app-reports-savings-rate-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reports-savings-rate-card.html',
})
export class ReportsSavingsRateCard {
  @Input({ required: true }) summary!: ReportSummary;
  @Input() currency = 'INR';
}
