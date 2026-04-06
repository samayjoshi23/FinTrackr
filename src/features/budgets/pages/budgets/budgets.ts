import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { BudgetsService } from '../../../../services/budgets.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { CategoriesService } from '../../../../services/categories.service';
import { Budget } from '../../../../shared/models/budget.model';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { Category } from '../../../categories/types';
import { Account } from '../../../../shared/models/account.model';
import { ProgressStatus, CategoryBudgetCardModel, SummaryCardModel } from '../../types';
@Component({
  selector: 'app-budgets',
  imports: [CommonModule, Icon],
  templateUrl: './budgets.html',
  styleUrl: './budgets.css',
})
export class Budgets {
  private readonly router = inject(Router);
  private readonly budgetsService = inject(BudgetsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly categoriesService = inject(CategoriesService);

  currency = signal<string>('INR');
  budgets = signal<Budget[]>([]);
  transactions = signal<TransactionRecord[]>([]);
  categories = signal<Category[]>([]);

  monthLabel = computed(() => {
    const monthFromBudgets = this.budgets()
      .map((b) => (b.month ?? '').trim())
      .filter(Boolean);
    const first = monthFromBudgets[0];
    if (first) return first;
    return new Date().toLocaleString('en-US', { month: 'long' });
  });

  readonly summary = computed<SummaryCardModel>(() => {
    const month = this.monthLabel();
    const monthSpent = this.transactions().reduce((acc, t) => {
      if (t.type !== 'expense') return acc;
      if (!this.isInMonth(t.createdAt, month)) return acc;
      return acc + (Number(t.amount ?? 0) || 0);
    }, 0);

    const totalLimit = this.budgets()
      .filter((b) => this.isBudgetMonth(b.month, month))
      .reduce((acc, b) => acc + Number(b.limit ?? 0), 0);
    const remaining = totalLimit - monthSpent;
    const remainingDisplay = Math.max(0, remaining);

    const daysLeft = this.daysLeftInMonth(new Date());
    return {
      monthLabel: month,
      totalLimit,
      totalSpent: monthSpent,
      remaining,
      remainingDisplay,
      daysLeft,
    };
  });

  readonly categoryCards = computed<CategoryBudgetCardModel[]>(() => {
    const month = this.monthLabel();
    const totalsByCategory = new Map<string, { spent: number; limit: number }>();

    for (const b of this.budgets().filter((b) => this.isBudgetMonth(b.month, month))) {
      const cat = (b.category ?? '').trim() || 'Uncategorized';
      if (!totalsByCategory.has(cat)) totalsByCategory.set(cat, { spent: 0, limit: 0 });
      totalsByCategory.get(cat)!.limit += Number(b.limit ?? 0);
    }

    for (const t of this.transactions()) {
      if (t.type !== 'expense') continue;
      if (!this.isInMonth(t.createdAt, month)) continue;
      const cat = (t.category ?? '').trim() || 'Uncategorized';
      const row = totalsByCategory.get(cat);
      if (!row) continue;
      row.spent += Number(t.amount ?? 0) || 0;
    }

    const iconByCategory = new Map<string, string>();
    for (const c of this.categories()) {
      iconByCategory.set(c.name, c.icon);
    }

    return Array.from(totalsByCategory.entries()).map(([cat, data]) => {
      const limit = data.limit;
      const spent = data.spent;
      const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const status: ProgressStatus = spent <= limit ? 'under' : 'over';
      return {
        category: cat,
        icon: iconByCategory.get(cat) ?? 'tags',
        spent,
        limit,
        percent,
        status,
      };
    });
  });

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    if (!account) return;
    this.currency.set(account.currency ?? 'INR');

    try {
      const [budgets, txs, cats] = await Promise.all([
        this.budgetsService.getBudgets(),
        this.transactionsService.getTransactions(),
        this.categoriesService.getCategories(),
      ]);
      this.budgets.set(budgets ?? []);
      this.transactions.set(txs ?? []);
      this.categories.set(cats ?? []);
    } catch (e) {
      console.error(e);
      this.budgets.set([]);
      this.transactions.set([]);
      this.categories.set([]);
    }
  }

  onNewBudget() {
    this.router.navigateByUrl('/user/budgets/new');
  }

  private isInMonth(date: Date | null, monthLabel: string): boolean {
    if (!date) return false;
    const m = date.toLocaleString('en-US', { month: 'long' });
    return m.toLowerCase() === (monthLabel ?? '').toLowerCase();
  }

  private isBudgetMonth(budgetMonth: string | undefined, monthLabel: string): boolean {
    const bm = (budgetMonth ?? '').trim();
    if (!bm) return true; // backward compatible: older docs may not have month filled
    return bm.toLowerCase() === (monthLabel ?? '').toLowerCase();
  }

  private daysLeftInMonth(date: Date): number {
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const ms = end.getTime() - date.getTime();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  // (intentionally no extra formatting helpers; template uses the Angular currency pipe)
}
