export type ProgressStatus = 'under' | 'over' | 'unset';

export interface SummaryCardModel {
  monthLabel: string;
  totalLimit: number;
  totalSpent: number;
  remaining: number;
  remainingDisplay: number;
  /** Spend above totalLimit; 0 when within budget. */
  overBudgetAmount: number;
  daysLeft: number;
  // ─── Zero-based budgeting ───────────────────────────────
  /** Total income for the month (the allocation pool). */
  income: number;
  /** Income minus allocated budget; negative ⇒ over-allocated. */
  unbudgeted: number;
  /** True when viewing a past month (read-only snapshot). */
  isReadOnly: boolean;
}

export interface CategoryBudgetCardModel {
  category: string;
  /** `Category.uid` this card budgets, or '' for the derived "Other" card. */
  categoryId: string;
  /** True for the derived "Other" bucket (monthlyBudget − Σ category limits). Not editable. */
  isOther: boolean;
  icon: string;
  spent: number;
  limit: number;
  percent: number;
  status: ProgressStatus;
  /** True when the user has NOT set a limit for this category (limit == 0). */
  hasNoLimit: boolean;
  /** Amount past limit when status is `over`. */
  overAmount: number;
}
