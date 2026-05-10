/** Transaction stored under `transactions/{id}` */
import { serverTimestamp } from '@angular/fire/firestore';

/**
 * Links a transaction to its source entity.
 * - type 'group-expense': id=groupId, recordId=expenseId
 * - type 'group-settlement': id=groupId, recordId=settlementId
 * - type 'recurring': id=recurringTransactionId, recordId=recurringTransactionId
 */
export interface LinkedObject {
  type: 'group-expense' | 'group-settlement' | 'recurring';
  /** groupId for group types; recurringTransactionId for recurring */
  id: string;
  /** expenseId, settlementId, or recurringTransactionId */
  recordId: string;
}

export interface TransactionRecord {
  uid: string;
  accountId: string;
  amount: number | null;
  description: string;
  category: string;
  /** User id of who recorded/paid the transaction. */
  paidBy?: string | null;
  type: string;
  source?: string;
  icon?: string | null;
  /** Link to source entity (group expense/settlement or recurring schedule). */
  linkedObject?: LinkedObject | null;
  date?: string; // 'YYYY-MM-DD'
  createdAt: Date | null;
  updatedAt: Date | null;
  _pendingSync?: boolean;
  /** @deprecated Use linkedObject.type === 'recurring' instead. Kept for backward-compat reads. */
  isRecurring?: boolean | null;
  /** @deprecated Use linkedObject.recordId instead. Kept for backward-compat reads. */
  recurringTransactionId?: string | null;
  /** @deprecated No longer stored on transactions. */
  recurringFrequency?: string | null;
  /** @deprecated No longer stored on transactions. */
  nextPaymentDate?: Date | null;
}

export interface TransactionCreateInput {
  accountId: string;
  amount: number | string | null;
  description: string;
  category: string | null;
  /** User id of who paid/recorded this transaction. */
  paidBy?: string | null;
  icon?: string | null;
  type: string;
  status?: string | null;
  source?: string | null;
  date?: string; // 'YYYY-MM-DD'
  /** Link to source entity (group expense/settlement or recurring schedule). */
  linkedObject?: LinkedObject | null;
  /** @deprecated Use linkedObject instead. Kept for backward-compat writes during migration. */
  isRecurring?: boolean | null;
  /** @deprecated Use linkedObject.recordId instead. */
  recurringTransactionId?: string | null;
  /** @deprecated No longer stored on new transactions; kept for backward-compat service writes. */
  recurringFrequency?: string | null;
  /** @deprecated No longer stored on new transactions; kept for backward-compat service writes. */
  nextPaymentDate?: Date | null;
}

/** Recurring schedule stored under `recurring-transactions/{id}` */
export interface RecurringTransactionRecord {
  uid: string;
  accountId: string;
  /** Seed / most-recent transaction ID — used for backward-compat lookups. */
  transactionId: string;

  // Denormalized transaction fields — stored so the list page never needs a second fetch
  description: string;
  category: string;
  amount: number;
  type: string;
  icon?: string | null;
  source?: string | null;
  recurringFrequency?: string | null;

  /** Auto-pay flag — moved here from TransactionRecord. */
  isAutoPay?: boolean | null;
  /** false / absent means the schedule has been stopped. */
  isActive: boolean;

  lastPaymentDate: Date | null;
  nextPaymentDate: Date | null;
  date?: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  _pendingSync?: boolean;
}

export interface RecurringTransactionCreateInput {
  accountId: string;
  transactionId: string;

  description: string;
  category: string;
  amount: number | string;
  type: string;
  icon?: string | null;
  source?: string | null;
  recurringFrequency?: string | null;
  isAutoPay?: boolean | null;
  isActive?: boolean;

  lastPaymentDate: Date;
  nextPaymentDate: Date;
  createdAt?: typeof serverTimestamp | null;
  updatedAt?: typeof serverTimestamp | null;
}

export type RecurringTransactionUpdateInput = Partial<
  Pick<
    RecurringTransactionCreateInput,
    | 'accountId'
    | 'transactionId'
    | 'description'
    | 'category'
    | 'amount'
    | 'type'
    | 'icon'
    | 'source'
    | 'recurringFrequency'
    | 'isAutoPay'
    | 'isActive'
    | 'lastPaymentDate'
    | 'nextPaymentDate'
  >
>;
