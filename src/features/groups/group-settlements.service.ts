import { computed, effect, inject, Injectable, signal, Signal, untracked } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  collection,
  doc,
  Firestore,
  getDocs,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import {
  GroupSettlement,
  GroupSettlementCreateInput,
  GroupSettlementDocument,
} from '../../shared/models/group.model';
import { OfflineCrudService, PostSyncCallable } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';

const STORE = 'group-settlements';

function settlementsPath(groupId: string) {
  return `groups/${groupId}/settlements`;
}

function toSettlement(id: string, data: GroupSettlementDocument): GroupSettlement {
  return {
    id,
    groupId: data.groupId,
    fromId: data.fromId,
    fromName: data.fromName,
    toId: data.toId,
    toName: data.toName,
    amount: data.amount,
    currency: data.currency,
    note: data.note,
    settledAt: data.settledAt
      ? (data.settledAt as unknown as { toDate(): Date }).toDate()
      : new Date(),
    createdAt: data.createdAt
      ? (data.createdAt as unknown as { toDate(): Date }).toDate()
      : null,
  };
}

@Injectable({ providedIn: 'root' })
export class GroupSettlementsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);

  /** Reactive settlements map keyed by groupId; see notes on `GroupExpensesService`. */
  private readonly _settlementsByGroup = signal<Record<string, GroupSettlement[]>>({});

  constructor() {
    effect(() => {
      const _stamp = this.offlineCrud.revalidationCounts()[STORE] ?? 0;
      untracked(() => void this.hydrateAllTrackedGroupsFromCache());
    });
  }

  settlementsForGroup(groupId: string): Signal<GroupSettlement[]> {
    return computed(() => this._settlementsByGroup()[groupId] ?? []);
  }

  /** Anchor for security-rules authorship checks on settlement writes. */
  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to record settlements.');
    return uid;
  }

  /** Cache-first: serve IDB immediately, revalidate from Firestore in background when online. */
  async getSettlements(groupId: string): Promise<GroupSettlement[]> {
    return this.offlineCrud.fetchAll<GroupSettlement>(
      STORE,
      () => this.fetchSettlementsFromFirestore(groupId),
      { indexName: 'groupId', value: groupId },
    );
  }

  async refreshSettlements(groupId: string): Promise<GroupSettlement[]> {
    try {
      const list = await this.getSettlements(groupId);
      this._settlementsByGroup.update((prev) => ({ ...prev, [groupId]: list }));
      return list;
    } catch (e) {
      console.warn('refreshSettlements failed', e);
      return this._settlementsByGroup()[groupId] ?? [];
    }
  }

  private async hydrateAllTrackedGroupsFromCache(): Promise<void> {
    const tracked = Object.keys(this._settlementsByGroup());
    if (tracked.length === 0) return;
    const next: Record<string, GroupSettlement[]> = {};
    for (const gid of tracked) {
      next[gid] = await this.idbCache.getAllByIndex<GroupSettlement>(STORE, 'groupId', gid);
    }
    this._settlementsByGroup.set(next);
  }

  /**
   * Create a settlement with optimistic IDB write, then Firestore when online.
   *
   * @param postSyncCallablesBuilder Optional factory receiving the pre-assigned settlement id;
   *   returns callables that SyncService invokes after the server write succeeds (offline path).
   * @param onSuccess Callback invoked after a successful **online** write.
   */
  async addSettlement(
    input: GroupSettlementCreateInput,
    options?: {
      postSyncCallablesBuilder?: (settlementId: string) => PostSyncCallable[];
      onSuccess?: (settlementId: string, settlement: GroupSettlement) => void;
    },
  ): Promise<GroupSettlement> {
    const uid = this.requireUid();
    const payload: Record<string, unknown> = {
      groupId: input.groupId,
      fromId: input.fromId,
      fromName: input.fromName,
      toId: input.toId,
      toName: input.toName,
      amount: input.amount,
      currency: input.currency,
      note: input.note ?? '',
      // Authorship anchor for the rules' allow update predicate.
      createdBy: uid,
    };

    return this.offlineCrud.createWithPath<GroupSettlement>(
      STORE,
      settlementsPath(input.groupId),
      'id',
      async (assignedId) => {
        const ref = doc(this.firestore, settlementsPath(input.groupId), assignedId);
        await setDoc(ref, {
          ...payload,
          settledAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        const snap = await getDoc(ref);
        return toSettlement(assignedId, snap.data() as GroupSettlementDocument);
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

  // ─── Sync worker helpers ────────────────────────────────────────────────────

  async applyPendingGroupSettlementCreate(
    docId: string,
    data: GroupSettlementCreateInput,
  ): Promise<void> {
    const uid = this.requireUid();
    const ref = doc(this.firestore, settlementsPath(data.groupId), docId);
    await setDoc(ref, {
      groupId: data.groupId,
      fromId: data.fromId,
      fromName: data.fromName,
      toId: data.toId,
      toName: data.toName,
      amount: data.amount,
      currency: data.currency,
      note: data.note ?? '',
      createdBy: uid,
      settledAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    const snap = await getDoc(ref);
    const settlement = toSettlement(docId, snap.data() as GroupSettlementDocument);
    await this.idbCache.put(STORE, { ...settlement, _pendingSync: false });
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async fetchSettlementsFromFirestore(groupId: string): Promise<GroupSettlement[]> {
    const col = collection(this.firestore, settlementsPath(groupId));
    const snap = await getDocs(query(col, orderBy('settledAt', 'desc')));
    return snap.docs.map((d) => toSettlement(d.id, d.data() as GroupSettlementDocument));
  }
}
