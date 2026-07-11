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
import { BudgetPlan } from '../../../../shared/models/budget.model';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { Category } from '../../../categories/types';
import { transactionEventDate } from '../../../../core/date';
import { ProgressStatus, CategoryBudgetCardModel, SummaryCardModel } from '../../types';
import {
  budgetUsageBarClass,
  categoryBudgetBarClass,
} from '../../../../shared/utils/budget-usage-color';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-budgets',
  imports: [CommonModule, Icon, ConfirmPrompt, SignedAmountPipe],
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
  loading = signal(true);
  budgetPlan = signal<BudgetPlan | null>(null);
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

  /** True once a budget plan with an overall monthly budget exists. */
  readonly hasBudget = computed(() => (this.budgetPlan()?.monthlyBudget ?? 0) > 0);

  /** Always the current calendar month — the plan is recurring and applies to every month. */
  monthLabel = computed(() => new Date().toLocaleString('en-US', { month: 'long' }));

  /** Current-month expense spent, keyed by lowercased category name. */
  private readonly monthSpendByCategory = computed(() => {
    const month = this.monthLabel();
    const map = new Map<string, number>();
    for (const t of this.transactions()) {
      if (t.type !== 'expense') continue;
      if (!this.isInMonth(transactionEventDate(t), month)) continue;
      const cat = (t.category ?? '').trim().toLowerCase() || 'uncategorized';
      map.set(cat, (map.get(cat) ?? 0) + (Number(t.amount ?? 0) || 0));
    }
    return map;
  });

  readonly summary = computed<SummaryCardModel>(() => {
    const month = this.monthLabel();
    const monthSpent = this.transactions().reduce((acc, t) => {
      if (t.type !== 'expense') return acc;
      if (!this.isInMonth(transactionEventDate(t), month)) return acc;
      return acc + (Number(t.amount ?? 0) || 0);
    }, 0);

    const totalLimit = this.budgetPlan()?.monthlyBudget ?? 0;
    const remaining = totalLimit - monthSpent;
    const remainingDisplay = Math.max(0, remaining);
    const overBudgetAmount = remaining < 0 ? -remaining : 0;

    const daysLeft = this.daysLeftInMonth(new Date());
    let summary =  {
      monthLabel: month,
      totalLimit,
      totalSpent: monthSpent,
      remaining,
      remainingDisplay,
      overBudgetAmount,
      daysLeft,
    };

    console.log('Budget summary:', summary);
    return summary;
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
    const plan = this.budgetPlan();
    if (!plan) return [];

    const categories = this.categories();
    const catById = new Map(categories.map((c) => [c.uid, c]));
    const spendByName = this.monthSpendByCategory();
    const toCard = (
      category: string,
      categoryId: string,
      icon: string,
      spent: number,
      limit: number,
      isOther: boolean,
    ): CategoryBudgetCardModel => {
      const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const status: ProgressStatus = spent <= limit ? 'under' : 'over';
      const overAmount = spent > limit ? spent - limit : 0;
      return { category, categoryId, isOther, icon, spent, limit, percent, status, overAmount };
    };

    // Per-category cards, sourced from the single plan.
    const cards: CategoryBudgetCardModel[] = [];
    let budgetedLimitTotal = 0;
    let budgetedSpendTotal = 0;
    for (const [categoryId, rawLimit] of Object.entries(plan.categoryBudgets)) {
      const limit = Number(rawLimit ?? 0);
      if (!(limit > 0)) continue;
      const cat = catById.get(categoryId);
      const name = cat?.name ?? 'Category';
      const spent = spendByName.get(name.trim().toLowerCase()) ?? 0;
      budgetedLimitTotal += limit;
      budgetedSpendTotal += spent;
      cards.push(toCard(name, categoryId, cat?.icon ?? 'tags', spent, limit, false));
    }

    // "Other": leftover allowance + all spend not attributed to a budgeted category.
    const otherLimit = Math.max(0, (plan.monthlyBudget ?? 0) - budgetedLimitTotal);
    const totalMonthSpend = this.summary().totalSpent;
    const otherSpent = Math.max(0, totalMonthSpend - budgetedSpendTotal);
    if (otherLimit > 0 || otherSpent > 0) {
      cards.push(toCard('Other', '', 'other', otherSpent, otherLimit, true));
    }

    return cards;
  });

  async ngOnInit() {
    this.loading.set(true);
    try {
      const account = await this.accountsService.getSelectedAccount();
      if (!account) return;
      this.currency.set(account.currency ?? 'INR');

      try {
        const [plan, txs, cats] = await Promise.all([
          this.budgetsService.getBudgetPlan(),
          this.transactionsService.getTransactions(),
          this.categoriesService.getCategories(),
        ]);
        this.budgetPlan.set(plan ?? null);
        this.transactions.set(txs ?? []);
        this.categories.set(cats ?? []);
      } catch (e) {
        console.error(e);
        this.budgetPlan.set(null);
        this.transactions.set([]);
        this.categories.set([]);
      }

      this.queueProgressBarAnimation();
    } finally {
      this.loading.set(false);
    }
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

  /** Edit opens the single plan editor (whole budget + per-category limits). */
  onEditPlan() {
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

  onEditBudget(event: Event): void {
    event.stopPropagation();
    this.onEditPlan();
  }

  onDeleteRequest(event: Event, card: CategoryBudgetCardModel): void {
    event.stopPropagation();
    if (card.isOther) return; // derived bucket — nothing to delete
    this.deletingCard.set(card);
    this.deletePromptOpen.set(true);
  }

  /** Removing a category budget clears its limit from the plan; "Other" absorbs the leftover. */
  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.deletingCard.set(null);
      return;
    }
    const card = this.deletingCard();
    const plan = this.budgetPlan();
    if (!card || !plan) return;

    this.deleting.set(true);
    try {
      const categoryBudgets = { ...plan.categoryBudgets };
      delete categoryBudgets[card.categoryId];
      const updated = await this.budgetsService.upsertBudgetPlan({
        accountId: plan.accountId,
        monthlyBudget: plan.monthlyBudget,
        categoryBudgets,
      });
      await this.reportsService.rebuildCurrentMonthReport();
      this.budgetPlan.set(updated);
      if (this.expandedCategory() === card.category) {
        this.expandedCategory.set(null);
      }
      this.notifier.success('Category budget removed.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update budget.');
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

  private daysLeftInMonth(date: Date): number {
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const ms = end.getTime() - date.getTime();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  goBack(): void {
    this.router.navigateByUrl('/user/dashboard');
  }
}
