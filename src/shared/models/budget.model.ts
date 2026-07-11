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
  /** Optional {@link Category.uid} for stable budget ↔ reporting linkage. */
  categoryId?: string;
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
  categoryId?: string;
}

export type BudgetUpdateInput = Partial<
  Pick<BudgetDocument, 'limit' | 'month' | 'name' | 'category' | 'categoryId'>
>;

// ─── Budget Plan (consolidated, one document per account) ────────────────────
//
// A single recurring monthly budget plan per account. Replaces the legacy
// per-category `budgets` collection: reads are a single `getDoc(budgetPlans/{accountId})`
// (no query / index), and edits touch one document. `categoryBudgets` maps a
// `Category.uid` to its monthly limit; the leftover (`monthlyBudget − Σ limits`)
// is the implicit "Other" allowance.

export interface BudgetPlanDocument {
  ownerId: string;
  accountId: string;
  /** Whole recurring monthly budget. */
  monthlyBudget: number;
  /** categoryId (`Category.uid`) → monthly limit. Absent/0 means no per-category budget. */
  categoryBudgets: Record<string, number>;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface BudgetPlan extends Omit<BudgetPlanDocument, 'createdAt' | 'updatedAt'> {
  /** Always equal to `accountId` (document id). */
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  date?: string; // 'YYYY-MM-DD'
  _pendingSync?: boolean;
}

export interface BudgetPlanUpsertInput {
  accountId: string;
  monthlyBudget: number | string;
  categoryBudgets: Record<string, number>;
}
