import { computed, effect, inject, Injectable, signal, Signal, untracked } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  collection,
  doc,
  Firestore,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
} from '@angular/fire/firestore';
import {
  GroupExpense,
  GroupExpenseCreateInput,
  GroupExpenseDocument,
  GroupExpenseUpdateInput,
} from '../../shared/models/group.model';
import { OfflineCrudService, PostSyncCallable } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';

const STORE = 'group-expenses';

function expensesPath(groupId: string) {
  return `groups/${groupId}/expenses`;
}

function toExpense(id: string, data: GroupExpenseDocument): GroupExpense {
  return {
    id,
    groupId: data.groupId,
    description: data.description,
    amount: data.amount,
    currency: data.currency,
    paidById: data.paidById,
    paidByName: data.paidByName,
    paidByIds: data.paidByIds,
    paidByNames: data.paidByNames,
    splits: data.splits ?? [],
    date: data.date,
    createdAt: data.createdAt ? (data.createdAt as unknown as { toDate(): Date }).toDate() : null,
    updatedAt: data.updatedAt ? (data.updatedAt as unknown as { toDate(): Date }).toDate() : null,
  };
}

@Injectable({ providedIn: 'root' })
export class GroupExpensesService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);

  /**
   * Reactive expenses map keyed by groupId. Populated lazily as callers invoke
   * `refreshExpenses(groupId)`; the offline layer's revalidation events feed
   * back into every group already tracked here, so any subscriber to
   * `expensesForGroup(id)` receives fresh data automatically.
   */
  private readonly _expensesByGroup = signal<Record<string, GroupExpense[]>>({});

  constructor() {
    effect(() => {
      const _stamp = this.offlineCrud.revalidationCounts()[STORE] ?? 0;
      untracked(() => void this.hydrateAllTrackedGroupsFromCache());
    });
  }

  /** Reactive per-group expenses. Empty array until `refreshExpenses(groupId)` runs. */
  expensesForGroup(groupId: string): Signal<GroupExpense[]> {
    return computed(() => this._expensesByGroup()[groupId] ?? []);
  }

  /** Anchor for security-rules authorship checks on group subcollection writes. */
  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage group expenses.');
    return uid;
  }

  /** Cache-first: serve IDB immediately, revalidate from Firestore in background when online. */
  async getExpenses(groupId: string): Promise<GroupExpense[]> {
    return this.offlineCrud.fetchAll<GroupExpense>(
      STORE,
      () => this.fetchExpensesFromFirestore(groupId),
      { indexName: 'groupId', value: groupId },
    );
  }

  /**
   * Fetch (cache-first + background revalidate via `fetchAll`) and publish
   * into the reactive `expensesForGroup(id)` signal. Idempotent.
   */
  async refreshExpenses(groupId: string): Promise<GroupExpense[]> {
    try {
      const list = await this.getExpenses(groupId);
      this._expensesByGroup.update((prev) => ({ ...prev, [groupId]: list }));
      return list;
    } catch (e) {
      console.warn('refreshExpenses failed', e);
      return this._expensesByGroup()[groupId] ?? [];
    }
  }

  private async hydrateAllTrackedGroupsFromCache(): Promise<void> {
    const tracked = Object.keys(this._expensesByGroup());
    if (tracked.length === 0) return;
    const next: Record<string, GroupExpense[]> = {};
    for (const gid of tracked) {
      next[gid] = await this.idbCache.getAllByIndex<GroupExpense>(STORE, 'groupId', gid);
    }
    this._expensesByGroup.set(next);
  }

  /**
   * Create an expense with optimistic IDB write, then Firestore when online.
   *
   * @param postSyncCallablesBuilder Optional factory — receives the pre-assigned expense id and
   *   returns callables that SyncService should invoke after the server write succeeds (offline path).
   * @param onSuccess Optional callback invoked with the expense id after a successful **online** write.
   */
  async addExpense(
    input: GroupExpenseCreateInput,
    options?: {
      postSyncCallablesBuilder?: (expenseId: string) => PostSyncCallable[];
      onSuccess?: (expenseId: string, expense: GroupExpense) => void;
    },
  ): Promise<GroupExpense> {
    const uid = this.requireUid();
    const payload: Record<string, unknown> = {
      groupId: input.groupId,
      description: input.description.trim(),
      amount: input.amount,
      currency: input.currency,
      paidById: input.paidById,
      paidByName: input.paidByName,
      ...(input.paidByIds ? { paidByIds: input.paidByIds } : {}),
      ...(input.paidByNames ? { paidByNames: input.paidByNames } : {}),
      splits: input.splits,
      date: input.date,
      // Authorship anchor for the rules' allow update / delete predicates.
      createdBy: uid,
    };

    return this.offlineCrud.createWithPath<GroupExpense>(
      STORE,
      expensesPath(input.groupId),
      'id',
      async (assignedId) => {
        const ref = doc(this.firestore, expensesPath(input.groupId), assignedId);
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const snap = await getDoc(ref);
        return toExpense(assignedId, snap.data() as GroupExpenseDocument);
      },
      payload,
      {
        postSyncCallablesBuilder: options?.postSyncCallablesBuilder,
        onSuccess: options?.onSuccess
          ? (_id, result) => options.onSuccess!(_id, result)
          : undefined,
      },
    );
  }

  async updateExpense(
    groupId: string,
    expenseId: string,
    input: GroupExpenseUpdateInput,
  ): Promise<void> {
    const cached = await this.idbCache.getByKey<GroupExpense>(STORE, expenseId);
    if (!cached) {
      await updateDoc(doc(this.firestore, expensesPath(groupId), expenseId), {
        ...input,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    // _groupId is carried in the patch so SyncService can rebuild the Firestore path
    const patch: Record<string, unknown> = { ...input, _groupId: groupId };

    await this.offlineCrud.update<GroupExpense>(
      STORE,
      expenseId,
      async () => {
        await updateDoc(doc(this.firestore, expensesPath(groupId), expenseId), {
          ...input,
          updatedAt: serverTimestamp(),
        });
      },
      patch,
      cached as unknown as Record<string, unknown>,
    );
  }

  async deleteExpense(groupId: string, expenseId: string): Promise<void> {
    await this.offlineCrud.remove(
      STORE,
      expenseId,
      async () => {
        await deleteDoc(doc(this.firestore, expensesPath(groupId), expenseId));
      },
      { _groupId: groupId },
    );
  }

  // ─── Sync worker helpers ────────────────────────────────────────────────────

  async applyPendingGroupExpenseCreate(
    docId: string,
    data: GroupExpenseCreateInput,
  ): Promise<void> {
    const uid = this.requireUid();
    const ref = doc(this.firestore, expensesPath(data.groupId), docId);
    await setDoc(ref, {
      groupId: data.groupId,
      description: data.description.trim(),
      amount: data.amount,
      currency: data.currency,
      paidById: data.paidById,
      paidByName: data.paidByName,
      ...(data.paidByIds ? { paidByIds: data.paidByIds } : {}),
      ...(data.paidByNames ? { paidByNames: data.paidByNames } : {}),
      splits: data.splits,
      date: data.date,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const snap = await getDoc(ref);
    const expense = toExpense(docId, snap.data() as GroupExpenseDocument);
    await this.idbCache.put(STORE, { ...expense, _pendingSync: false });
  }

  async applyPendingGroupExpenseUpdate(
    groupId: string,
    expenseId: string,
    patch: GroupExpenseUpdateInput,
  ): Promise<void> {
    const ref = doc(this.firestore, expensesPath(groupId), expenseId);
    await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const expense = toExpense(expenseId, snap.data() as GroupExpenseDocument);
      await this.idbCache.put(STORE, { ...expense, _pendingSync: false });
    }
  }

  async applyPendingGroupExpenseDelete(groupId: string, expenseId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, expensesPath(groupId), expenseId));
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async fetchExpensesFromFirestore(groupId: string): Promise<GroupExpense[]> {
    const col = collection(this.firestore, expensesPath(groupId));
    const snap = await getDocs(query(col, orderBy('date', 'desc'), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => toExpense(d.id, d.data() as GroupExpenseDocument));
  }
}
