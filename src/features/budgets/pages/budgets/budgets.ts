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
import {
  transactionEventDate,
  toMonthKey,
  currentMonthKey as currentMonthKeyFn,
  monthKeyLabel,
  startOfMonth,
  endOfMonth,
  daysLeftInMonth,
  isoLocalDate,
} from '../../../../core/date';
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
  isAccountOwner = signal<boolean>(this.accountsService.isOwnerOfSelectedAccount() ?? false);

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

    const spendByName = this.monthSpendByCategory();
    const cards: CategoryBudgetCardModel[] = [];
    let budgetedLimitTotal = 0;
    let budgetedSpendTotal = 0;

    // Iterate ALL expense categories, not just those with a set limit. Users need to see
    // every category (with its month spend) to know which ones might need a budget. Income
    // is filtered out here — it's the allocation pool, not an expense category.
    for (const cat of this.categories()) {
      const name = (cat.name ?? 'Category').trim();
      if (this.isIncomeCategory(name)) continue;
      const limit = Number(plan.categoryBudgets[cat.uid] ?? 0);
      const spent = spendByName.get(name.toLowerCase()) ?? 0;
      if (limit > 0) {
        budgetedLimitTotal += limit;
        budgetedSpendTotal += spent;
      }
      cards.push(this.toCard(name || 'Category', cat.uid, cat.icon ?? 'tags', spent, limit, false));
    }

    const otherLimit = Math.max(0, (plan.monthlyBudget ?? 0) - budgetedLimitTotal);
    const otherSpent = Math.max(0, this.monthTotalSpent() - budgetedSpendTotal);
    if (otherLimit > 0 || otherSpent > 0) {
      cards.push(this.toCard('Other', '', 'other', otherSpent, otherLimit, true));
    }
    return this.sortCards(cards);
  }

  /** True when a category name should be treated as the "income" bucket (case-insensitive). */
  private isIncomeCategory(name: string): boolean {
    return name.trim().toLowerCase() === 'income';
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
      // Never show the Income bucket as a budget card — it isn't an expense category.
      if (!isOther && this.isIncomeCategory(entry.name)) continue;
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
    // No limit set → don't imply a state ("under"/"over") the user hasn't opted into.
    // The card is informational only (shows spend); status is `unset` so the template
    // renders a neutral progress bar and hides the percent chip.
    const hasNoLimit = limit <= 0;
    const percent = hasNoLimit ? 0 : Math.round((spent / limit) * 100);
    const status: ProgressStatus = hasNoLimit ? 'unset' : spent <= limit ? 'under' : 'over';
    const overAmount = !hasNoLimit && spent > limit ? spent - limit : 0;
    return {
      category, categoryId, isOther, icon, spent, limit, percent, status, hasNoLimit, overAmount,
    };
  }

  private sortCards(cards: CategoryBudgetCardModel[]): CategoryBudgetCardModel[] {
    // Grouping: (1) budgeted categories, (2) categories with no limit, (3) any "Other"
    // bucket — either the derived leftover card (isOther) or a real category literally
    // named "Other" from the default seed. Both play the "misc" role and belong last.
    const isOtherBucket = (c: CategoryBudgetCardModel) =>
      c.isOther || c.category.trim().toLowerCase() === 'other';
    const rank = (c: CategoryBudgetCardModel) =>
      isOtherBucket(c) ? 2 : c.hasNoLimit ? 1 : 0;
    return cards.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
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

  /** Toggle expanded state for the card; collapse others. Works for any month. */
  onCardClick(card: CategoryBudgetCardModel): void {
    const current = this.expandedCategory();
    this.expandedCategory.set(current === card.category ? null : card.category);
  }

  isCardExpanded(card: CategoryBudgetCardModel): boolean {
    return this.expandedCategory() === card.category;
  }

  /**
   * Open transaction list filtered to this budget's category for the selected month.
   *   - Current month → use the `month` preset chip (rolls with `now`).
   *   - Past month → use an explicit `dateFrom`/`dateTo` range for that month.
   */
  onSeeTransactions(event: Event, card: CategoryBudgetCardModel): void {
    event.stopPropagation();
    const month = this.selectedMonth();
    const isCurrent = month === this.currentMonthKey();
    const base = {
      type: 'expense',
      category: card.category,
      advanced: '1',
    } as Record<string, string>;
    const queryParams = isCurrent
      ? { ...base, date: 'month' }
      : {
          ...base,
          dateFrom: isoLocalDate(startOfMonth(month)),
          dateTo: isoLocalDate(endOfMonth(month)),
        };
    void this.router.navigate(['/user/transactions/list'], { queryParams });
  }

  onEditBudget(event: Event): void {
    event.stopPropagation();
    this.onEditPlan();
  }

  onDeleteRequest(event: Event, card: CategoryBudgetCardModel): void {
    event.stopPropagation();
    if (card.isOther) return; // derived bucket has no explicit limit to delete
    this.deletingCard.set(card);
    this.deletePromptOpen.set(true);
  }

  /** Reload the past-month snapshot after a snapshot mutation (e.g., delete). */
  private async refreshHistoricalReport(): Promise<void> {
    const month = this.selectedMonth();
    if (month === this.currentMonthKey()) return;
    try {
      const report = await this.reportsService.getReportForMonth(this.accountKey(), month);
      this.historicalReport.set(report);
    } catch {
      /* offline / already up-to-date — non-fatal */
    }
  }

  /**
   * Removing a category budget clears its limit; "Other" absorbs the leftover.
   *   - Current month → mutates the live plan; rebuilds current + future reports.
   *   - Past month → clears the limit on that month's report snapshot only.
   */
  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.deletingCard.set(null);
      return;
    }
    const card = this.deletingCard();
    if (!card) return;

    this.deleting.set(true);
    try {
      if (this.isCurrentMonth()) {
        const plan = this.budgetPlan();
        if (!plan) return;
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
      } else {
        const month = this.selectedMonth();
        const report = this.historicalReport();
        const total = report ? this.allocatedFromReport(report) : 0;
        await this.reportsService.updateReportBudgetSnapshot(month, total, {
          [card.categoryId]: null,
        });
        await this.refreshHistoricalReport();
      }
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
    // No limit set → render the bar as a neutral placeholder (no state color) so we
    // don't imply progress the user hasn't opted into.
    if (card.hasNoLimit) return 'bg-[var(--color-border)]';
    return categoryBudgetBarClass(card.percent, card.status === 'over');
  }

  private currentMonthKey(): string {
    return currentMonthKeyFn();
  }

  private toMonthKey(d: Date): string {
    return toMonthKey(d);
  }

  private monthKeyLabel(monthKey: string): string {
    return monthKeyLabel(monthKey, 'long');
  }

  private daysLeftInMonth(d: Date): number {
    return daysLeftInMonth(d);
  }

  goBack(): void {
    this.router.navigateByUrl('/user/dashboard');
  }
}
