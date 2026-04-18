import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  imports: [CommonModule, Icon, SignedAmountPipe],
  templateUrl: './reports-top-categories.html',
})
export class ReportsTopCategories {
  @Input({ required: true }) categories: ReportsTopCategoryRow[] = [];
  @Input() currency = 'INR';
}
