import { inject, Injectable, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  collection,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { TransactionsService } from '../transactions/transactions.service';
import { BudgetsService } from '../budgets/budgets.service';
import { CategoriesService } from '../categories/categories.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import { date, transactionEventDate } from '../../core/date';
import { TransactionRecord } from '../../shared/models/transaction.model';
import { Budget } from '../../shared/models/budget.model';
import { Category } from '../categories/types';
import {
  MonthlyReport,
  CategoryBreakdownEntry,
  CategoryPieDataPoint,
  SavingsTrendDataPoint,
  BudgetTrackingCard,
  ReportSummary,
  ReportTimePeriod,
  MonthlyReportCreateInput,
  MonthlyReportUpdateInput,
  monthlyReportCategoryKey,
} from '../../shared/models/report.model';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { AccountsService } from '../accounts/accounts.service';

const STORE = 'monthly-reports';
const COLLECTION = 'monthlyReports';

// Distinct palette for categories
const CATEGORY_COLORS = [
  '#ed6a55', // pastel orange
  '#fc74ab', // pastel pink
  '#f7b800', // pastel yellow
  '#4aa9b0', // pastel blue
  '#9561e2', // pastel purple
  '#50c878', // pastel green
  '#00b9e4', // pastel cyan
  '#ff6b6b', // pastel red
  '#90ee90', // pastel light green
  '#ffe5b4', // pastel peach
];

// ─── Public surface returned to the Reports component ────────────────────────

export interface ReportViewData {
  summary: ReportSummary;
  barData: Array<{ label: string; income: number; expense: number }>;
  pieData: CategoryPieDataPoint[];
  savingsTrend: SavingsTrendDataPoint[];
  budgetCards: BudgetTrackingCard[];
  topCategories: { category: string; amount: number; color: string; icon: string }[];
  xAxisLabels: string[];
}

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly transactionsService = inject(TransactionsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly accountsService = inject(AccountsService);

  /** Latest current-month row for the dashboard (updates after background re-fetch). */
  readonly dashboardMonthReport = signal<MonthlyReport | null>(null);

  private async resolveAccountKey(): Promise<string | null> {
    const a = await this.accountsService.getSelectedAccount();
    return a?.uid ?? a?.id ?? null;
  }

  private get uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Builds chart/summary view data from transactions (local cache / sync pipeline).
   * IndexedDB is read first via the same offlineCrud cache-first paths as the rest of the app;
   * Firestore revalidation runs in the background. Monthly report docs are refreshed the same way.
   */
  async getReportViewData(period: ReportTimePeriod): Promise<ReportViewData> {
    const [categories, budgets, transactions] = await Promise.all([
      this.categoriesService.getCategories(),
      this.budgetsService.getBudgets(),
      this.transactionsService.getTransactions(),
    ]);

    const iconMap = new Map<string, string>(
      categories.map((c: Category) => [c.name.toLowerCase(), c.icon]),
    );

    return this.buildViewData(transactions, budgets, iconMap, period);
  }

  /**
   * Called after every new transaction (regular or recurring).
   * If no monthly report exists for that calendar month, creates one with full
   * totals, categoryBreakdown (schema in `todo.txt`), and budget math.
   * Otherwise recomputes the month from all transactions and merges with
   * existing metadata (createdAt, recurrings, isFinalized).
   */
  async updateReportForTransaction(transaction: TransactionRecord): Promise<void> {
    const accountId = await this.resolveAccountKey();
    if (!accountId) return;

    const occurred = transactionEventDate(transaction) ?? new Date();
    const month = this.toMonthKey(occurred);
    await this.createOrUpdateMonthlyReport(month);
  }

  /**
   * Returns the current month's report from IndexedDB when present, or builds it once from
   * transactions/budgets/categories when missing and online. Does not recompute on every read:
   * {@link updateReportForTransaction}, {@link rebuildCurrentMonthReport}, and onboarding
   * flows keep the doc in sync and avoid redundant Firestore writes on dashboard load.
   */
  async ensureCurrentMonthReport(): Promise<MonthlyReport | null> {
    const accountId = await this.resolveAccountKey();
    if (!accountId) {
      this.dashboardMonthReport.set(null);
      return null;
    }

    const month = this.toMonthKey(date().toDate());
    const cached = await this.findReportForMonthInCacheOnly(accountId, month);
    if (cached) {
      this.dashboardMonthReport.set(cached);
      return cached;
    }
    if (!this.network.isOnline()) {
      this.dashboardMonthReport.set(null);
      return null;
    }
    try {
      await this.createOrUpdateMonthlyReport(month);
    } catch {
      /* offline / sync error */
    }
    const built = await this.findReportForMonthInCacheOnly(accountId, month);
    this.dashboardMonthReport.set(built);
    return built;
  }

  /**
   * Recomputes the current calendar month report from transactions, budgets, and categories.
   * Call after budget changes or when a new category should appear in `categoryBreakdown`.
   */
  async rebuildCurrentMonthReport(): Promise<void> {
    const month = this.toMonthKey(date().toDate());
    await this.createOrUpdateMonthlyReport(month);
  }

  /**
   * Lightweight update when a category is renamed: same `cat_<id>` key; only `name` is updated.
   */
  async patchCategoryNameInCurrentMonthReport(categoryId: string, newName: string): Promise<void> {
    const accountId = await this.resolveAccountKey();
    if (!accountId) return;

    const month = this.toMonthKey(date().toDate());
    const report = await this.findReportForMonth(accountId, month);
    if (!report) return;

    const bk = monthlyReportCategoryKey(categoryId);
    const row = report.categoryBreakdown[bk];
    if (!row) return;

    const categoryBreakdown = { ...report.categoryBreakdown };
    categoryBreakdown[bk] = { ...row };
    categoryBreakdown[bk].name = newName.trim();

    await this.updateReport(report.uid, {
      categoryBreakdown,
      updatedAt: new Date(),
    });
  }

  /**
   * When a category is created, add one `categoryBreakdown` row with initial totals.
   * If there is no monthly report yet, builds the month once (includes the new category).
   */
  async appendCategoryToCurrentMonthReport(categoryId: string, displayName: string): Promise<void> {
    const accountId = await this.resolveAccountKey();
    if (!accountId) return;

    const month = this.toMonthKey(date().toDate());
    const report = await this.findReportForMonth(accountId, month);
    if (!report) {
      await this.createOrUpdateMonthlyReport(month);
      return;
    }

    const bk = monthlyReportCategoryKey(categoryId);
    if (report.categoryBreakdown[bk]) return;

    const name = displayName.trim() || 'Uncategorized';
    await this.updateReport(report.uid, {
      categoryBreakdown: {
        ...report.categoryBreakdown,
        [bk]: {
          name,
          amount: 0,
          budget: null,
          used: 0,
          overspent: false,
        },
      },
      updatedAt: new Date(),
    });
  }

  /**
   * After onboarding: one monthly report for the current month with zero income/expense and a
   * {@link CategoryBreakdownEntry} per created category (optional budget limit on one category).
   * Skips if a row for this month already exists. Uses {@link createReport} (offlineCrud-first).
   */
  async createOnboardingStarterMonthlyReport(
    accountId: string,
    categories: Array<{ uid: string; name: string }>,
    budgetForCategory?: { categoryUid: string; limit: number } | null,
  ): Promise<void> {
    if (!accountId || categories.length === 0) return;

    const monthKey = this.toMonthKey(date().toDate());
    const existing = await this.findReportForMonthInCacheOnly(accountId, monthKey);
    if (existing) return;

    const categoryBreakdown: Record<string, CategoryBreakdownEntry> = {};
    for (const c of categories) {
      const hasBudget =
        budgetForCategory && budgetForCategory.categoryUid === c.uid && budgetForCategory.limit > 0;
      categoryBreakdown[monthlyReportCategoryKey(c.uid)] = {
        name: c.name,
        amount: 0,
        budget: hasBudget ? budgetForCategory.limit : null,
        used: 0,
        overspent: false,
      };
    }

    const now = new Date();
    const day = date().format('YYYY-MM-DD');
    await this.createReport({
      month: monthKey,
      accountId,
      totalIncome: 0,
      totalExpense: 0,
      savings: 0,
      totalBudgetUsed: 0,
      categoryBreakdown,
      recurrings: { totalIncome: 0, totalExpense: 0, spentOn: [] },
      isFinalized: false,
      date: day,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * @deprecated Prefer {@link ensureCurrentMonthReport} — avoids duplicate fetches in callers.
   */
  async computeAndSaveCurrentMonth(
    _transactions?: TransactionRecord[],
    _budgets?: Budget[],
  ): Promise<MonthlyReport | null> {
    return this.ensureCurrentMonthReport();
  }

  /**
   * i. Read existing row from IndexedDB.
   * ii. Build full payload (todo.txt monthly schema).
   * iii. If a row exists → update (preserve createdAt / recurrings / isFinalized); else create.
   */
  private async createOrUpdateMonthlyReport(monthKey: string): Promise<void> {
    const accountId = await this.resolveAccountKey();
    if (!accountId) return;
    const existing = await this.findReportForMonth(accountId, monthKey);

    const [transactions, budgets, categories] = await Promise.all([
      this.transactionsService.getTransactions(),
      this.budgetsService.getBudgets(),
      this.categoriesService.getCategories(),
    ]);

    const payload = this.buildMonthlyReportPayload(
      accountId,
      monthKey,
      transactions,
      budgets,
      categories,
    );

    const report: MonthlyReportCreateInput | MonthlyReportUpdateInput = existing
      ? {
          ...payload,
          recurrings: existing.recurrings,
          isFinalized: existing.isFinalized,
          createdAt: existing.createdAt ?? new Date(),
          updatedAt: new Date(),
        }
      : {
          date: date().format('YYYY-MM-DD'),
          ...payload,
          recurrings: { totalIncome: 0, totalExpense: 0, spentOn: [] },
          isFinalized: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

    if (existing) {
      await this.updateReport(existing.uid, report as MonthlyReportUpdateInput);
    } else {
      await this.createReport(report as MonthlyReportCreateInput);
    }
  }

  private buildMonthlyReportPayload(
    accountId: string,
    monthKey: string,
    transactions: TransactionRecord[],
    budgets: Budget[],
    categories: Category[],
  ): MonthlyReportCreateInput | MonthlyReportUpdateInput {
    const monthTransactions = this.filterTransactionsForMonth(transactions, monthKey);
    const byLowerName = this.categoriesByLowerName(categories);
    const { totalIncome, totalExpense, expenseByCategory } = this.rollUpMonthExpenseAndIncome(
      monthTransactions,
      byLowerName,
    );

    const budgetByCategory = this.aggregateBudgetsByCategoryForMonth(
      monthKey,
      budgets,
      byLowerName,
    );
    const totalBudget = [...budgetByCategory.values()].reduce((a, b) => a + b, 0);
    const totalBudgetUsed = totalBudget > 0 ? Math.round((totalExpense / totalBudget) * 100) : 0;

    const categoryBreakdown = this.buildCategoryBreakdown(
      expenseByCategory,
      budgetByCategory,
      categories,
    );

    return {
      month: monthKey,
      accountId,
      totalIncome,
      totalExpense,
      savings: totalIncome - totalExpense,
      totalBudgetUsed,
      categoryBreakdown,
    };
  }

  private filterTransactionsForMonth(
    transactions: TransactionRecord[],
    monthKey: string,
  ): TransactionRecord[] {
    return transactions.filter((t) => {
      const ev = transactionEventDate(t);
      return ev !== null && this.toMonthKey(ev) === monthKey;
    });
  }

  private rollUpMonthExpenseAndIncome(
    monthTransactions: TransactionRecord[],
    byLowerName: Map<string, Category>,
  ): {
    totalIncome: number;
    totalExpense: number;
    expenseByCategory: Map<string, { amount: number; displayName: string }>;
  } {
    let totalIncome = 0;
    let totalExpense = 0;
    const expenseByCategory = new Map<string, { amount: number; displayName: string }>();

    for (const t of monthTransactions) {
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') {
        totalIncome += amt;
      } else {
        totalExpense += amt;
        const raw = (t.category ?? '').trim();
        const { id, displayName } = this.resolveExpenseCategory(raw, byLowerName);
        const prev = expenseByCategory.get(id);
        expenseByCategory.set(id, {
          amount: (prev?.amount ?? 0) + amt,
          displayName: prev ? prev.displayName : displayName,
        });
      }
    }

    return { totalIncome, totalExpense, expenseByCategory };
  }

  private categoriesByLowerName(categories: Category[]): Map<string, Category> {
    const map = new Map<string, Category>();
    for (const c of categories) {
      const k = (c.name ?? '').trim().toLowerCase();
      if (k) map.set(k, c);
    }
    return map;
  }

  /**
   * Stable pseudo-id for spend on a category name that does not match any `Category` row.
   */
  private stableNameHash(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  /** Maps `TransactionRecord.category` (label) to a breakdown id and display name. */
  private resolveExpenseCategory(
    categoryName: string,
    byLowerName: Map<string, Category>,
  ): { id: string; displayName: string } {
    const raw = (categoryName ?? '').trim();
    const lower = raw.toLowerCase();
    if (!lower || lower === 'other' || lower === 'uncategorized') {
      return { id: 'other', displayName: raw || 'Other' };
    }
    const cat = byLowerName.get(lower);
    if (cat) return { id: cat.uid, displayName: cat.name };
    return { id: `unmapped_${this.stableNameHash(lower)}`, displayName: raw };
  }

  private monthLongNameFromMonthKey(monthKey: string): string {
    const parts = monthKey.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (!y || !m) return '';
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
  }

  /** Budget rows that apply to this report month (unset month = all months). */
  private filterBudgetsForMonth(monthKey: string, budgets: Budget[]): Budget[] {
    const longName = this.monthLongNameFromMonthKey(monthKey);
    return budgets.filter((b) => {
      const bm = (b.month ?? '').trim();
      if (!bm) return true;
      const bml = bm.toLowerCase();
      return bml === longName.toLowerCase() || bm === monthKey || bm.startsWith(`${monthKey}-`);
    });
  }

  private aggregateBudgetsByCategoryForMonth(
    monthKey: string,
    budgets: Budget[],
    byLowerName: Map<string, Category>,
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const b of this.filterBudgetsForMonth(monthKey, budgets)) {
      let id: string;
      const catId = b.categoryId?.trim();
      if (catId) {
        id = catId;
      } else {
        const catName = (b.category ?? '').trim() || 'Uncategorized';
        id = this.resolveExpenseCategory(catName, byLowerName).id;
      }
      map.set(id, (map.get(id) ?? 0) + Number(b.limit ?? 0));
    }
    return map;
  }

  private buildCategoryBreakdown(
    expenseByCategory: Map<string, { amount: number; displayName: string }>,
    budgetByCategory: Map<string, number>,
    categories: Category[],
  ): Record<string, CategoryBreakdownEntry> {
    const byId = new Map<string, Category>();
    for (const c of categories) byId.set(c.uid, c);

    const ids = new Set<string>();
    expenseByCategory.forEach((_, k) => ids.add(k));
    budgetByCategory.forEach((_, k) => ids.add(k));
    for (const c of categories) ids.add(c.uid);

    const breakdown: Record<string, CategoryBreakdownEntry> = {};
    for (const id of ids) {
      const exp = expenseByCategory.get(id);
      const amount = exp?.amount ?? 0;
      const budget = budgetByCategory.has(id) ? budgetByCategory.get(id)! : null;
      const cat = byId.get(id);
      const name = cat?.name ?? exp?.displayName ?? 'Other';
      const used = budget !== null && budget > 0 ? Math.round((amount / budget) * 100) : 0;
      const overspent = budget !== null && budget > 0 && amount > budget;
      breakdown[monthlyReportCategoryKey(id)] = {
        name,
        amount,
        budget,
        used,
        overspent,
      };
    }
    return breakdown;
  }

  // ─── View-data builders ───────────────────────────────────────────────────

  private buildViewData(
    transactions: TransactionRecord[],
    budgets: Budget[],
    iconMap: Map<string, string>,
    period: ReportTimePeriod,
  ): ReportViewData {
    const filtered = this.filterByPeriod(transactions, period);

    const barData = this.buildBarData(transactions, period);
    const xAxisLabels = barData.map((d) => d.label);

    return {
      summary: this.computeSummary(filtered),
      barData,
      pieData: this.computePieData(filtered),
      savingsTrend: this.computeSavingsTrend(transactions, period),
      budgetCards: this.computeBudgetCards(transactions, budgets, iconMap),
      topCategories: this.computeTopCategories(filtered, iconMap),
      xAxisLabels,
    };
  }

  // ─── Period filtering ─────────────────────────────────────────────────────

  private filterByPeriod(
    transactions: TransactionRecord[],
    period: ReportTimePeriod,
  ): TransactionRecord[] {
    const now = new Date();
    if (period === 'all') return transactions;
    if (period === 'day') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return transactions.filter((t) => {
        const ev = transactionEventDate(t);
        return ev !== null && ev >= start;
      });
    }
    if (period === 'week') {
      const day = now.getDay(); // 0=Sun
      const start = new Date(now);
      start.setDate(now.getDate() - day);
      start.setHours(0, 0, 0, 0);
      return transactions.filter((t) => {
        const ev = transactionEventDate(t);
        return ev !== null && ev >= start;
      });
    }
    const cutoff = new Date(now);
    if (period === '1M') cutoff.setMonth(now.getMonth() - 1);
    else if (period === '3M') cutoff.setMonth(now.getMonth() - 3);
    else if (period === '6M') cutoff.setMonth(now.getMonth() - 6);
    else if (period === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
    return transactions.filter((t) => {
      const ev = transactionEventDate(t);
      return ev !== null && ev >= cutoff;
    });
  }

  // ─── Bar data (daily / weekly / monthly) ─────────────────────────────────

  private buildBarData(
    transactions: TransactionRecord[],
    period: ReportTimePeriod,
  ): Array<{ label: string; income: number; expense: number }> {
    if (period === 'day') return this.computeDailyData(transactions);
    if (period === 'week') return this.computeWeeklyData(transactions);
    return this.computeMonthBarData(transactions, period);
  }

  /** Hourly buckets for today (0–23 h, grouped to 6 slots: 0–3, 4–7, 8–11, 12–15, 16–19, 20–23) */
  private computeDailyData(
    transactions: TransactionRecord[],
  ): Array<{ label: string; income: number; expense: number }> {
    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const slots = [
      { label: '12am', start: 0, end: 4 },
      { label: '4am', start: 4, end: 8 },
      { label: '8am', start: 8, end: 12 },
      { label: '12pm', start: 12, end: 16 },
      { label: '4pm', start: 16, end: 20 },
      { label: '8pm', start: 20, end: 24 },
    ];

    const result = slots.map((s) => ({ label: s.label, income: 0, expense: 0 }));

    for (const t of transactions) {
      const d = transactionEventDate(t);
      if (!d) continue;
      if (d < dayStart) continue;
      const h = d.getHours();
      const idx = Math.min(Math.floor(h / 4), 5);
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') result[idx].income += amt;
      else result[idx].expense += amt;
    }
    return result;
  }

  /** Day-of-week buckets: Sun – Sat for the current week */
  private computeWeeklyData(
    transactions: TransactionRecord[],
  ): Array<{ label: string; income: number; expense: number }> {
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = DAY_LABELS.map((l) => ({ label: l, income: 0, expense: 0 }));

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    for (const t of transactions) {
      const d = transactionEventDate(t);
      if (!d) continue;
      if (d < weekStart) continue;
      const idx = d.getDay();
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') result[idx].income += amt;
      else result[idx].expense += amt;
    }
    return result;
  }

  private computeMonthBarData(
    transactions: TransactionRecord[],
    period: ReportTimePeriod,
  ): Array<{ label: string; income: number; expense: number }> {
    const months = this.getMonthKeys(period);
    const map = new Map<string, { income: number; expense: number }>();
    for (const m of months) map.set(m, { income: 0, expense: 0 });

    for (const t of transactions) {
      const ev = transactionEventDate(t);
      if (!ev) continue;
      const key = this.toMonthKey(ev);
      if (!map.has(key)) continue;
      const entry = map.get(key)!;
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') entry.income += amt;
      else entry.expense += amt;
    }

    return months.map((key) => {
      const d = map.get(key)!;
      return {
        label: this.formatMonthLabel(key),
        month: this.formatMonthLabel(key),
        income: d.income,
        expense: d.expense,
      };
    });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  private computeSummary(transactions: TransactionRecord[]): ReportSummary {
    let totalIncome = 0;
    let totalExpense = 0;
    for (const t of transactions) {
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') totalIncome += amt;
      else totalExpense += amt;
    }
    const savings = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0;
    return { totalIncome, totalExpense, savings, savingsRate };
  }

  // ─── Pie chart: spending by category ─────────────────────────────────────

  private computePieData(transactions: TransactionRecord[]): CategoryPieDataPoint[] {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const cat = (t.category ?? '').trim() || 'Other';
      map.set(cat, (map.get(cat) ?? 0) + Number(t.amount ?? 0));
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount], i) => ({
        category,
        amount,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      }));
  }

  // ─── Savings trend line chart ─────────────────────────────────────────────

  private computeSavingsTrend(
    transactions: TransactionRecord[],
    period: ReportTimePeriod,
  ): SavingsTrendDataPoint[] {
    if (period === 'day') {
      const daily = this.computeDailyData(transactions);
      return daily.map((d) => ({
        label: d.label,
        savings: d.income - d.expense,
        expense: d.expense,
      }));
    }
    if (period === 'week') {
      const weekly = this.computeWeeklyData(transactions);
      return weekly.map((d) => ({
        label: d.label,
        savings: d.income - d.expense,
        expense: d.expense,
      }));
    }
    const months = this.getMonthKeys(period);
    const map = new Map<string, { income: number; expense: number }>();
    for (const m of months) map.set(m, { income: 0, expense: 0 });
    for (const t of transactions) {
      const ev = transactionEventDate(t);
      if (!ev) continue;
      const key = this.toMonthKey(ev);
      if (!map.has(key)) continue;
      const entry = map.get(key)!;
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') entry.income += amt;
      else entry.expense += amt;
    }
    return months.map((key) => {
      const d = map.get(key)!;
      return {
        label: this.formatMonthLabel(key),
        savings: d.income - d.expense,
        expense: d.expense,
      };
    });
  }

  // ─── Budget tracking ──────────────────────────────────────────────────────

  private computeBudgetCards(
    transactions: TransactionRecord[],
    budgets: Budget[],
    iconMap: Map<string, string>,
  ): BudgetTrackingCard[] {
    const currentMonth = this.toMonthKey(date().toDate());
    const currentMonthLabel = date().toDate().toLocaleString('en-US', { month: 'long' });

    const relevantBudgets = budgets.filter((b) => {
      const bm = (b.month ?? '').trim();
      return !bm || bm.toLowerCase() === currentMonthLabel.toLowerCase();
    });

    const spentMap = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const ev = transactionEventDate(t);
      if (!ev || this.toMonthKey(ev) !== currentMonth) continue;
      const cat = (t.category ?? '').trim() || 'Uncategorized';
      spentMap.set(cat, (spentMap.get(cat) ?? 0) + Number(t.amount ?? 0));
    }

    return relevantBudgets.map((b) => {
      const cat = (b.category ?? '').trim() || 'Uncategorized';
      const amount = spentMap.get(cat) ?? 0;
      const budget = b.limit;
      const used = budget > 0 ? Math.round((amount / budget) * 100) : 0;
      return {
        category: cat,
        icon: iconMap.get(cat.toLowerCase()) ?? 'tags',
        amount,
        budget,
        used,
        overspent: amount > budget,
      };
    });
  }

  // ─── Top spending categories ──────────────────────────────────────────────

  private computeTopCategories(
    transactions: TransactionRecord[],
    iconMap: Map<string, string>,
  ): { category: string; amount: number; color: string; icon: string }[] {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const cat = (t.category ?? '').trim() || 'Other';
      map.set(cat, (map.get(cat) ?? 0) + Number(t.amount ?? 0));
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([category, amount], i) => ({
        category,
        amount,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        icon: iconMap.get(category.toLowerCase()) ?? 'tags',
      }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toMonthKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private formatMonthLabel(key: string): string {
    const [y, m] = key.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleString('en-US', { month: 'short' });
  }

  private getMonthKeys(period: ReportTimePeriod): string[] {
    const now = new Date();
    let count = 3;
    if (period === '1M') count = 1;
    else if (period === '3M') count = 3;
    else if (period === '6M') count = 6;
    else if (period === '1Y') count = 12;
    else count = 12; // 'all' → last 12 months
    const keys: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(this.toMonthKey(d));
    }
    return keys;
  }

  private normalizeCategoryBreakdown(
    raw: Record<string, unknown> | undefined,
  ): Record<string, CategoryBreakdownEntry> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, CategoryBreakdownEntry> = {};
    for (const [key, val] of Object.entries(raw)) {
      if (!val || typeof val !== 'object') continue;
      const o = val as Record<string, unknown>;
      const storageKey = key.startsWith('cat_') ? key : `cat_legacy_${this.stableNameHash(key)}`;
      const budgetRaw = o['budget'];
      const amount = Number(o['amount'] ?? 0);
      const budget = budgetRaw == null || budgetRaw === 'null' ? null : Number(budgetRaw);
      const usedRaw = o['used'];
      const overspentRaw = o['overspent'];
      const nameRaw = o['name'];
      const name =
        typeof nameRaw === 'string' && nameRaw.trim()
          ? nameRaw.trim()
          : key.startsWith('cat_')
            ? ''
            : key;
      const used =
        typeof usedRaw === 'number'
          ? usedRaw
          : budget !== null && budget > 0
            ? Math.round((amount / budget) * 100)
            : 0;
      const overspent =
        typeof overspentRaw === 'boolean'
          ? overspentRaw
          : budget !== null && budget > 0 && amount > budget;
      out[storageKey] = {
        name: name || 'Other',
        amount,
        budget,
        used,
        overspent,
      };
    }
    return out;
  }

  private mapReport(id: string, data: Record<string, unknown>): MonthlyReport {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      uid: id,
      month: (data['month'] as string) ?? '',
      accountId: (data['accountId'] as string) ?? '',
      totalIncome: Number(data['totalIncome'] ?? 0),
      totalExpense: Number(data['totalExpense'] ?? 0),
      savings: Number(data['savings'] ?? 0),
      totalBudgetUsed: Number(data['totalBudgetUsed'] ?? 0),
      categoryBreakdown: this.normalizeCategoryBreakdown(
        data['categoryBreakdown'] as Record<string, unknown> | undefined,
      ),
      recurrings: (data['recurrings'] as MonthlyReport['recurrings']) ?? {
        totalIncome: 0,
        totalExpense: 0,
        spentOn: [],
      },
      isFinalized: Boolean(data['isFinalized'] ?? false),
      date:
        typeof data['date'] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data['date'])
          ? (data['date'] as string).slice(0, 10)
          : undefined,
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }

  /** Prefer {@link findReportForMonth}; this loads a single document by Firestore id. */
  private async fetchReportByDocId(docId: string): Promise<MonthlyReport | null> {
    try {
      const snap = await getDoc(doc(this.firestore, COLLECTION, docId));
      if (!snap.exists()) return null;
      return this.mapReport(snap.id, snap.data() as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /** IndexedDB only — no Firestore (matches offline-first reads elsewhere). */
  private async findReportForMonthInCacheOnly(
    accountId: string,
    monthKey: string,
  ): Promise<MonthlyReport | null> {
    const rows = await this.cache.getAllByIndex<MonthlyReport>(STORE, 'accountId', accountId);
    return rows.find((r) => r.month === monthKey) ?? null;
  }

  /** Cache first; if missing and online, fetch this month from Firestore and seed IDB. */
  private async findReportForMonth(
    accountId: string,
    monthKey: string,
  ): Promise<MonthlyReport | null> {
    const fromCache = await this.findReportForMonthInCacheOnly(accountId, monthKey);
    if (fromCache) return fromCache;
    if (!this.network.isOnline()) return null;
    try {
      const snap = await getDocs(
        query(
          collection(this.firestore, COLLECTION),
          where('accountId', '==', accountId),
          where('month', '==', monthKey),
        ),
      );
      if (snap.empty) return null;
      const d = snap.docs[0];
      const mapped = this.mapReport(d.id, d.data() as Record<string, unknown>);
      await this.cache.put(STORE, mapped);
      return mapped;
    } catch {
      return null;
    }
  }

  async createReport(data: MonthlyReportCreateInput): Promise<MonthlyReport> {
    const payload = { ...(data as unknown as Record<string, unknown>) };
    return this.offlineCrud.create<MonthlyReport>(
      STORE,
      'uid',
      async (assignedId: string) => {
        const ref = doc(this.firestore, COLLECTION, assignedId);
        await setDoc(ref, { ...payload, uid: assignedId });
        const row = await this.fetchReportByDocId(assignedId);
        if (!row) {
          throw new Error('Failed to read report after creation.');
        }
        return row;
      },
      payload,
    );
  }

  async applyPendingMonthlyReportCreate(
    docId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const ref = doc(this.firestore, COLLECTION, docId);
    await setDoc(ref, { ...data, uid: docId });
    const row = await this.fetchReportByDocId(docId);
    if (!row) throw new Error('Failed to read report after pending create sync.');
    await this.cache.put(STORE, { ...row, _pendingSync: false });
  }

  async updateReport(reportId: string, patch: MonthlyReportUpdateInput): Promise<void> {
    const cached = await this.offlineCrud.fetchOne<MonthlyReport>(STORE, reportId, async () => {
      const snap = await getDoc(doc(this.firestore, `${COLLECTION}/${reportId}`));
      if (!snap.exists()) return null;
      return this.mapReport(snap.id, snap.data());
    });

    if (!cached) {
      throw new Error('Report not found or access denied.');
    }

    const patchRecord: Record<string, unknown> = patch as unknown as Record<string, unknown>;

    await this.offlineCrud.update<MonthlyReport>(
      STORE,
      reportId,
      async () => {
        const reportRef = doc(this.firestore, `${COLLECTION}/${reportId}`);
        const existing = await getDoc(reportRef);
        const selected = await this.accountsService.getSelectedAccount();
        const expectedKey = selected?.uid ?? selected?.id;
        if (!existing.exists() || existing.data()['accountId'] !== expectedKey) {
          throw new Error('Report not found or access denied.');
        }
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await updateDoc(reportRef, updates);
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }
}
