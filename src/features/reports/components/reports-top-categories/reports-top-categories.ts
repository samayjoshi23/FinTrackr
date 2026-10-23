import { Component, Input } from '@angular/core';
import { Icon } from '../../../../shared/components/icon/icon';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

export interface ReportsTopCategoryRow {
  category: string;
  amount: number;
  color: string;
  icon: string;
}

@Component({
  selector: 'app-reports-top-categories',
  standalone: true,
  imports: [Icon, SignedAmountPipe],
  templateUrl: './reports-top-categories.html',
})
export class ReportsTopCategories {
  @Input({ required: true }) categories: ReportsTopCategoryRow[] = [];
  @Input() currency = 'INR';
}
