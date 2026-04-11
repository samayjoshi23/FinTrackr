import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { AccountsService } from '../../../../services/accounts.service';
import { BudgetsService } from '../../../../services/budgets.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { CategoriesService } from '../../../../services/categories.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Budget } from '../../../../shared/models/budget.model';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { Category } from '../../../categories/types';
import { transactionEventDate } from '../../../../core/date';
import { ProgressStatus, CategoryBudgetCardModel, SummaryCardModel } from '../../types';
import {
  budgetUsageBarClass,
  categoryBudgetBarClass,
} from '../../../../shared/utils/budget-usage-color';

@Component({
  selector: 'app-budgets',
  imports: [CommonModule, Icon, ConfirmPrompt],
  templateUrl: './budgets.html',
  styleUrl: './budgets.css',
})
export class Budgets {
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  currency = signal<string>('INR');
  budgets = signal<Budget[]>([]);
  transactions = signal<TransactionRecord[]>([]);
  categories = signal<Category[]>([]);

  /** The category name of the currently-expanded card (shows action buttons). */
  expandedCategory = signal<string | null>(null);

  /** After layout, set true so bar widths animate from 0 → computed %. */
  progressBarsShown = signal(false);

  /** Delete prompt state */
  deletePromptOpen = signal(false);
  deletingCard = signal<CategoryBudgetCardModel | null>(null);
  deleting = signal(false);

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
      if (!this.isInMonth(transactionEventDate(t), month)) return acc;
      return acc + (Number(t.amount ?? 0) || 0);
    }, 0);

    const totalLimit = this.budgets()
      .filter((b) => this.isBudgetMonth(b.month, month))
      .reduce((acc, b) => acc + Number(b.limit ?? 0), 0);
    const remaining = totalLimit - monthSpent;
    const remainingDisplay = Math.max(0, remaining);
    const overBudgetAmount = remaining < 0 ? -remaining : 0;

    const daysLeft = this.daysLeftInMonth(new Date());
    return {
      monthLabel: month,
      totalLimit,
      totalSpent: monthSpent,
      remaining,
      remainingDisplay,
      overBudgetAmount,
      daysLeft,
    };
  });

  readonly summaryUsagePercent = computed(() => {
    const s = this.summary();
    if (s.totalLimit <= 0) return 0;
    return (s.totalSpent / s.totalLimit) * 100;
  });

  readonly summaryBarClass = computed(() => budgetUsageBarClass(this.summaryUsagePercent()));

  readonly summaryBarWidthPercent = computed(() => {
    const s = this.summary();
    if (s.totalLimit <= 0) return 0;
    return Math.min(100, (s.totalSpent / s.totalLimit) * 100);
  });

  readonly categoryCards = computed<CategoryBudgetCardModel[]>(() => {
    const month = this.monthLabel();
    const totalsByCategory = new Map<
      string,
      { spent: number; limit: number; budgetId: string }
    >();

    for (const b of this.budgets().filter((b) => this.isBudgetMonth(b.month, month))) {
      const cat = (b.category ?? '').trim() || 'Uncategorized';
      if (!totalsByCategory.has(cat)) {
        totalsByCategory.set(cat, { spent: 0, limit: 0, budgetId: b.id });
      }
      totalsByCategory.get(cat)!.limit += Number(b.limit ?? 0);
    }

    for (const t of this.transactions()) {
      if (t.type !== 'expense') continue;
      if (!this.isInMonth(transactionEventDate(t), month)) continue;
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
      const overAmount = spent > limit ? spent - limit : 0;
      return {
        category: cat,
        budgetId: data.budgetId,
        icon: iconByCategory.get(cat) ?? 'tags',
        spent,
        limit,
        percent,
        status,
        overAmount,
      };
    });
  });

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
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

    this.queueProgressBarAnimation();
  }

  private queueProgressBarAnimation(): void {
    this.progressBarsShown.set(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.progressBarsShown.set(true));
    });
  }

  onNewBudget() {
    this.router.navigateByUrl('/user/budgets/new');
  }

  /** Toggle expanded state for the card; collapse others. */
  onCardClick(card: CategoryBudgetCardModel): void {
    const current = this.expandedCategory();
    this.expandedCategory.set(current === card.category ? null : card.category);
  }

  isCardExpanded(card: CategoryBudgetCardModel): boolean {
    return this.expandedCategory() === card.category;
  }

  /** Open transaction list filtered to this budget's category for the current month. */
  onSeeTransactions(event: Event, card: CategoryBudgetCardModel): void {
    event.stopPropagation();
    void this.router.navigate(['/user/transactions/list'], {
      queryParams: {
        type: 'expense',
        date: 'month',
        category: card.category,
        advanced: '1',
      },
    });
  }

  onEditBudget(event: Event, card: CategoryBudgetCardModel): void {
    event.stopPropagation();
    this.router.navigateByUrl(`/user/budgets/edit/${card.budgetId}`);
  }

  onDeleteRequest(event: Event, card: CategoryBudgetCardModel): void {
    event.stopPropagation();
    this.deletingCard.set(card);
    this.deletePromptOpen.set(true);
  }

  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.deletingCard.set(null);
      return;
    }
    const card = this.deletingCard();
    if (!card) return;

    this.deleting.set(true);
    try {
      await this.budgetsService.deleteBudget(card.budgetId);
      await this.reportsService.rebuildCurrentMonthReport();
      this.budgets.update((list) => list.filter((b) => b.id !== card.budgetId));
      if (this.expandedCategory() === card.category) {
        this.expandedCategory.set(null);
      }
      this.notifier.success('Budget deleted.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not delete budget.');
    } finally {
      this.deleting.set(false);
      this.deletingCard.set(null);
    }
  }

  categoryBarClass(card: CategoryBudgetCardModel): string {
    return categoryBudgetBarClass(card.percent, card.status === 'over');
  }

  private isInMonth(date: Date | null, monthLabel: string): boolean {
    if (!date) return false;
    const m = date.toLocaleString('en-US', { month: 'long' });
    return m.toLowerCase() === (monthLabel ?? '').toLowerCase();
  }

  private isBudgetMonth(budgetMonth: string | undefined, monthLabel: string): boolean {
    const bm = (budgetMonth ?? '').trim();
    if (!bm) return true;
    return bm.toLowerCase() === (monthLabel ?? '').toLowerCase();
  }

  private daysLeftInMonth(date: Date): number {
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const ms = end.getTime() - date.getTime();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
}
