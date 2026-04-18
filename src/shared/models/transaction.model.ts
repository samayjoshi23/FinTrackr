/** Transaction stored under `transactions/{id}` */
import { serverTimestamp } from '@angular/fire/firestore';

export interface TransactionRecord {
  uid: string;
  accountId: string;
  amount: number | null;
  description: string;
  category: string;
  type: string;
  source?: string;
  icon?: string | null;
  isRecurring?: boolean | null;
  recurringFrequency?: string | null;
  /** Links this transaction to a RecurringTransactionRecord. */
  recurringTransactionId?: string | null;
  nextPaymentDate?: Date | null;
  date?: string; // 'YYYY-MM-DD'
  createdAt: Date | null;
  updatedAt: Date | null;
  _pendingSync?: boolean;
}

export interface TransactionCreateInput {
  accountId: string;
  amount: number | string | null;
  description: string;
  category: string | null;
  icon?: string | null;
  type: string;
  status?: string | null;
  source?: string | null;
  isRecurring?: boolean | null;
  recurringFrequency?: string | null;
  /** ID of the associated RecurringTransactionRecord (set when isRecurring is true). */
  recurringTransactionId?: string | null;
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
