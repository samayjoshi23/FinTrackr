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
  where,
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

  /**
   * Per-group live listeners. Started explicitly via {@link subscribeGroup} from any
   * page that keeps a group visible (typically `group-detail`). Ref-counted by
   * groupId so multiple subscribers share ONE Firestore listener and quota cost.
   * Unsubscribing the last ref tears down the underlying `onSnapshot`.
   */
  private readonly listenerHandles = new Map<
    string,
    { unsub: () => void; refCount: number }
  >();

  constructor() {
    effect(() => {
      const _stamp = this.offlineCrud.revalidationCounts()[STORE] ?? 0;
      untracked(() => void this.hydrateAllTrackedGroupsFromCache());
    });
  }

  /**
   * Start a live listener for `groupId` (or bump its ref count if one exists). Returns
   * an unsubscribe function — callers MUST invoke it on component destroy to release
   * the ref. When the last ref is released, the underlying Firestore listener stops.
   *
   * While a listener is active for a group, the SWR TTL for `group-expenses` stays
   * fresh — subsequent `refreshExpenses(groupId)` calls skip Firestore and cross-device
   * writes surface immediately (the whole point of adding this for shared groups).
   */
  subscribeGroup(groupId: string): () => void {
    if (!groupId) return () => {};
    const existing = this.listenerHandles.get(groupId);
    if (existing) {
      existing.refCount += 1;
      return () => this.releaseGroupListener(groupId);
    }
    const unsub = this.offlineCrud.subscribeQuery<GroupExpense>(
      STORE,
      query(collection(this.firestore, expensesPath(groupId))),
      (id, data) => {
        const expense = toExpense(id, data as GroupExpenseDocument);
        // The subcollection docs don't carry `groupId` in every write path (older
        // rows may lack it) — stamp it so `replaceCache` with the `groupId` index
        // filter reconciles this group's slice correctly and the reactive
        // `expensesForGroup` map picks it up on hydration.
        return { ...expense, groupId } as GroupExpense;
      },
      { indexName: 'groupId', value: groupId },
    );
    this.listenerHandles.set(groupId, { unsub, refCount: 1 });
    // Ensure the reactive map has this group tracked so hydrateAllTrackedGroupsFromCache
    // picks it up on the next revalidation bump.
    this._expensesByGroup.update((prev) =>
      Object.prototype.hasOwnProperty.call(prev, groupId) ? prev : { ...prev, [groupId]: [] },
    );
    return () => this.releaseGroupListener(groupId);
  }

  private releaseGroupListener(groupId: string): void {
    const handle = this.listenerHandles.get(groupId);
    if (!handle) return;
    handle.refCount -= 1;
    if (handle.refCount <= 0) {
      try {
        handle.unsub();
      } catch (e) {
        console.warn('GroupExpensesService: listener unsubscribe failed', e);
      }
      this.listenerHandles.delete(groupId);
    }
  }

  /** Tear down every group listener (call on logout to release Firestore quota). */
  stopAllGroupListeners(): void {
    for (const [gid] of this.listenerHandles) {
      const h = this.listenerHandles.get(gid);
      if (!h) continue;
      try {
        h.unsub();
      } catch {
        /* ignore */
      }
    }
    this.listenerHandles.clear();
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
        const now = new Date();
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // Client-projected record instead of a getDoc round-trip — same rationale as
        // TransactionsService.createTransaction. Server timestamps reconcile on the
        // next SWR revalidation for this group's expenses.
        return toExpense(assignedId, {
          ...(payload as unknown as GroupExpenseDocument),
          createdAt: now as unknown as GroupExpenseDocument['createdAt'],
          updatedAt: now as unknown as GroupExpenseDocument['updatedAt'],
        });
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
    // Flip _pendingSync on the row already in cache — no getDoc round-trip.
    const existing = (await this.idbCache.getByKey<GroupExpense>(STORE, docId)) as
      | GroupExpense
      | undefined;
    if (existing) {
      await this.idbCache.put(STORE, { ...existing, _pendingSync: false });
    }
  }

  async applyPendingGroupExpenseUpdate(
    groupId: string,
    expenseId: string,
    patch: GroupExpenseUpdateInput,
  ): Promise<void> {
    const ref = doc(this.firestore, expensesPath(groupId), expenseId);
    await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
    // Merge the patch into the local cache row instead of re-reading — same rationale.
    const existing = (await this.idbCache.getByKey<GroupExpense>(STORE, expenseId)) as
      | GroupExpense
      | undefined;
    if (existing) {
      await this.idbCache.put(STORE, {
        ...existing,
        ...(patch as Record<string, unknown>),
        _pendingSync: false,
      } as GroupExpense);
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
