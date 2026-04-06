import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import {
  RecurringTransactionCreateInput,
  RecurringTransactionRecord,
  TransactionCreateInput,
  TransactionRecord,
} from '../shared/models/transaction.model';
import {
  sortTransactionsByCreatedAtDesc,
  TransactionListFilter,
  TransactionPagedResult,
} from '../shared/models/transaction-query.model';
import { Account } from '../shared/models/account.model';
import { OfflineCrudService } from '../core/offline/offline-crud.service';
import { date, docCalendarDate } from '../core/date';

const TRANSACTIONS_COLLECTION = 'transactions';
const RECURRING_TRANSACTIONS_COLLECTION = 'recurring-transactions';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);

  get currentAccount(): Account | null {
    return JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
  }

  /** Firestore `accountId` on child docs — matches selected account (`uid`, then `id`). */
  private selectedAccountKey(): string | null {
    const a = this.currentAccount;
    return a?.uid ?? a?.id ?? null;
  }

  private requireSelectedAccountKey(): string {
    const id = this.selectedAccountKey();
    if (!id) throw new Error('No account selected.');
    return id;
  }

  async createTransaction(
    data: TransactionCreateInput,
    _userId?: string,
  ): Promise<TransactionRecord> {
    const accountId = data.accountId ?? this.requireSelectedAccountKey();
    const day = date().format('YYYY-MM-DD');
    return this.offlineCrud.create<TransactionRecord>(
      'transactions',
      'uid',
      async () => {
        const ref = await addDoc(collection(this.firestore, TRANSACTIONS_COLLECTION), {
          accountId,
          amount: Number(data.amount),
          description: data.description?.trim() ?? '',
          category: data.category?.trim() ?? '',
          icon: data.icon ?? null,
          type: data.type,
          ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
          ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const row = await this.getTransactionDirect(ref.id);
        if (!row) {
          throw new Error('Failed to read transaction after creation.');
        }
        return row;
      },
      {
        accountId,
        amount: Number(data.amount),
        description: data.description?.trim() ?? '',
        category: data.category?.trim() ?? '',
        icon: data.icon ?? null,
        type: data.type,
        ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
        ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
        date: day,
      },
    );
  }

  async updateTransaction(transactionId: string, patch: TransactionCreateInput): Promise<void> {
    const uid = this.requireUid();
    const cached = await this.offlineCrud.fetchOne<TransactionRecord>(
      'transactions',
      transactionId,
      async () => {
        const snap = await getDoc(
          doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`),
        );
        if (!snap.exists()) return null;
        return this.mapTransaction(snap.id, snap.data());
      },
    );

    if (!cached) {
      throw new Error('Transaction not found or access denied.');
    }

    const patchRecord: Record<string, unknown> = {};
    if (patch.amount !== undefined) patchRecord['amount'] = Number(patch.amount);
    if (patch.description !== undefined) patchRecord['description'] = patch.description.trim();
    if (patch.category !== undefined) patchRecord['category'] = patch.category?.trim() ?? '';
    if (patch.type !== undefined) patchRecord['type'] = patch.type;
    if (patch.status !== undefined) patchRecord['status'] = patch.status;
    if (patch.source !== undefined) patchRecord['source'] = patch.source?.trim() ?? '';

    await this.offlineCrud.update<TransactionRecord>(
      'transactions',
      transactionId,
      async () => {
        const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
        const existing = await getDoc(transactionRef);
        if (!existing.exists() || existing.data()['ownerId'] !== uid) {
          throw new Error('Transaction not found or access denied.');
        }
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await updateDoc(transactionRef, updates);
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    await this.offlineCrud.remove('transactions', transactionId, async () => {
      const uid = this.requireUid();
      const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
      const existing = await getDoc(transactionRef);
      if (!existing.exists() || existing.data()['ownerId'] !== uid) {
        throw new Error('Transaction not found or access denied.');
      }
      await deleteDoc(transactionRef);
    });
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    if (!this.currentAccount) return null;
    return this.offlineCrud.fetchOne<TransactionRecord>('transactions', transactionId, async () =>
      this.getTransactionDirect(transactionId),
    );
  }

  async getTransactions(): Promise<TransactionRecord[]> {
    const accountKey = this.selectedAccountKey();
    if (!accountKey) return [];
    const results = await this.offlineCrud.fetchAll<TransactionRecord>(
      'transactions',
      async () => {
        const snap = await getDocs(
          query(
            collection(this.firestore, TRANSACTIONS_COLLECTION),
            where('accountId', '==', accountKey),
          ),
        );
        return sortTransactionsByCreatedAtDesc(
          snap.docs.map((d) => this.mapTransaction(d.id, d.data())),
        );
      },
      { indexName: 'accountId', value: accountKey },
    );
    return sortTransactionsByCreatedAtDesc(results);
  }

  /**
   * Filtered, paginated transactions. Reads from IndexedDB by `accountId`, applies filters in the
   * offline layer, then returns one page (for list UIs / lazy loading).
   */
  async getTransactionsPage(
    filter: TransactionListFilter,
    offset: number,
    limit: number,
  ): Promise<TransactionPagedResult> {
    const accountKey = this.selectedAccountKey();
    if (!accountKey) {
      return { items: [], total: 0, hasMore: false };
    }
    return this.offlineCrud.fetchTransactionsPage(
      accountKey,
      filter,
      offset,
      limit,
      async () => {
        const snap = await getDocs(
          query(
            collection(this.firestore, TRANSACTIONS_COLLECTION),
            where('accountId', '==', accountKey),
          ),
        );
        return snap.docs.map((d) => this.mapTransaction(d.id, d.data()));
      },
    );
  }

  async getRecentTransactions(limitHint = 50): Promise<TransactionRecord[]> {
    const { items } = await this.getTransactionsPage({}, 0, limitHint);
    return items;
  }

  async createRecurringTransaction(
    data: RecurringTransactionCreateInput,
  ): Promise<RecurringTransactionRecord> {
    const accountId = data.accountId ?? this.requireSelectedAccountKey();
    const day = date().format('YYYY-MM-DD');
    return this.offlineCrud.create<RecurringTransactionRecord>(
      'recurring-transactions',
      'uid',
      async () => {
        const ref = await addDoc(collection(this.firestore, RECURRING_TRANSACTIONS_COLLECTION), {
          accountId,
          transactionId: data.transactionId,
          lastPaymentDate: data.lastPaymentDate,
          nextPaymentDate: data.nextPaymentDate,
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const row = await this.getRecurringTransactionDirect(ref.id);
        if (!row) {
          throw new Error('Failed to read recurring transaction after creation.');
        }
        return row;
      },
      {
        accountId,
        transactionId: data.transactionId,
        lastPaymentDate: data.lastPaymentDate,
        nextPaymentDate: data.nextPaymentDate,
        date: day,
      },
    );
  }

  async getRecurringTransaction(
    recurringTransactionId: string,
  ): Promise<RecurringTransactionRecord | null> {
    return this.offlineCrud.fetchOne<RecurringTransactionRecord>(
      'recurring-transactions',
      recurringTransactionId,
      async () => this.getRecurringTransactionDirect(recurringTransactionId),
    );
  }

  // ─── Direct Firestore reads (bypass offline layer, used after creates) ───

  private async getTransactionDirect(transactionId: string): Promise<TransactionRecord | null> {
    const expected = this.selectedAccountKey();
    if (!expected) return null;
    const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
    const snap = await getDoc(transactionRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['accountId'] !== expected) return null;
    return this.mapTransaction(snap.id, data);
  }

  private async getRecurringTransactionDirect(
    recurringTransactionId: string,
  ): Promise<RecurringTransactionRecord | null> {
    const uid = this.requireUid();
    const snap = await getDoc(
      doc(this.firestore, `${RECURRING_TRANSACTIONS_COLLECTION}/${recurringTransactionId}`),
    );
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapRecurringTransaction(snap.id, data);
  }

  // ─── Private helpers ───

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage transactions.');
    return uid;
  }

  private mapTransaction(id: string, data: Record<string, unknown>): TransactionRecord {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    const created = createdAt?.toDate?.() ?? null;
    return {
      uid: id,
      accountId: (data['accountId'] as string) ?? '',
      amount: data['amount'] as number | null,
      description: (data['description'] as string) ?? '',
      category: (data['category'] as string) ?? '',
      icon: data['icon'] as string | null,
      isRecurring: data['isRecurring'] as boolean | false,
      type: (data['type'] as string) ?? 'expense',
      source: data['source'] as string | undefined,
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
      date: docCalendarDate(data, created),
    } as TransactionRecord;
  }

  private mapRecurringTransaction(
    id: string,
    data: Record<string, unknown>,
  ): RecurringTransactionRecord {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    const created = createdAt?.toDate?.() ?? null;
    return {
      uid: id,
      accountId: (data['accountId'] as string) ?? '',
      transactionId: (data['transactionId'] as string) ?? '',
      lastPaymentDate: (data['lastPaymentDate'] as Date) ?? null,
      nextPaymentDate: (data['nextPaymentDate'] as Date) ?? null,
      date: docCalendarDate(data, created),
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
