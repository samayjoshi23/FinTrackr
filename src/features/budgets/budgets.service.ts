import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
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
import { Budget, BudgetCreateInput, BudgetUpdateInput } from '../../shared/models/budget.model';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { AccountsService } from '../accounts/accounts.service';
import { date, docCalendarDate } from '../../core/date';

const BUDGETS_COLLECTION = 'budgets';

@Injectable({ providedIn: 'root' })
export class BudgetsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);
  private readonly accountsService = inject(AccountsService);

  private async selectedAccountKey(): Promise<string | null> {
    const a = await this.accountsService.getSelectedAccount();
    return a?.uid ?? a?.id ?? null;
  }

  private async requireSelectedAccountKey(): Promise<string> {
    const id = await this.selectedAccountKey();
    if (!id) throw new Error('No account selected.');
    return id;
  }

  async createBudget(data: BudgetCreateInput, userId?: string): Promise<Budget> {
    const uid = userId ?? this.requireUid();
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    return this.offlineCrud.create<Budget>(
      'budgets',
      'id',
      async (assignedId: string) => {
        const ref = doc(this.firestore, BUDGETS_COLLECTION, assignedId);
        await setDoc(ref, {
          ownerId: uid,
          accountId,
          limit: Number(data.limit),
          month: data.month,
          name: data.name?.trim() || 'Budget',
          category: data.category?.trim() || '',
          ...(data.categoryId?.trim() ? { categoryId: data.categoryId.trim() } : {}),
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const budget = await this.getBudgetDirect(assignedId, uid);
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
        ...(data.categoryId?.trim() ? { categoryId: data.categoryId.trim() } : {}),
        date: day,
      },
    );
  }

  async applyPendingBudgetCreate(docId: string, data: BudgetCreateInput): Promise<void> {
    const uid = this.requireUid();
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    const ref = doc(this.firestore, BUDGETS_COLLECTION, docId);
    await setDoc(ref, {
      ownerId: uid,
      accountId,
      limit: Number(data.limit),
      month: data.month,
      name: data.name?.trim() || 'Budget',
      category: data.category?.trim() || '',
      ...(data.categoryId?.trim() ? { categoryId: data.categoryId.trim() } : {}),
      date: day,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const budget = await this.getBudgetDirect(docId, uid);
    if (!budget) throw new Error('Failed to read budget after pending create sync.');
    await this.idbCache.put('budgets', { ...budget, _pendingSync: false });
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
    if (patch.categoryId !== undefined)
      patchRecord['categoryId'] = patch.categoryId?.trim() || null;

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
    const accountId = await this.selectedAccountKey();
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

  async deleteBudget(budgetId: string): Promise<void> {
    await this.offlineCrud.remove('budgets', budgetId, async () => {
      const uid = this.requireUid();
      const budgetRef = doc(this.firestore, `${BUDGETS_COLLECTION}/${budgetId}`);
      const existing = await getDoc(budgetRef);
      if (!existing.exists() || existing.data()['ownerId'] !== uid) {
        throw new Error('Budget not found or access denied.');
      }
      await deleteDoc(budgetRef);
    });
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
    const created = createdAt?.toDate?.() ?? null;
    const cid = data['categoryId'];
    return {
      id,
      ownerId: (data['ownerId'] as string) ?? '',
      accountId: (data['accountId'] as string) ?? '',
      limit: Number(data['limit'] ?? 0),
      month: (data['month'] as string) ?? '',
      name: (data['name'] as string) ?? undefined,
      category: (data['category'] as string) ?? undefined,
      ...(typeof cid === 'string' && cid.trim() ? { categoryId: cid.trim() } : {}),
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
      date: docCalendarDate(data, created),
    };
  }
}
