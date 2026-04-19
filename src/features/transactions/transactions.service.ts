import { inject, Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import {
  RecurringTransactionCreateInput,
  RecurringTransactionRecord,
  RecurringTransactionUpdateInput,
  TransactionCreateInput,
  TransactionRecord,
} from '../../shared/models/transaction.model';
import {
  sortTransactionsByCreatedAtDesc,
  TransactionListFilter,
  TransactionPagedResult,
} from '../../shared/models/transaction-query.model';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { AccountsService } from '../accounts/accounts.service';
import { date, docCalendarDate } from '../../core/date';

const TRANSACTIONS_COLLECTION = 'transactions';
const RECURRING_TRANSACTIONS_COLLECTION = 'recurring-transactions';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly firestore = inject(Firestore);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);
  private readonly accountsService = inject(AccountsService);

  /** Firestore `accountId` on child docs — matches selected account (`uid`, then `id`). */
  private async selectedAccountKey(): Promise<string | null> {
    const a = await this.accountsService.getSelectedAccount();
    return a?.uid ?? a?.id ?? null;
  }

  private async requireSelectedAccountKey(): Promise<string> {
    const id = await this.selectedAccountKey();
    if (!id) throw new Error('No account selected.');
    return id;
  }

  async createTransaction(
    data: TransactionCreateInput,
    options?: { syncRemoteInBackground?: boolean },
  ): Promise<TransactionRecord> {
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    return this.offlineCrud.create<TransactionRecord>(
      'transactions',
      'uid',
      async (assignedId: string) => {
        const ref = doc(this.firestore, TRANSACTIONS_COLLECTION, assignedId);
        await setDoc(ref, {
          accountId,
          amount: Number(data.amount),
          description: data.description?.trim() ?? '',
          category: data.category?.trim() ?? '',
          ...(data.paidBy != null && String(data.paidBy).trim()
            ? { paidBy: String(data.paidBy).trim() }
            : {}),
          icon: data.icon ?? null,
          type: data.type,
          ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
          ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
          ...(data.recurringFrequency != null && String(data.recurringFrequency).trim()
            ? { recurringFrequency: String(data.recurringFrequency).trim() }
            : {}),
          ...(data.recurringTransactionId != null
            ? { recurringTransactionId: data.recurringTransactionId }
            : {}),
          ...(data.nextPaymentDate != null ? { nextPaymentDate: data.nextPaymentDate } : {}),
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const row = await this.getTransactionDirect(assignedId);
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
        ...(data.paidBy != null && String(data.paidBy).trim()
          ? { paidBy: String(data.paidBy).trim() }
          : {}),
        icon: data.icon ?? null,
        type: data.type,
        ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
        ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
        ...(data.recurringFrequency != null && String(data.recurringFrequency).trim()
          ? { recurringFrequency: String(data.recurringFrequency).trim() }
          : {}),
        ...(data.recurringTransactionId != null
          ? { recurringTransactionId: data.recurringTransactionId }
          : {}),
        ...(data.nextPaymentDate != null ? { nextPaymentDate: data.nextPaymentDate } : {}),
        date: day,
      },
      options?.syncRemoteInBackground ? { syncRemoteInBackground: true } : undefined,
    );
  }

  async updateTransaction(transactionId: string, patch: TransactionCreateInput): Promise<void> {
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
        if (!existing.exists() || existing.id !== transactionId) {
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
      const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
      const existing = await getDoc(transactionRef);
      if (!existing.exists() || existing.id !== transactionId) {
        throw new Error('Transaction not found or access denied.');
      }
      await deleteDoc(transactionRef);
    });
  }

  /** Push a queued local-first create to Firestore (sync worker). Does not call {@link createTransaction}. */
  async applyPendingTransactionCreate(docId: string, data: TransactionCreateInput): Promise<void> {
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    const ref = doc(this.firestore, TRANSACTIONS_COLLECTION, docId);
    await setDoc(ref, {
      accountId,
      amount: Number(data.amount),
      description: data.description?.trim() ?? '',
      category: data.category?.trim() ?? '',
      ...(data.paidBy != null && String(data.paidBy).trim()
        ? { paidBy: String(data.paidBy).trim() }
        : {}),
      icon: data.icon ?? null,
      type: data.type,
      ...(data.source !== undefined ? { source: data.source?.trim() ?? '' } : {}),
      ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
      ...(data.recurringFrequency != null && String(data.recurringFrequency).trim()
        ? { recurringFrequency: String(data.recurringFrequency).trim() }
        : {}),
      ...(data.recurringTransactionId != null
        ? { recurringTransactionId: data.recurringTransactionId }
        : {}),
      ...(data.nextPaymentDate != null ? { nextPaymentDate: data.nextPaymentDate } : {}),
      date: day,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const row = await this.getTransactionDirect(docId);
    if (!row) throw new Error('Failed to read transaction after pending create sync.');
    await this.idbCache.put('transactions', { ...row, _pendingSync: false } as TransactionRecord);
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    if (!(await this.accountsService.getSelectedAccount())) return null;
    return this.offlineCrud.fetchOne<TransactionRecord>('transactions', transactionId, async () =>
      this.getTransactionDirect(transactionId),
    );
  }

  async getTransactions(): Promise<TransactionRecord[]> {
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) return [];
    return this.getTransactionsForAccount(accountKey);
  }

  /** Transactions for a specific account (`account.uid` / `account.id` key used on stored docs). */
  async getTransactionsForAccount(accountKey: string): Promise<TransactionRecord[]> {
    const key = accountKey?.trim();
    if (!key) return [];
    const results = await this.offlineCrud.fetchAll<TransactionRecord>(
      'transactions',
      async () => {
        const snap = await getDocs(
          query(collection(this.firestore, TRANSACTIONS_COLLECTION), where('accountId', '==', key)),
        );
        return sortTransactionsByCreatedAtDesc(
          snap.docs.map((d) => this.mapTransaction(d.id, d.data())),
        );
      },
      { indexName: 'accountId', value: key },
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
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) {
      return { items: [], total: 0, hasMore: false };
    }
    return this.offlineCrud.fetchTransactionsPage(accountKey, filter, offset, limit, async () => {
      const snap = await getDocs(
        query(
          collection(this.firestore, TRANSACTIONS_COLLECTION),
          where('accountId', '==', accountKey),
        ),
      );
      return snap.docs.map((d) => this.mapTransaction(d.id, d.data()));
    });
  }

  async getRecentTransactions(limitHint = 50): Promise<TransactionRecord[]> {
    const { items } = await this.getTransactionsPage({}, 0, limitHint);
    return items;
  }

  /** All recurring schedules for the selected account (cache-first). */
  async getRecurringTransactions(): Promise<RecurringTransactionRecord[]> {
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) return [];
    const rows = await this.offlineCrud.fetchAll<RecurringTransactionRecord>(
      'recurring-transactions',
      async () => {
        const snap = await getDocs(
          query(
            collection(this.firestore, RECURRING_TRANSACTIONS_COLLECTION),
            where('accountId', '==', accountKey),
          ),
        );
        return snap.docs.map((d) => this.mapRecurringTransaction(d.id, d.data()));
      },
      { indexName: 'accountId', value: accountKey },
    );
    return [...rows].sort((a, b) => {
      const ta = a.nextPaymentDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const tb = b.nextPaymentDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }

  async updateRecurringTransaction(
    recurringId: string,
    patch: RecurringTransactionUpdateInput,
  ): Promise<void> {
    const cached = await this.offlineCrud.fetchOne<RecurringTransactionRecord>(
      'recurring-transactions',
      recurringId,
      async () => this.getRecurringTransactionDirect(recurringId),
    );
    if (!cached) {
      throw new Error('Recurring schedule not found or access denied.');
    }
    const patchRecord: Record<string, unknown> = {};
    if (patch.transactionId !== undefined) patchRecord['transactionId'] = patch.transactionId;
    if (patch.description !== undefined) patchRecord['description'] = patch.description.trim();
    if (patch.category !== undefined) patchRecord['category'] = patch.category.trim();
    if (patch.amount !== undefined) patchRecord['amount'] = Number(patch.amount);
    if (patch.type !== undefined) patchRecord['type'] = patch.type;
    if (patch.icon !== undefined) patchRecord['icon'] = patch.icon;
    if (patch.source !== undefined) patchRecord['source'] = patch.source?.trim() ?? null;
    if (patch.recurringFrequency !== undefined)
      patchRecord['recurringFrequency'] = patch.recurringFrequency?.trim() ?? null;
    if (patch.isAutoPay !== undefined) patchRecord['isAutoPay'] = patch.isAutoPay;
    if (patch.isActive !== undefined) patchRecord['isActive'] = patch.isActive;
    if (patch.lastPaymentDate !== undefined) patchRecord['lastPaymentDate'] = patch.lastPaymentDate;
    if (patch.nextPaymentDate !== undefined) patchRecord['nextPaymentDate'] = patch.nextPaymentDate;

    await this.offlineCrud.update<RecurringTransactionRecord>(
      'recurring-transactions',
      recurringId,
      async () => {
        const ref = doc(this.firestore, `${RECURRING_TRANSACTIONS_COLLECTION}/${recurringId}`);
        const existing = await getDoc(ref);
        if (!existing.exists() || existing.id !== recurringId) {
          throw new Error('Recurring schedule not found or access denied.');
        }
        await updateDoc(ref, {
          ...patchRecord,
          updatedAt: serverTimestamp(),
        });
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }

  /** Set `isActive = false` to stop a recurring schedule without deleting it. */
  async stopRecurringTransaction(recurringId: string): Promise<void> {
    return this.updateRecurringTransaction(recurringId, { isActive: false });
  }

  /** Returns all transactions linked to a recurring schedule, sorted by createdAt desc. */
  async getTransactionsForRecurring(recurringTransactionId: string): Promise<TransactionRecord[]> {
    const all = await this.getTransactions();
    return all
      .filter((t) => t.recurringTransactionId === recurringTransactionId)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  async deleteRecurringTransaction(recurringId: string): Promise<void> {
    await this.offlineCrud.remove('recurring-transactions', recurringId, async () => {
      const ref = doc(this.firestore, `${RECURRING_TRANSACTIONS_COLLECTION}/${recurringId}`);
      const existing = await getDoc(ref);
      if (!existing.exists() || existing.id !== recurringId) {
        throw new Error('Recurring schedule not found or access denied.');
      }
      await deleteDoc(ref);
    });
  }

  /** Sync worker: apply queued update to Firestore and refresh cache. */
  async applyPendingRecurringUpdate(
    docId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const last = patch['lastPaymentDate'];
    const next = patch['nextPaymentDate'];
    const ref = doc(this.firestore, `${RECURRING_TRANSACTIONS_COLLECTION}/${docId}`);
    const updates: Record<string, unknown> = {
      ...(last != null ? { lastPaymentDate: this.coerceQueuedDate(last) } : {}),
      ...(next != null ? { nextPaymentDate: this.coerceQueuedDate(next) } : {}),
      ...(patch['transactionId'] != null ? { transactionId: patch['transactionId'] } : {}),
      ...(patch['description'] != null ? { description: patch['description'] } : {}),
      ...(patch['category'] != null ? { category: patch['category'] } : {}),
      ...(patch['amount'] != null ? { amount: patch['amount'] } : {}),
      ...(patch['type'] != null ? { type: patch['type'] } : {}),
      ...(patch['recurringFrequency'] != null ? { recurringFrequency: patch['recurringFrequency'] } : {}),
      ...(patch['isAutoPay'] != null ? { isAutoPay: patch['isAutoPay'] } : {}),
      ...(patch['isActive'] != null ? { isActive: patch['isActive'] } : {}),
      updatedAt: serverTimestamp(),
    };
    await updateDoc(ref, updates);
    const row = await this.getRecurringTransactionDirect(docId);
    if (!row) throw new Error('Failed to read recurring schedule after sync.');
    await this.idbCache.put('recurring-transactions', { ...row, _pendingSync: false });
  }

  private coerceQueuedDate(v: unknown): Date {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') return new Date(v);
    const d = (v as { toDate?: () => Date })?.toDate?.();
    if (d instanceof Date) return d;
    return new Date();
  }

  /** Sync worker: delete on server after offline delete was queued. */
  async applyPendingRecurringDelete(docId: string): Promise<void> {
    const ref = doc(this.firestore, `${RECURRING_TRANSACTIONS_COLLECTION}/${docId}`);
    await deleteDoc(ref);
  }

  async createRecurringTransaction(
    data: RecurringTransactionCreateInput,
    options?: { syncRemoteInBackground?: boolean },
  ): Promise<RecurringTransactionRecord> {
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    return this.offlineCrud.create<RecurringTransactionRecord>(
      'recurring-transactions',
      'uid',
      async (assignedId: string) => {
        const ref = doc(this.firestore, RECURRING_TRANSACTIONS_COLLECTION, assignedId);
        await setDoc(ref, {
          accountId,
          transactionId: data.transactionId,
          description: data.description?.trim() ?? '',
          category: data.category?.trim() ?? '',
          amount: Number(data.amount),
          type: data.type,
          icon: data.icon ?? null,
          source: data.source?.trim() ?? null,
          recurringFrequency: data.recurringFrequency?.trim() ?? null,
          isAutoPay: data.isAutoPay ?? false,
          isActive: data.isActive ?? true,
          lastPaymentDate: data.lastPaymentDate,
          nextPaymentDate: data.nextPaymentDate,
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const row = await this.getRecurringTransactionDirect(assignedId);
        if (!row) {
          throw new Error('Failed to read recurring transaction after creation.');
        }
        return row;
      },
      {
        accountId,
        transactionId: data.transactionId,
        description: data.description?.trim() ?? '',
        category: data.category?.trim() ?? '',
        amount: Number(data.amount),
        type: data.type,
        icon: data.icon ?? null,
        source: data.source?.trim() ?? null,
        recurringFrequency: data.recurringFrequency?.trim() ?? null,
        isAutoPay: data.isAutoPay ?? false,
        isActive: data.isActive ?? true,
        lastPaymentDate: data.lastPaymentDate,
        nextPaymentDate: data.nextPaymentDate,
        date: day,
      },
      options?.syncRemoteInBackground ? { syncRemoteInBackground: true } : undefined,
    );
  }

  async applyPendingRecurringCreate(
    docId: string,
    data: RecurringTransactionCreateInput,
  ): Promise<void> {
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    const ref = doc(this.firestore, RECURRING_TRANSACTIONS_COLLECTION, docId);
    await setDoc(ref, {
      accountId,
      transactionId: data.transactionId,
      description: data.description?.trim() ?? '',
      category: data.category?.trim() ?? '',
      amount: Number(data.amount),
      type: data.type,
      icon: data.icon ?? null,
      source: data.source?.trim() ?? null,
      recurringFrequency: data.recurringFrequency?.trim() ?? null,
      isAutoPay: data.isAutoPay ?? false,
      isActive: data.isActive ?? true,
      lastPaymentDate: data.lastPaymentDate,
      nextPaymentDate: data.nextPaymentDate,
      date: day,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const row = await this.getRecurringTransactionDirect(docId);
    if (!row) throw new Error('Failed to read recurring transaction after pending create sync.');
    await this.idbCache.put('recurring-transactions', { ...row, _pendingSync: false });
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
    const expected = await this.selectedAccountKey();
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
    const expected = await this.selectedAccountKey();
    if (!expected) return null;
    const snap = await getDoc(
      doc(this.firestore, `${RECURRING_TRANSACTIONS_COLLECTION}/${recurringTransactionId}`),
    );
    if (!snap.exists()) return null;
    const data = snap.data();
    if ((data['accountId'] as string) !== expected) return null;
    return this.mapRecurringTransaction(snap.id, data);
  }

  // ─── Private helpers ───

  private asFirestoreDate(v: unknown): Date | null {
    if (v == null) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const fn = (v as { toDate?: () => Date }).toDate;
    if (typeof fn === 'function') {
      const d = fn.call(v);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    }
    return null;
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
      paidBy: (data['paidBy'] as string | null | undefined) ?? null,
      icon: data['icon'] as string | null,
      isRecurring: (data['isRecurring'] as boolean) ?? false,
      recurringFrequency: (data['recurringFrequency'] as string) ?? null,
      recurringTransactionId: (data['recurringTransactionId'] as string) ?? null,
      type: (data['type'] as string) ?? 'expense',
      source: data['source'] as string | undefined,
      nextPaymentDate: this.asFirestoreDate(data['nextPaymentDate']),
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
      description: (data['description'] as string) ?? '',
      category: (data['category'] as string) ?? '',
      amount: (data['amount'] as number) ?? 0,
      type: (data['type'] as string) ?? 'expense',
      icon: (data['icon'] as string | null) ?? null,
      source: (data['source'] as string | null) ?? null,
      recurringFrequency: (data['recurringFrequency'] as string | null) ?? null,
      isAutoPay: (data['isAutoPay'] as boolean | null) ?? null,
      isActive: (data['isActive'] as boolean) ?? true,
      lastPaymentDate: this.asFirestoreDate(data['lastPaymentDate']),
      nextPaymentDate: this.asFirestoreDate(data['nextPaymentDate']),
      date: docCalendarDate(data, created),
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
