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
import { Account } from '../shared/models/account.model';
import { OfflineCrudService } from '../core/offline/offline-crud.service';

const BUDGETS_COLLECTION = 'budgets';

@Injectable({ providedIn: 'root' })
export class BudgetsService {
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

  async createBudget(data: BudgetCreateInput, userId?: string): Promise<Budget> {
    const uid = userId ?? this.requireUid();
    const accountId = data.accountId ?? this.requireSelectedAccountKey();
    return this.offlineCrud.create<Budget>(
      'budgets',
      'id',
      async () => {
        const ref = await addDoc(collection(this.firestore, BUDGETS_COLLECTION), {
          ownerId: uid,
          accountId,
          limit: Number(data.limit),
          month: data.month,
          name: data.name?.trim() || 'Budget',
          category: data.category?.trim() || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const budget = await this.getBudgetDirect(ref.id, uid);
        if (!budget) {
          throw new Error('Failed to read budget after creation.');
        }
        return budget;
      },
      {
        ownerId: uid,
        accountId,
        limit: Number(data.limit),
        month: data.month,
        name: data.name?.trim() || 'Budget',
        category: data.category?.trim() || '',
      },
    );
  }

  async updateBudget(budgetId: string, patch: BudgetUpdateInput): Promise<void> {
    const uid = this.requireUid();
    const cached = await this.offlineCrud.fetchOne<Budget>(
      'budgets',
      budgetId,
      async () => {
        const snap = await getDoc(doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (data['ownerId'] !== uid) return null;
        return this.mapBudget(snap.id, data);
      },
    );

    if (!cached) {
      throw new Error('Budget not found or access denied.');
    }

    const patchRecord: Record<string, unknown> = {};
    if (patch.limit !== undefined) patchRecord['limit'] = Number(patch.limit);
    if (patch.month !== undefined) patchRecord['month'] = patch.month;
    if (patch.name !== undefined) patchRecord['name'] = patch.name?.trim() || '';
    if (patch.category !== undefined) patchRecord['category'] = patch.category?.trim() || '';

    await this.offlineCrud.update<Budget>(
      'budgets',
      budgetId,
      async () => {
        const budgetRef = doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`);
        const existing = await getDoc(budgetRef);
        if (!existing.exists() || existing.data()['ownerId'] !== uid) {
          throw new Error('Budget not found or access denied.');
        }
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await updateDoc(budgetRef, updates);
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }

  async getBudget(budgetId: string): Promise<Budget | null> {
    return this.offlineCrud.fetchOne<Budget>(
      'budgets',
      budgetId,
      async () => {
        const uid = this.requireUid();
        const snap = await getDoc(doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (data['ownerId'] !== uid) return null;
        return this.mapBudget(snap.id, data);
      },
    );
  }

  async getBudgets(): Promise<Budget[]> {
    const uid = this.requireUid();
    const accountId = this.selectedAccountKey();
    if (!accountId) return [];
    return this.offlineCrud.fetchAll<Budget>(
      'budgets',
      async () => {
        const base = collection(this.firestore, BUDGETS_COLLECTION);
        const constraints = [
          where('ownerId', '==', uid),
          where('accountId', '==', accountId),
        ];
        const snap = await getDocs(query(base, ...constraints));
        return snap.docs.map((d) => this.mapBudget(d.id, d.data()));
      },
      { indexName: 'accountId', value: accountId },
    );
  }

  /** Direct Firestore read bypassing offline layer (used internally after create). */
  private async getBudgetDirect(budgetId: string, uid: string): Promise<Budget | null> {
    const snap = await getDoc(doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapBudget(snap.id, data);
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
      name: (data['name'] as string) ?? undefined,
      category: (data['category'] as string) ?? undefined,
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
