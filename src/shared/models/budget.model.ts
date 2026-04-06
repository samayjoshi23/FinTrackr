import { Timestamp } from 'firebase/firestore';

export interface BudgetDocument {
  ownerId: string;
  accountId: string;
  limit: number;
  month: string;
  /** Display name shown in the UI (optional for older documents). */
  name?: string;
  /** Category name that maps to `transactions.category` (optional for older documents). */
  category?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Budget extends Omit<BudgetDocument, 'createdAt' | 'updatedAt'> {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  date?: string; // 'YYYY-MM-DD'
  _pendingSync?: boolean;
}

export interface BudgetCreateInput {
  accountId: string;
  limit: number | string;
  month: string;
  name?: string;
  category?: string;
}

export type BudgetUpdateInput = Partial<
  Pick<BudgetDocument, 'limit' | 'month' | 'name' | 'category'>
>;
