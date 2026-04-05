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
  isAutoPay?: boolean | null;
  nextPaymentDate?: Date | null;
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
}

export interface RecurringTransactionRecord {
  uid: string;
  accountId: string;
  transactionId: string;
  lastPaymentDate: Date | null;
  nextPaymentDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface RecurringTransactionCreateInput {
  uid: string;
  accountId: string;
  transactionId: string;
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
    | 'lastPaymentDate'
    | 'nextPaymentDate'
    | 'createdAt'
    | 'updatedAt'
  >
>;
