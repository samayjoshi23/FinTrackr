import { Timestamp } from 'firebase/firestore';

export interface BudgetDocument {
  ownerId: string;
  accountId: string;
  limit: number;
  month: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Budget extends Omit<BudgetDocument, 'createdAt' | 'updatedAt'> {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface BudgetCreateInput {
  accountId: string;
  limit: number | string;
  month: string;
}

export type BudgetUpdateInput = Partial<Pick<BudgetDocument, 'limit' | 'month'>>;
