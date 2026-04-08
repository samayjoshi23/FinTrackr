import { Timestamp } from 'firebase/firestore';

export interface GoalDocument {
  ownerId: string;
  accountId: string;
  name: string;
  target: number;
  dueDate: string;
  currentAmount: number;
  /** Optional {@link Category.uid} for reporting / UI linkage. */
  categoryId?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Goal extends Omit<GoalDocument, 'createdAt' | 'updatedAt'> {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  date?: string; // 'YYYY-MM-DD'
  _pendingSync?: boolean;
}

export interface GoalCreateInput {
  accountId: string;
  name: string;
  target: number | string;
  dueDate: string;
  currentAmount: number | string;
}

export type GoalUpdateInput = Partial<
  Pick<GoalDocument, 'name' | 'target' | 'dueDate' | 'currentAmount' | 'categoryId'>
>;
