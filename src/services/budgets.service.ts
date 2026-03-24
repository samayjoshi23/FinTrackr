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
import { Budget, BudgetCreateInput, BudgetUpdateInput } from '../shared/models/budget.model';

const BUDGETS_COLLECTION = 'budgets';

@Injectable({ providedIn: 'root' })
export class BudgetsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  async createBudget(data: BudgetCreateInput, userId?: string): Promise<Budget> {
    const uid = userId ?? this.requireUid();
    const ref = await addDoc(collection(this.firestore, BUDGETS_COLLECTION), {
      ownerId: uid,
      accountId: data.accountId,
      limit: Number(data.limit),
      month: data.month,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const budget = await this.getBudget(ref.id);
    if (!budget) {
      throw new Error('Failed to read budget after creation.');
    }
    return budget;
  }

  async updateBudget(budgetId: string, patch: BudgetUpdateInput): Promise<void> {
    const uid = this.requireUid();
    const budgetRef = doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`);
    const existing = await getDoc(budgetRef);
    if (!existing.exists() || existing.data()['ownerId'] !== uid) {
      throw new Error('Budget not found or access denied.');
    }

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.limit !== undefined) updates['limit'] = Number(patch.limit);
    if (patch.month !== undefined) updates['month'] = patch.month;
    await updateDoc(budgetRef, updates);
  }

  async getBudget(budgetId: string): Promise<Budget | null> {
    const uid = this.requireUid();
    const snap = await getDoc(doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapBudget(snap.id, data);
  }

  async getBudgets(accountId?: string): Promise<Budget[]> {
    const uid = this.requireUid();
    const base = collection(this.firestore, BUDGETS_COLLECTION);
    const constraints = [where('ownerId', '==', uid)];
    if (accountId) {
      constraints.push(where('accountId', '==', accountId));
    }
    const snap = await getDocs(query(base, ...constraints));
    return snap.docs.map((d) => this.mapBudget(d.id, d.data()));
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage budgets.');
    return uid;
  }

  private mapBudget(id: string, data: Record<string, unknown>): Budget {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      id,
      ownerId: (data['ownerId'] as string) ?? '',
      accountId: (data['accountId'] as string) ?? '',
      limit: Number(data['limit'] ?? 0),
      month: (data['month'] as string) ?? '',
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
