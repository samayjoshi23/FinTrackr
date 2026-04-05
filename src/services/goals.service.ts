import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  addDoc,
  collection,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Goal, GoalCreateInput, GoalUpdateInput } from '../shared/models/goal.model';
import { Account } from '../shared/models/account.model';
import { OfflineCrudService } from '../core/offline/offline-crud.service';

const GOALS_COLLECTION = 'goals';

@Injectable({ providedIn: 'root' })
export class GoalsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);

  private get currentAccount(): Account | null {
    return JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
  }

  private selectedAccountKey(): string | null {
    const a = this.currentAccount;
    return a?.uid ?? a?.id ?? null;
  }

  private requireSelectedAccountKey(): string {
    const id = this.selectedAccountKey();
    if (!id) throw new Error('No account selected.');
    return id;
  }

  async createGoal(data: GoalCreateInput, userId?: string): Promise<Goal> {
    const uid = userId ?? this.requireUid();
    const accountId = data.accountId ?? this.requireSelectedAccountKey();
    return this.offlineCrud.create<Goal>(
      'goals',
      'id',
      async () => {
        const ref = await addDoc(collection(this.firestore, GOALS_COLLECTION), {
          ownerId: uid,
          accountId,
          name: data.name.trim(),
          target: Number(data.target),
          dueDate: data.dueDate,
          currentAmount: Number(data.currentAmount),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const goal = await this.getGoalDirect(ref.id, uid);
        if (!goal) {
          throw new Error('Failed to read goal after creation.');
        }
        return goal;
      },
      {
        ownerId: uid,
        accountId,
        name: data.name.trim(),
        target: Number(data.target),
        dueDate: data.dueDate,
        currentAmount: Number(data.currentAmount),
      },
    );
  }

  async updateGoal(goalId: string, patch: GoalUpdateInput): Promise<void> {
    const cached = await this.offlineCrud.fetchOne<Goal>('goals', goalId, async () => {
      const snap = await getDoc(doc(this.firestore, `${GOALS_COLLECTION}/${goalId}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return this.mapGoal(snap.id, data);
    });

    if (!cached) {
      throw new Error('Goal not found or access denied.');
    }

    const patchRecord: Record<string, unknown> = {};
    if (patch.name !== undefined) patchRecord['name'] = patch.name.trim();
    if (patch.target !== undefined) patchRecord['target'] = Number(patch.target);
    if (patch.dueDate !== undefined) patchRecord['dueDate'] = patch.dueDate;
    if (patch.currentAmount !== undefined)
      patchRecord['currentAmount'] = Number(patch.currentAmount);

    await this.offlineCrud.update<Goal>(
      'goals',
      goalId,
      async () => {
        const goalRef = doc(this.firestore, `${GOALS_COLLECTION}/${goalId}`);
        const existing = await getDoc(goalRef);
        if (!existing.exists()) {
          throw new Error('Goal not found or access denied.');
        }
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await updateDoc(goalRef, updates);
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }

  async getGoal(goalId: string): Promise<Goal | null> {
    return this.offlineCrud.fetchOne<Goal>('goals', goalId, async () => {
      const uid = this.requireUid();
      const snap = await getDoc(doc(this.firestore, `${GOALS_COLLECTION}/${goalId}`));
      if (!snap.exists()) return null;
      return this.mapGoal(snap.id, snap.data());
    });
  }

  async getGoals(): Promise<Goal[]> {
    const accountId = this.selectedAccountKey();
    if (!accountId) return [];
    return this.offlineCrud.fetchAll<Goal>(
      'goals',
      async () => {
        const base = collection(this.firestore, GOALS_COLLECTION);
        const constraints = [where('accountId', '==', accountId)];
        const snap = await getDocs(query(base, ...constraints));
        return snap.docs.map((d) => this.mapGoal(d.id, d.data()));
      },
      { indexName: 'accountId', value: accountId },
    );
  }

  /** Direct Firestore read bypassing offline layer (used internally after create). */
  private async getGoalDirect(goalId: string, uid: string): Promise<Goal | null> {
    const snap = await getDoc(doc(this.firestore, `${GOALS_COLLECTION}/${goalId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapGoal(snap.id, data);
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage goals.');
    return uid;
  }

  private mapGoal(id: string, data: Record<string, unknown>): Goal {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      id,
      ownerId: (data['ownerId'] as string) ?? '',
      accountId: (data['accountId'] as string) ?? '',
      name: (data['name'] as string) ?? '',
      target: Number(data['target'] ?? 0),
      dueDate: (data['dueDate'] as string) ?? '',
      currentAmount: Number(data['currentAmount'] ?? 0),
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
