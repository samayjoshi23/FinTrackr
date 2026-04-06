export type ProgressStatus = 'under' | 'over';

export interface SummaryCardModel {
  monthLabel: string;
  totalLimit: number;
  totalSpent: number;
  remaining: number;
  remainingDisplay: number;
  daysLeft: number;
}

export interface CategoryBudgetCardModel {
  category: string;
  icon: string;
  spent: number;
  limit: number;
  percent: number;
  status: ProgressStatus;
}
