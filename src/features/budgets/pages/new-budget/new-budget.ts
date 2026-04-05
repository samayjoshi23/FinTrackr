import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { BudgetsService } from '../../../../services/budgets.service';
import { CategoriesService } from '../../../../services/categories.service';
import { BudgetCreateInput } from '../../../../shared/models/budget.model';
import { Category } from '../../../categories/types';
import { Account } from '../../../../shared/models/account.model';

@Component({
  selector: 'app-new-budget',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './new-budget.html',
  styleUrl: './new-budget.css',
})
export class NewBudget {
  private readonly router = inject(Router);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);

  selectedAccount = signal<Account | null>(null);
  categories = signal<Category[]>([]);

  budgetName = '';
  selectedCategory = '';
  monthlyLimit: number | string = '';
  monthLabel = new Date().toLocaleString('en-US', { month: 'long' });

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as
      | Account
      | null;
    this.selectedAccount.set(account);

    const cats = await this.categoriesService
      .getCategories(account?.id ?? account?.uid ?? '')
      .catch(() => []);
    this.categories.set(cats ?? []);
    if (!this.selectedCategory && (cats?.[0]?.name ?? '')) {
      this.selectedCategory = cats[0].name;
    }
  }

  onBack() {
    this.router.navigateByUrl('/user/budgets');
  }

  async onCreate() {
    const account = this.selectedAccount();
    if (!account) return;

    const payload: BudgetCreateInput = {
      accountId: account.id ?? account.uid ?? '',
      month: this.monthLabel,
      limit: Number(this.monthlyLimit),
      name: this.budgetName?.trim() || 'Budget',
      category: this.selectedCategory?.trim() || '',
    };

    await this.budgetsService.createBudget(payload);
    this.router.navigateByUrl('/user/budgets');
  }
}

