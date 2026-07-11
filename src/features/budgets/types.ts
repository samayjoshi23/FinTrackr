export type ProgressStatus = 'under' | 'over';

export interface SummaryCardModel {
  monthLabel: string;
  totalLimit: number;
  totalSpent: number;
  remaining: number;
  remainingDisplay: number;
  /** Spend above totalLimit; 0 when within budget. */
  overBudgetAmount: number;
  daysLeft: number;
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
  /** Amount past limit when status is `over`. */
  overAmount: number;
}
