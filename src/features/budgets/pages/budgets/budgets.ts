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
import { MonthlyReport, monthlyReportCategoryKey } from '../../../../shared/models/report.model';
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

  /** Firestore account key used for report lookups. */
  private accountKey = signal<string>('');

  /** The month being viewed ('YYYY-MM'). Defaults to the current calendar month. */
  selectedMonth = signal<string>(this.currentMonthKey());
  /** Months the switcher can navigate to (ascending), always including the current month. */
  availableMonths = signal<string[]>([]);
  /** Snapshot for a past month (read-only). Null while on the current month. */
  historicalReport = signal<MonthlyReport | null>(null);
  /** True while a past month's snapshot is loading. */
  historyLoading = signal(false);

  /** The category name of the currently-expanded card (shows action buttons). */
  expandedCategory = signal<string | null>(null);

  /** After layout, set true so bar widths animate from 0 → computed %. */
  progressBarsShown = signal(false);

  /** Delete prompt state */
  deletePromptOpen = signal(false);
  deletingCard = signal<CategoryBudgetCardModel | null>(null);
  deleting = signal(false);

  /** True when viewing the current calendar month (editable). */
  readonly isCurrentMonth = computed(() => this.selectedMonth() === this.currentMonthKey());

  /** Human label for the selected month, e.g. "July 2026". */
  readonly monthLabel = computed(() => this.monthKeyLabel(this.selectedMonth()));

  private readonly monthIndex = computed(() =>
    this.availableMonths().indexOf(this.selectedMonth()),
  );
  readonly canGoPrev = computed(() => this.monthIndex() > 0);
  readonly canGoNext = computed(() => {
    const i = this.monthIndex();
    return i >= 0 && i < this.availableMonths().length - 1;
  });

  /** Whether the selected month has budget data to show. */
  readonly hasBudget = computed(() => {
    if (this.isCurrentMonth()) return (this.budgetPlan()?.monthlyBudget ?? 0) > 0;
    const r = this.historicalReport();
    return !!r && this.allocatedFromReport(r) > 0;
  });

  /** Current-month expense spent, keyed by lowercased category name. */
  private readonly monthSpendByCategory = computed(() => {
    const mk = this.currentMonthKey();
    const map = new Map<string, number>();
    for (const t of this.transactions()) {
      if (t.type !== 'expense') continue;
      const ev = transactionEventDate(t);
      if (!ev || this.toMonthKey(ev) !== mk) continue;
      const cat = (t.category ?? '').trim().toLowerCase() || 'uncategorized';
      map.set(cat, (map.get(cat) ?? 0) + (Number(t.amount ?? 0) || 0));
    }
    return map;
  });

  /** Current-month income total (zero-based allocation pool). */
  private readonly currentMonthIncome = computed(() => {
    const mk = this.currentMonthKey();
    let income = 0;
    for (const t of this.transactions()) {
      if (t.type !== 'income') continue;
      const ev = transactionEventDate(t);
      if (!ev || this.toMonthKey(ev) !== mk) continue;
      income += Number(t.amount ?? 0) || 0;
    }
    return income;
  });

  readonly summary = computed<SummaryCardModel>(() =>
    this.isCurrentMonth() ? this.currentMonthSummary() : this.snapshotSummary(),
  );

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

  readonly categoryCards = computed<CategoryBudgetCardModel[]>(() =>
    this.isCurrentMonth() ? this.currentMonthCards() : this.snapshotCards(),
  );

  // ─── Current-month (live) view models ─────────────────────────────

  private currentMonthSummary(): SummaryCardModel {
    const month = this.monthLabel();
    const monthSpent = this.monthTotalSpent();
    const totalLimit = this.budgetPlan()?.monthlyBudget ?? 0;
    const income = this.currentMonthIncome();
    const remaining = totalLimit - monthSpent;
    return {
      monthLabel: month,
      totalLimit,
      totalSpent: monthSpent,
      remaining,
      remainingDisplay: Math.max(0, remaining),
      overBudgetAmount: remaining < 0 ? -remaining : 0,
      daysLeft: this.daysLeftInMonth(new Date()),
      income,
      unbudgeted: income - totalLimit,
      isReadOnly: false,
    };
  }

  private monthTotalSpent(): number {
    const mk = this.currentMonthKey();
    return this.transactions().reduce((acc, t) => {
      if (t.type !== 'expense') return acc;
      const ev = transactionEventDate(t);
      if (!ev || this.toMonthKey(ev) !== mk) return acc;
      return acc + (Number(t.amount ?? 0) || 0);
    }, 0);
  }

  private currentMonthCards(): CategoryBudgetCardModel[] {
    const plan = this.budgetPlan();
    if (!plan) return [];

    const catById = new Map(this.categories().map((c) => [c.uid, c]));
    const spendByName = this.monthSpendByCategory();

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
      cards.push(this.toCard(name, categoryId, cat?.icon ?? 'tags', spent, limit, false));
    }

    const otherLimit = Math.max(0, (plan.monthlyBudget ?? 0) - budgetedLimitTotal);
    const otherSpent = Math.max(0, this.monthTotalSpent() - budgetedSpendTotal);
    if (otherLimit > 0 || otherSpent > 0) {
      cards.push(this.toCard('Other', '', 'other', otherSpent, otherLimit, true));
    }
    return this.sortCards(cards);
  }

  // ─── Past-month (snapshot) view models ────────────────────────────

  private snapshotSummary(): SummaryCardModel {
    const r = this.historicalReport();
    const allocated = r ? this.allocatedFromReport(r) : 0;
    const spent = r?.totalExpense ?? 0;
    const income = r?.totalIncome ?? 0;
    const remaining = allocated - spent;
    return {
      monthLabel: this.monthLabel(),
      totalLimit: allocated,
      totalSpent: spent,
      remaining,
      remainingDisplay: Math.max(0, remaining),
      overBudgetAmount: remaining < 0 ? -remaining : 0,
      daysLeft: 0,
      income,
      unbudgeted: income - allocated,
      isReadOnly: true,
    };
  }

  private snapshotCards(): CategoryBudgetCardModel[] {
    const r = this.historicalReport();
    if (!r) return [];
    const catByName = new Map(this.categories().map((c) => [c.name.trim().toLowerCase(), c]));
    const otherKey = monthlyReportCategoryKey('other');

    const cards: CategoryBudgetCardModel[] = [];
    for (const [key, entry] of Object.entries(r.categoryBreakdown ?? {})) {
      const isOther = key === otherKey;
      const limit = entry.budget ?? 0;
      // Skip categories that neither had a budget nor any spend this month.
      if (!isOther && limit <= 0 && entry.amount <= 0) continue;
      const categoryId = isOther ? '' : key.replace(/^cat_/, '');
      const icon = isOther ? 'other' : (catByName.get(entry.name.trim().toLowerCase())?.icon ?? 'tags');
      cards.push(this.toCard(entry.name, categoryId, icon, entry.amount, limit, isOther));
    }
    return this.sortCards(cards);
  }

  // ─── Shared card helpers ──────────────────────────────────────────

  private toCard(
    category: string,
    categoryId: string,
    icon: string,
    spent: number,
    limit: number,
    isOther: boolean,
  ): CategoryBudgetCardModel {
    const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const status: ProgressStatus = spent <= limit ? 'under' : 'over';
    const overAmount = spent > limit ? spent - limit : 0;
    return { category, categoryId, isOther, icon, spent, limit, percent, status, overAmount };
  }

  private sortCards(cards: CategoryBudgetCardModel[]): CategoryBudgetCardModel[] {
    return cards.sort((a, b) => {
      if (a.isOther && !b.isOther) return 1;
      if (!a.isOther && b.isOther) return -1;
      return a.category.localeCompare(b.category);
    });
  }

  /** Allocated budget total from a report: the stamped `totalBudget`, else Σ limits. */
  private allocatedFromReport(r: MonthlyReport): number {
    if (typeof r.totalBudget === 'number' && r.totalBudget > 0) return r.totalBudget;
    let sum = 0;
    for (const e of Object.values(r.categoryBreakdown ?? {})) {
      if (e.budget !== null && e.budget > 0) sum += e.budget;
    }
    return sum;
  }

  async ngOnInit() {
    this.loading.set(true);
    try {
      const account = await this.accountsService.getSelectedAccount();
      if (!account) return;
      this.currency.set(account.currency ?? 'INR');
      this.accountKey.set(account.uid ?? account.id ?? '');

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

      await this.loadAvailableMonths();
      this.queueProgressBarAnimation();
    } finally {
      this.loading.set(false);
    }
  }

  /** Months with a snapshot (≤ current) plus the current month, ascending. */
  private async loadAvailableMonths(): Promise<void> {
    const current = this.currentMonthKey();
    const key = this.accountKey();
    let months: string[] = [current];
    if (key) {
      try {
        const reports = await this.reportsService.getReportsForAccount(key);
        months = reports.map((r) => r.month).filter((m) => m <= current);
        if (!months.includes(current)) months.push(current);
      } catch {
        /* offline / no history — current month only */
      }
    }
    this.availableMonths.set([...new Set(months)].sort());
  }

  async goPrevMonth(): Promise<void> {
    if (!this.canGoPrev()) return;
    await this.selectMonth(this.availableMonths()[this.monthIndex() - 1]);
  }

  async goNextMonth(): Promise<void> {
    if (!this.canGoNext()) return;
    await this.selectMonth(this.availableMonths()[this.monthIndex() + 1]);
  }

  private async selectMonth(month: string): Promise<void> {
    this.expandedCategory.set(null);
    this.selectedMonth.set(month);
    if (month === this.currentMonthKey()) {
      this.historicalReport.set(null);
      this.queueProgressBarAnimation();
      return;
    }
    this.historyLoading.set(true);
    try {
      const report = await this.reportsService.getReportForMonth(this.accountKey(), month);
      this.historicalReport.set(report);
    } catch (e) {
      console.error(e);
      this.historicalReport.set(null);
    } finally {
      this.historyLoading.set(false);
      this.queueProgressBarAnimation();
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

  /** Toggle expanded state for the card; collapse others. Disabled for read-only months. */
  onCardClick(card: CategoryBudgetCardModel): void {
    if (!this.isCurrentMonth()) return;
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
    if (card.isOther || !this.isCurrentMonth()) return; // derived bucket / read-only
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
      // Plan edit applies to this month and future months (past stays frozen).
      await this.reportsService.rebuildCurrentAndFutureReports();
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

  private currentMonthKey(): string {
    return this.toMonthKey(new Date());
  }

  private toMonthKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private monthKeyLabel(monthKey: string): string {
    const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
    if (!y || !m) return monthKey;
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
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
