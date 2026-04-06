import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  collection,
  doc,
  Firestore,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@angular/fire/firestore';
import { TransactionsService } from './transactions.service';
import { BudgetsService } from './budgets.service';
import { CategoriesService } from './categories.service';
import { IndexedDbCacheService } from '../core/offline/indexed-db-cache.service';
import { NetworkService } from '../core/offline/network.service';
import { date, transactionEventDate } from '../core/date';
import { Account } from '../shared/models/account.model';
import { TransactionRecord } from '../shared/models/transaction.model';
import { Budget } from '../shared/models/budget.model';
import { Category } from '../features/categories/types';
import {
  MonthlyReport,
  CategoryBreakdownEntry,
  CategoryPieDataPoint,
  SavingsTrendDataPoint,
  BudgetTrackingCard,
  ReportSummary,
  ReportTimePeriod,
} from '../shared/models/report.model';

const STORE = 'monthly-reports';
const COLLECTION = 'monthlyReports';

// Distinct palette for categories
const CATEGORY_COLORS = [
  '#f97316',
  '#ec4899',
  '#eab308',
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#06b6d4',
  '#f43f5e',
  '#a3e635',
  '#fb923c',
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

  get currentAccount(): Account | null {
    return JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
  }

  private get accountKey(): string | null {
    const a = this.currentAccount;
    return a?.uid ?? a?.id ?? null;
  }

  private get uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called on Reports page init.
   * 1. Returns data from IndexedDB if present (offline-first).
   * 2. If IDB empty → fetch from Firestore and seed IDB.
   * 3. Builds view data from the stored monthly-reports + raw transactions.
   */
  async getReportViewData(period: ReportTimePeriod): Promise<ReportViewData> {
    const [categories, budgets] = await Promise.all([
      this.categoriesService.getCategories(),
      this.budgetsService.getBudgets(),
    ]);

    const iconMap = new Map<string, string>(
      categories.map((c: Category) => [c.name.toLowerCase(), c.icon]),
    );

    // Ensure monthly-reports are loaded into IDB (offline-first seeding)
    await this.ensureMonthlyReportsInCache();

    // Load raw transactions for daily/weekly detail and current-month granularity
    const transactions = await this.transactionsService.getTransactions();

    return this.buildViewData(transactions, budgets, iconMap, period);
  }

  /**
   * Called after every new transaction (regular or recurring).
   * Updates — or creates — the MonthlyReport record for the transaction's month
   * in IndexedDB first, then syncs to Firestore in background.
   */
  async updateReportForTransaction(transaction: TransactionRecord): Promise<void> {
    const accountId = this.accountKey;
    if (!accountId) return;

    const occurred = transactionEventDate(transaction) ?? new Date();
    const month = this.toMonthKey(occurred); // 'YYYY-MM'
    const reportUid = `${accountId}_${month}`;

    // Load existing or create blank skeleton
    let report = await this.cache.getByKey<MonthlyReport>(STORE, reportUid);
    if (!report) {
      report = this.blankReport(reportUid, accountId, month);
    }

    // Apply the transaction delta
    const amt = Number(transaction.amount ?? 0);
    if (transaction.type === 'income') {
      report.totalIncome += amt;
    } else {
      report.totalExpense += amt;
      const cat = (transaction.category ?? '').trim() || 'Other';
      if (!report.categoryBreakdown[cat]) {
        report.categoryBreakdown[cat] = { amount: 0, budget: null, used: 0, overspent: false };
      }
      report.categoryBreakdown[cat].amount += amt;
    }
    report.savings = report.totalIncome - report.totalExpense;
    report.updatedAt = new Date();

    // Persist to IDB immediately
    await this.cache.put<MonthlyReport>(STORE, report);

    // Background sync to Firestore
    if (this.network.isOnline()) {
      this.pushReportToFirestore(report).catch(() => {
        /* silent – will be stale until next full refresh */
      });
    }
  }

  // ─── Private: cache seeding ───────────────────────────────────────────────

  private async ensureMonthlyReportsInCache(): Promise<void> {
    const accountId = this.accountKey;
    if (!accountId) return;

    // Check if IDB already has reports for this account
    const cached = await this.cache.getAllByIndex<MonthlyReport>(STORE, 'accountId', accountId);

    if (cached.length > 0) {
      // Already seeded; background-refresh from Firestore
      if (this.network.isOnline()) {
        this.fetchAndSeedFromFirestore(accountId).catch(() => {});
      }
      return;
    }

    // IDB empty — fetch from Firestore first (blocking on first load)
    if (this.network.isOnline()) {
      await this.fetchAndSeedFromFirestore(accountId);
    }
    // If still empty (new user / no Firestore records), we'll compute on the fly from transactions
  }

  private async fetchAndSeedFromFirestore(accountId: string): Promise<void> {
    try {
      const snap = await getDocs(
        query(
          collection(this.firestore, COLLECTION),
          where('accountId', '==', accountId),
        ),
      );
      const reports = snap.docs.map((d) => this.mapReport(d.id, d.data()));
      if (reports.length > 0) {
        await this.cache.putAll<MonthlyReport>(STORE, reports);
      }
    } catch {
      /* offline or permission error — silent */
    }
  }

  // ─── Public: push a freshly-computed report to Firestore (called by component after first build) ──

  async pushReportToFirestore(report: MonthlyReport): Promise<void> {
    if (!this.network.isOnline()) return;
    try {
      const ref = doc(collection(this.firestore, COLLECTION), report.uid);
      await setDoc(
        ref,
        {
          uid: report.uid,
          month: report.month,
          accountId: report.accountId,
          totalIncome: report.totalIncome,
          totalExpense: report.totalExpense,
          savings: report.savings,
          totalBudgetUsed: report.totalBudgetUsed,
          categoryBreakdown: report.categoryBreakdown,
          recurrings: report.recurrings,
          isFinalized: report.isFinalized,
          date: date().format('YYYY-MM-DD'),
          updatedAt: serverTimestamp(),
          createdAt: report.createdAt ?? serverTimestamp(),
        },
        { merge: true },
      );
    } catch {
      /* silent */
    }
  }

  /**
   * Computes the current-month MonthlyReport from raw transactions + budgets
   * and upserts it in IDB + Firestore.
   * Call this on first load when IDB has no record for the current month.
   */
  async computeAndSaveCurrentMonth(
    transactions: TransactionRecord[],
    budgets: Budget[],
  ): Promise<MonthlyReport | null> {
    const accountId = this.accountKey;
    if (!accountId) return null;

    const month = this.toMonthKey(date().toDate());
    const reportUid = `${accountId}_${month}`;

    // Check if it already exists
    const existing = await this.cache.getByKey<MonthlyReport>(STORE, reportUid);
    if (existing) return existing;

    const monthLabel = date().toDate().toLocaleString('en-US', { month: 'long' });
    const currentMonthTxns = transactions.filter((t) => {
      const ev = transactionEventDate(t);
      if (!ev) return false;
      return this.toMonthKey(ev) === month;
    });

    let totalIncome = 0;
    let totalExpense = 0;
    const catMap = new Map<string, number>();
    for (const t of currentMonthTxns) {
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') {
        totalIncome += amt;
      } else {
        totalExpense += amt;
        const cat = (t.category ?? '').trim() || 'Other';
        catMap.set(cat, (catMap.get(cat) ?? 0) + amt);
      }
    }

    // Build categoryBreakdown with budget info
    const relevantBudgets = budgets.filter((b) => {
      const bm = (b.month ?? '').trim();
      return !bm || bm.toLowerCase() === monthLabel.toLowerCase();
    });

    const budgetByCat = new Map<string, number>();
    for (const b of relevantBudgets) {
      const cat = (b.category ?? '').trim() || 'Uncategorized';
      budgetByCat.set(cat, (budgetByCat.get(cat) ?? 0) + Number(b.limit ?? 0));
    }

    const totalBudget = Array.from(budgetByCat.values()).reduce((a, b) => a + b, 0);
    const totalBudgetUsed = totalBudget > 0 ? Math.round((totalExpense / totalBudget) * 100) : 0;

    const categoryBreakdown: Record<string, CategoryBreakdownEntry> = {};
    for (const [cat, amount] of catMap) {
      const budget = budgetByCat.get(cat) ?? null;
      const used = budget && budget > 0 ? Math.round((amount / budget) * 100) : 0;
      categoryBreakdown[cat] = { amount, budget, used, overspent: budget !== null && amount > budget };
    }

    const report: MonthlyReport = {
      uid: reportUid,
      month,
      accountId,
      totalIncome,
      totalExpense,
      savings: totalIncome - totalExpense,
      totalBudgetUsed,
      categoryBreakdown,
      recurrings: { totalIncome: 0, totalExpense: 0, spentOn: [] },
      isFinalized: false,
      date: date().format('YYYY-MM-DD'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.cache.put<MonthlyReport>(STORE, report);
    if (this.network.isOnline()) {
      this.pushReportToFirestore(report).catch(() => {});
    }
    return report;
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
  private computeDailyData(transactions: TransactionRecord[]): Array<{ label: string; income: number; expense: number }> {
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
  private computeWeeklyData(transactions: TransactionRecord[]): Array<{ label: string; income: number; expense: number }> {
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
      return daily.map((d) => ({ label: d.label, savings: d.income - d.expense, expense: d.expense }));
    }
    if (period === 'week') {
      const weekly = this.computeWeeklyData(transactions);
      return weekly.map((d) => ({ label: d.label, savings: d.income - d.expense, expense: d.expense }));
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
      return { label: this.formatMonthLabel(key), savings: d.income - d.expense, expense: d.expense };
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

  private blankReport(uid: string, accountId: string, month: string): MonthlyReport {
    return {
      uid,
      month,
      accountId,
      totalIncome: 0,
      totalExpense: 0,
      savings: 0,
      totalBudgetUsed: 0,
      categoryBreakdown: {},
      recurrings: { totalIncome: 0, totalExpense: 0, spentOn: [] },
      isFinalized: false,
      date: date().format('YYYY-MM-DD'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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
      categoryBreakdown: (data['categoryBreakdown'] as Record<string, CategoryBreakdownEntry>) ?? {},
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
}
