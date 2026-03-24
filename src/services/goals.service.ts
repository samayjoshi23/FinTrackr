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

const GOALS_COLLECTION = 'goals';

@Injectable({ providedIn: 'root' })
export class GoalsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  async createGoal(data: GoalCreateInput, userId?: string): Promise<Goal> {
    const uid = userId ?? this.requireUid();
    const ref = await addDoc(collection(this.firestore, GOALS_COLLECTION), {
      ownerId: uid,
      accountId: data.accountId,
      name: data.name.trim(),
      target: Number(data.target),
      dueDate: data.dueDate,
      currentAmount: Number(data.currentAmount),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const goal = await this.getGoal(ref.id);
    if (!goal) {
      throw new Error('Failed to read goal after creation.');
    }
    return goal;
  }

  async updateGoal(goalId: string, patch: GoalUpdateInput): Promise<void> {
    const uid = this.requireUid();
    const goalRef = doc(this.firestore, `${GOALS_COLLECTION}/${goalId}`);
    const existing = await getDoc(goalRef);
    if (!existing.exists() || existing.data()['ownerId'] !== uid) {
      throw new Error('Goal not found or access denied.');
    }

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.name !== undefined) updates['name'] = patch.name.trim();
    if (patch.target !== undefined) updates['target'] = Number(patch.target);
    if (patch.dueDate !== undefined) updates['dueDate'] = patch.dueDate;
    if (patch.currentAmount !== undefined) updates['currentAmount'] = Number(patch.currentAmount);
    await updateDoc(goalRef, updates);
  }

  async getGoal(goalId: string): Promise<Goal | null> {
    const uid = this.requireUid();
    const snap = await getDoc(doc(this.firestore, `${GOALS_COLLECTION}/${goalId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapGoal(snap.id, data);
  }

  async getGoals(accountId?: string): Promise<Goal[]> {
    const uid = this.requireUid();
    const base = collection(this.firestore, GOALS_COLLECTION);
    const constraints = [where('ownerId', '==', uid)];
    if (accountId) {
      constraints.push(where('accountId', '==', accountId));
    }
    const snap = await getDocs(query(base, ...constraints));
    return snap.docs.map((d) => this.mapGoal(d.id, d.data()));
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
