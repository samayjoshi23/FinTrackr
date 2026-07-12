// ─── Firestore / IndexedDB stored document ────────────────────────────────────

/** Stored on `MonthlyReport.categoryBreakdown` — keyed by {@link monthlyReportCategoryKey}. */
export interface CategoryBreakdownEntry {
  /** Display name; update this when the user renames a category (keys stay stable). */
  name: string;
  amount: number;
  budget: number | null;
  used: number; // percentage of budget used (may exceed 100 when overspent)
  overspent: boolean;
}

/** Map key: `cat_<categoryFirestoreId>` (e.g. `cat_abc123`). */
export function monthlyReportCategoryKey(categoryId: string): string {
  return `cat_${categoryId}`;
}

export interface MonthlyReport {
  uid: string;
  month: string; // 'YYYY-MM'
  accountId: string;
  totalIncome: number;
  totalExpense: number;
  savings: number;
  totalBudgetUsed: number; // overall % of total budget used
  /**
   * Total budget allocated for the month (recurring plan's `monthlyBudget` at the
   * time this report was stamped). Enables zero-based math (income → allocated →
   * unbudgeted) and is the frozen source for past-month budget limits. Optional for
   * backward-compat with reports written before this field existed.
   */
  totalBudget?: number;
  categoryBreakdown: Record<string, CategoryBreakdownEntry>;
  recurrings: {
    totalIncome: number;
    totalExpense: number;
    spentOn: string[];
  };
  isFinalized: boolean;
  /** The account's starting balance at the time this report was first created. Static — never updated. */
  initialBalance?: number;
  /** Calendar day string when the report row was created / last synced (`YYYY-MM-DD`). */
  date?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  _pendingSync?: boolean;
}

export interface MonthlyReportCreateInput {
  month: string;
  accountId: string;
  totalIncome: number;
  totalExpense: number;
  savings: number;
  totalBudgetUsed: number;
  totalBudget?: number;
  categoryBreakdown: Record<string, CategoryBreakdownEntry>;
  recurrings: {
    totalIncome?: number;
    totalExpense?: number;
    spentOn?: string[];
  };
  isFinalized?: boolean;
  /** The account's starting balance; captured once at report creation for historical comparison. */
  initialBalance?: number;
  date?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  _pendingSync?: boolean;
}

export interface MonthlyReportUpdateInput {
  totalIncome?: number;
  totalExpense?: number;
  savings?: number;
  totalBudgetUsed?: number;
  totalBudget?: number;
  categoryBreakdown?: Record<string, CategoryBreakdownEntry>;
  recurrings?: {
    totalIncome?: number;
    totalExpense?: number;
    spentOn?: string[];
  };
  isFinalized?: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  _pendingSync?: boolean;
}

// ─── Filter / UI enums ────────────────────────────────────────────────────────

export type ReportTimePeriod = 'day' | 'week' | '1M' | '3M' | '6M' | '1Y' | 'all';
export type ReportChartMode = 'income-expense' | 'by-category';

// ─── Chart view-models ────────────────────────────────────────────────────────

export interface DailyDataPoint {
  label: string; // 'Mon', 'Tue' … or '01', '02' …
  income: number;
  expense: number;
}

export interface WeeklyDataPoint {
  label: string; // 'W1', 'W2' …
  income: number;
  expense: number;
}

export interface MonthBarDataPoint {
  label: string; // same as month, used as common accessor
  month: string; // 'Jan', 'Feb' …
  income: number;
  expense: number;
}

export interface CategoryPieDataPoint {
  category: string;
  amount: number;
  color: string;
}

export interface SavingsTrendDataPoint {
  label: string;
  savings: number;
  expense: number;
}

export interface BudgetTrackingCard {
  category: string;
  icon: string;
  amount: number;
  budget: number | null;
  used: number; // percentage
  overspent: boolean;
}

export interface ReportSummary {
  totalIncome: number;
  totalExpense: number;
  savings: number;
  savingsRate: number; // percentage
}

/** One historical month's budget performance, derived from a {@link MonthlyReport} snapshot. */
export interface BudgetHistoryMonth {
  month: string; // 'YYYY-MM'
  label: string; // 'Jul 2026'
  totalIncome: number;
  totalExpense: number;
  savings: number;
  /** Allocated budget for the month (zero-based pool). */
  totalBudget: number;
  /** income − allocated; negative means over-allocated. */
  unbudgeted: number;
  totalBudgetUsed: number; // %
  overspentCount: number;
  categories: BudgetTrackingCard[];
}

/** Zero-based allocation snapshot for a single month (Budgets page summary). */
export interface ZeroBasedSummary {
  totalIncome: number;
  totalBudget: number; // allocated
  totalSpent: number;
  /** income − allocated; negative ⇒ over-allocated. */
  unbudgeted: number;
  /** allocated − spent (can be negative when overspent). */
  remaining: number;
}
