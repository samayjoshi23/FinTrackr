// ─── Firestore / IndexedDB stored document ────────────────────────────────────

/** Stored on `MonthlyReport.categoryBreakdown` — matches `todo.txt` monthly schema. */
export interface CategoryBreakdownEntry {
  amount: number;
  budget: number | null;
  used: number; // percentage of budget used
  overspent: boolean;
}

export interface MonthlyReport {
  uid: string;
  month: string; // 'YYYY-MM'
  accountId: string;
  totalIncome: number;
  totalExpense: number;
  savings: number;
  totalBudgetUsed: number; // overall % of total budget used
  categoryBreakdown: Record<string, CategoryBreakdownEntry>;
  recurrings: {
    totalIncome: number;
    totalExpense: number;
    spentOn: string[];
  };
  isFinalized: boolean;
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
  categoryBreakdown: Record<string, CategoryBreakdownEntry>;
  recurrings: {
    totalIncome?: number;
    totalExpense?: number;
    spentOn?: string[];
  };
  isFinalized?: boolean;
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
