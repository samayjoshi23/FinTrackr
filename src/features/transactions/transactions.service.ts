import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
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
  applyTransactionFilters,
  paginateTransactionRows,
  resolvePresetRange,
  sortTransactionsByCreatedAtDesc,
  TransactionListFilter,
  TransactionPagedResult,
} from '../../shared/models/transaction-query.model';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import { AccountsService } from '../accounts/accounts.service';
import { date, docCalendarDate } from '../../core/date';
import { asFirestoreDate, isTombstone, mapTransactionDoc } from './transaction-mapper';
import { TransactionSyncService } from './transaction-sync.service';

const TRANSACTIONS_COLLECTION = 'transactions';
const RECURRING_TRANSACTIONS_COLLECTION = 'recurring-transactions';
/** Soft-deleted docs carry `purgeAt`; a Firestore TTL policy on it may hard-delete them. */
const TOMBSTONE_TTL_DAYS = 30;
/** Cap on how long a page waits for the network before serving what's cached. */
const NETWORK_WAIT_MS = 8_000;

/** Resolves when `p` settles or after `ms`, whichever is first. Never rejects. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    p.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly firestore = inject(Firestore);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);
  private readonly accountsService = inject(AccountsService);
  private readonly network = inject(NetworkService);
  private readonly txSync = inject(TransactionSyncService);

  /**
   * Reactive transactions for the currently selected account. Re-hydrated whenever
   * the offline layer signals fresh rows in the `transactions` store, so any
   * background revalidation (or a sibling device's write) surfaces without a
   * manual re-fetch. Consumers can either call `refreshMyTransactions()` on entry
   * OR simply subscribe and let the effect keep them in sync.
   */
  private readonly _myTransactions = signal<TransactionRecord[]>([]);

  constructor() {
    effect(() => {
      const _stamp = this.offlineCrud.revalidationCounts()['transactions'] ?? 0;
      const _rev = this.txSync.revision();
      untracked(() => void this.hydrateFromCache());
    });

    // Keep the selected account live via delta sync. Re-runs when connectivity
    // returns so a device that was offline at boot still bootstraps.
    effect(() => {
      const acc = this.accountsService.selectedAccount();
      const online = this.network.isOnline();
      const key = acc?.uid ?? acc?.id ?? null;
      untracked(() => {
        if (!key) this.txSync.stopLive();
        else if (online) this.txSync.startLive(key);
      });
    });
  }

  private async hydrateFromCache(): Promise<void> {
    const key = await this.selectedAccountKey();
    if (!key) return;
    const rows = await this.idbCache.getAllByIndex<TransactionRecord>('transactions', 'accountId', key);
    this._myTransactions.set(rows);
  }

  /** Explicit refresh — seeds from cache and triggers background Firestore fetch. */
  async refreshMyTransactions(): Promise<TransactionRecord[]> {
    try {
      const list = await this.getTransactions();
      this._myTransactions.set(list);
    } catch (e) {
      console.warn('refreshMyTransactions failed', e);
    }
    return this._myTransactions();
  }

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
  ): Promise<TransactionRecord> {
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    return this.offlineCrud.create<TransactionRecord>(
      'transactions',
      'uid',
      async (assignedId: string) => {
        const ref = doc(this.firestore, TRANSACTIONS_COLLECTION, assignedId);
        const now = new Date();
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
          ...(data.linkedObject != null ? { linkedObject: data.linkedObject } : {}),
          ...(data.linkedObject?.type !== undefined ? { isRecurring: data.linkedObject.type === 'recurring' } : {}),
          date: data.date ?? day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // Return the client-projected record instead of a getDoc round-trip. The
        // offline-crud layer's `mergePendingSyncFlag` uses this only for fields not
        // already in the local cache row (client patches always win), so exact
        // serverTimestamp values don't matter — the next SWR revalidation reconciles.
        return {
          uid: assignedId,
          accountId,
          amount: Number(data.amount),
          description: data.description?.trim() ?? '',
          category: data.category?.trim() ?? '',
          paidBy: data.paidBy != null && String(data.paidBy).trim() ? String(data.paidBy).trim() : null,
          icon: data.icon ?? null,
          isRecurring: data.linkedObject?.type === 'recurring',
          recurringFrequency: null,
          recurringTransactionId: null,
          type: data.type,
          source: data.source,
          nextPaymentDate: null,
          createdAt: now,
          updatedAt: now,
          date: data.date ?? day,
        } as TransactionRecord;
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
        ...(data.linkedObject != null ? { linkedObject: data.linkedObject } : {}),
        ...(data.linkedObject?.type !== undefined ? { isRecurring: data.linkedObject.type === 'recurring' } : {}),
        date: data.date ?? day,
      },
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
        if (!snap.exists() || isTombstone(snap.data())) return null;
        return mapTransactionDoc(snap.id, snap.data());
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
        // No pre-read existence check — Firestore rules are the source of truth for
        // access, and the SWR-cached row we already have (`cached`) proves the doc
        // was visible at read time. `updateDoc` will surface `permission-denied` or
        // `not-found` natively; the sync queue's retry/failure path handles surfacing.
        const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
        await updateDoc(transactionRef, {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        });
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }

  /**
   * Soft delete: stamps `deletedAt` (+ `updatedAt`) instead of removing the doc, so the
   * deletion reaches other devices through their `updatedAt` delta sync. `purgeAt` lets
   * a Firestore TTL policy hard-delete the tombstone later.
   */
  async deleteTransaction(transactionId: string): Promise<void> {
    await this.offlineCrud.remove('transactions', transactionId, async () => {
      // See `updateTransaction` — no pre-read; rules enforce access.
      const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
      await updateDoc(transactionRef, {
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        purgeAt: Timestamp.fromMillis(Date.now() + TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
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
      ...(data.linkedObject?.type !== undefined ? { isRecurring: data.linkedObject.type === 'recurring' } : {}),
      ...(data.linkedObject?.recordId != null
        ? { recurringTransactionId: data.linkedObject.recordId }
        : {}),
      date: day,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Sync worker path — the local cache row was already created by the offline queue
    // enqueue and carries `_pendingSync: true`. Just flip the flag; do NOT read the doc
    // back (that used to double the write cost per queued create). The next SWR
    // revalidation for this account reconciles server timestamps.
    const existing = (await this.idbCache.getByKey<TransactionRecord>('transactions', docId)) as
      | TransactionRecord
      | undefined;
    if (existing) {
      await this.idbCache.put('transactions', { ...existing, _pendingSync: false });
    }
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

  /**
   * Locally-loaded transactions for an account (`account.uid` / `account.id` key).
   * The selected account is kept live by delta sync; any other account gets a one-shot
   * catch-up. Only the loaded history window is returned — screens that need older
   * data call {@link ensureHistorySince} first.
   */
  async getTransactionsForAccount(accountKey: string): Promise<TransactionRecord[]> {
    const key = accountKey?.trim();
    if (!key) return [];
    const selected = await this.selectedAccountKey();
    await settleWithin(
      key === selected ? this.txSync.ensureReady(key) : this.txSync.syncOnce(key),
      NETWORK_WAIT_MS,
    );
    const rows = await this.idbCache.getAllByIndex<TransactionRecord>('transactions', 'accountId', key);
    return sortTransactionsByCreatedAtDesc(rows);
  }

  /**
   * Filtered, paginated transactions from IndexedDB. A date filter reaching past the
   * loaded history pulls the missing pages first; `historyComplete: false` tells list
   * UIs that {@link loadOlderTransactions} can fetch more.
   */
  async getTransactionsPage(
    filter: TransactionListFilter,
    offset: number,
    limit: number,
  ): Promise<TransactionPagedResult> {
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) {
      return {
        items: [],
        total: 0,
        hasMore: false,
        historyComplete: true,
        totals: { income: 0, expense: 0 },
      };
    }
    const range =
      filter.datePreset && filter.datePreset !== 'all'
        ? resolvePresetRange(filter.datePreset, filter.dateFrom, filter.dateTo)
        : null;
    await settleWithin(
      range
        ? this.txSync.ensureHistorySince(accountKey, range.start)
        : this.txSync.ensureReady(accountKey),
      NETWORK_WAIT_MS,
    );
    const rows = await this.idbCache.getAllByIndex<TransactionRecord>(
      'transactions',
      'accountId',
      accountKey,
    );
    const page = paginateTransactionRows(
      sortTransactionsByCreatedAtDesc(applyTransactionFilters(rows, filter)),
      offset,
      limit,
    );
    const info = await this.txSync.historyInfo(accountKey);
    return { ...page, historyComplete: info.complete };
  }

  /** Fetch the next page of older history for the selected account. `true` if rows were added. */
  async loadOlderTransactions(): Promise<boolean> {
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) return false;
    return this.txSync.loadOlder(accountKey);
  }

  /**
   * Make sure history back to `since` (`null` = everything) is loaded for the selected
   * account. Returns `false` when it couldn't be (offline) so callers can avoid
   * computing totals from a partial set.
   */
  async ensureHistorySince(since: Date | null): Promise<boolean> {
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) return false;
    return this.txSync.ensureHistorySince(accountKey, since);
  }

  /** Live transaction count for the selected account (server aggregation; local offline). */
  async countTransactions(): Promise<number> {
    const accountKey = await this.selectedAccountKey();
    if (!accountKey) return 0;
    return this.txSync.countLive(accountKey);
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

  /**
   * Transactions linked to a recurring schedule, newest first. Served from the local
   * cache; while older history isn't loaded, a bounded server query (equality-only,
   * no composite index) fills in matches from before the loaded window.
   */
  async getTransactionsForRecurring(recurringTransactionId: string): Promise<TransactionRecord[]> {
    const isLinked = (t: TransactionRecord) =>
      t.linkedObject?.type === 'recurring' && t.linkedObject?.recordId === recurringTransactionId;
    const byId = new Map((await this.getTransactions()).filter(isLinked).map((t) => [t.uid, t]));

    const accountKey = await this.selectedAccountKey();
    if (accountKey && this.network.isOnline() && !(await this.txSync.historyInfo(accountKey)).complete) {
      try {
        const snap = await getDocs(
          query(
            collection(this.firestore, TRANSACTIONS_COLLECTION),
            where('accountId', '==', accountKey),
            where('linkedObject.recordId', '==', recurringTransactionId),
            limit(100),
          ),
        );
        for (const d of snap.docs) {
          if (byId.has(d.id) || isTombstone(d.data())) continue; // local copy wins
          const row = mapTransactionDoc(d.id, d.data());
          if (isLinked(row)) byId.set(d.id, row);
        }
      } catch (e) {
        console.warn('Loading older recurring transactions failed', e);
      }
    }
    return [...byId.values()].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
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
    if (data['accountId'] !== expected || isTombstone(data)) return null;
    return mapTransactionDoc(snap.id, data);
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
      lastPaymentDate: asFirestoreDate(data['lastPaymentDate']),
      nextPaymentDate: asFirestoreDate(data['nextPaymentDate']),
      date: docCalendarDate(data, created),
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
