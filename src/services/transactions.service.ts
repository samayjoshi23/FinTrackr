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
import { Account } from '../shared/models/account.model';
import { OfflineCrudService } from '../core/offline/offline-crud.service';

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

  async createTransaction(
    data: TransactionCreateInput,
    userId?: string,
  ): Promise<TransactionRecord> {
    const uid = userId ?? this.requireUid();
    return this.offlineCrud.create<TransactionRecord>(
      'transactions',
      'uid',
      async () => {
        const ref = await addDoc(collection(this.firestore, TRANSACTIONS_COLLECTION), {
          accountId: data.accountId,
          amount: Number(data.amount),
          description: data.description?.trim() ?? '',
          category: data.category?.trim() ?? '',
          icon: data.icon ?? null,
          type: data.type,
          ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
          ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
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
        accountId: data.accountId,
        amount: Number(data.amount),
        description: data.description?.trim() ?? '',
        category: data.category?.trim() ?? '',
        icon: data.icon ?? null,
        type: data.type,
        ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
        ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
      },
    );
  }

  async updateTransaction(transactionId: string, patch: TransactionCreateInput): Promise<void> {
    const uid = this.requireUid();
    const cached = await this.offlineCrud.fetchOne<TransactionRecord>(
      'transactions',
      transactionId,
      async () => {
        const snap = await getDoc(doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`));
        if (!snap.exists()) return null;
        return this.mapTransaction(snap.id, snap.data());
      },
    );

    if (!cached) {
      throw new Error('Transaction not found or access denied.');
    }

    const patchRecord: Record<string, unknown> = {};
    if (patch.accountId !== undefined) patchRecord['accountId'] = patch.accountId;
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
    await this.offlineCrud.remove(
      'transactions',
      transactionId,
      async () => {
        const uid = this.requireUid();
        const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
        const existing = await getDoc(transactionRef);
        if (!existing.exists() || existing.data()['ownerId'] !== uid) {
          throw new Error('Transaction not found or access denied.');
        }
        await deleteDoc(transactionRef);
      },
    );
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    if (!this.currentAccount) return null;
    return this.offlineCrud.fetchOne<TransactionRecord>(
      'transactions',
      transactionId,
      async () => this.getTransactionDirect(transactionId),
    );
  }

  async getTransactions(): Promise<TransactionRecord[]> {
    if (!this.currentAccount) return [];
    const results = await this.offlineCrud.fetchAll<TransactionRecord>(
      'transactions',
      async () => {
        const snap = await getDocs(
          query(
            collection(this.firestore, TRANSACTIONS_COLLECTION),
            where('accountId', '==', this.currentAccount!.uid),
          ),
        );
        return this.sortByCreatedAtDesc(snap.docs.map((d) => this.mapTransaction(d.id, d.data())));
      },
      { indexName: 'accountId', value: this.currentAccount.uid },
    );
    return this.sortByCreatedAtDesc(results);
  }

  async getTransactionsByAccount(accountId: string): Promise<TransactionRecord[]> {
    const results = await this.offlineCrud.fetchAll<TransactionRecord>(
      'transactions',
      async () => {
        const snap = await getDocs(
          query(
            collection(this.firestore, TRANSACTIONS_COLLECTION),
            where('accountId', '==', accountId),
          ),
        );
        return this.sortByCreatedAtDesc(snap.docs.map((d) => this.mapTransaction(d.id, d.data())));
      },
      { indexName: 'accountId', value: accountId },
    );
    return this.sortByCreatedAtDesc(results);
  }

  async getRecentTransactions(limitHint = 50): Promise<TransactionRecord[]> {
    const all = await this.getTransactions();
    return all.slice(0, limitHint);
  }

  async createRecurringTransaction(
    data: RecurringTransactionCreateInput,
  ): Promise<RecurringTransactionRecord> {
    return this.offlineCrud.create<RecurringTransactionRecord>(
      'recurring-transactions',
      'uid',
      async () => {
        const ref = await addDoc(collection(this.firestore, RECURRING_TRANSACTIONS_COLLECTION), {
          accountId: data.accountId,
          transactionId: data.transactionId,
          lastPaymentDate: data.lastPaymentDate,
          nextPaymentDate: data.nextPaymentDate,
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
        accountId: data.accountId,
        transactionId: data.transactionId,
        lastPaymentDate: data.lastPaymentDate,
        nextPaymentDate: data.nextPaymentDate,
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
    if (!this.currentAccount) return null;
    const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
    const snap = await getDoc(transactionRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['accountId'] !== this.currentAccount.uid) return null;
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

  private sortByCreatedAtDesc(rows: TransactionRecord[]): TransactionRecord[] {
    return [...rows].sort((a, b) => {
      const ta = a.createdAt?.getTime() ?? 0;
      const tb = b.createdAt?.getTime() ?? 0;
      return tb - ta;
    });
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage transactions.');
    return uid;
  }

  private mapTransaction(id: string, data: Record<string, unknown>): TransactionRecord {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
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
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    } as TransactionRecord;
  }

  private mapRecurringTransaction(
    id: string,
    data: Record<string, unknown>,
  ): RecurringTransactionRecord {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      uid: id,
      accountId: (data['accountId'] as string) ?? '',
      transactionId: (data['transactionId'] as string) ?? '',
      lastPaymentDate: (data['lastPaymentDate'] as Date) ?? null,
      nextPaymentDate: (data['nextPaymentDate'] as Date) ?? null,
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
