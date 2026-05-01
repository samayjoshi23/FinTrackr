import { Timestamp } from 'firebase/firestore';

// ─── Member ───────────────────────────────────────────────────────────────────

export interface GroupMember {
  memberId: string;
  memberDisplayName: string;
  memberEmail?: string;
  isActive: boolean;
  joinedAt: Timestamp | null;
}

// ─── Group ────────────────────────────────────────────────────────────────────

export interface GroupDocument {
  name: string;
  icon?: string;
  currency: string;
  creatorId: string;
  members: GroupMember[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Group extends Omit<GroupDocument, 'createdAt' | 'updatedAt' | 'members'> {
  id: string;
  members: GroupMember[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface GroupCreateInput {
  name: string;
  icon?: string;
  currency: string;
  creatorId: string;
  members: GroupMember[];
}

export type GroupUpdateInput = Partial<Pick<GroupDocument, 'name' | 'icon' | 'currency' | 'members'>>;

// ─── Expense split ────────────────────────────────────────────────────────────

export interface ExpenseSplit {
  memberId: string;
  memberName: string;
  /** This member's share of the expense total. */
  amount: number;
  /** True for the member who actually paid. */
  isPaid: boolean;
}

// ─── Group expense ────────────────────────────────────────────────────────────

export interface GroupExpenseDocument {
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  icon?: string;
  paidById: string;
  paidByName: string;
  splits: ExpenseSplit[];
  date: string; // 'YYYY-MM-DD'
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface GroupExpense extends Omit<GroupExpenseDocument, 'createdAt' | 'updatedAt'> {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface GroupExpenseCreateInput {
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  icon?: string;
  paidById: string;
  paidByName: string;
  splits: ExpenseSplit[];
  date: string;
}

export type GroupExpenseUpdateInput = Partial<
  Pick<GroupExpenseDocument, 'description' | 'amount' | 'category' | 'icon' | 'paidById' | 'paidByName' | 'splits' | 'date'>
>;

// ─── Settlement ───────────────────────────────────────────────────────────────

export interface GroupSettlementDocument {
  groupId: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  currency: string;
  note?: string;
  settledAt: Timestamp;
  createdAt: Timestamp | null;
}

export interface GroupSettlement extends Omit<GroupSettlementDocument, 'settledAt' | 'createdAt'> {
  id: string;
  settledAt: Date;
  createdAt: Date | null;
}

export interface GroupSettlementCreateInput {
  groupId: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  currency: string;
  note?: string;
}

// ─── Balance view-model (derived, never stored) ───────────────────────────────

/** Positive = this member is owed money (from current user's perspective or absolute). */
export interface MemberBalance {
  memberId: string;
  memberName: string;
  /** Net balance from the current user's perspective: positive = they owe you, negative = you owe them. */
  netAmount: number;
}
