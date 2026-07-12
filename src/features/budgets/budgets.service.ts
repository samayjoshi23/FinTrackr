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
import {
  Budget,
  BudgetCreateInput,
  BudgetUpdateInput,
  BudgetPlan,
  BudgetPlanUpsertInput,
} from '../../shared/models/budget.model';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import { AccountsService } from '../accounts/accounts.service';
import { date, docCalendarDate } from '../../core/date';

const BUDGETS_COLLECTION = 'budgets';
const BUDGET_PLANS_COLLECTION = 'budgetPlans';
const BUDGET_PLANS_STORE = 'budgetPlans';

@Injectable({ providedIn: 'root' })
export class BudgetsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);
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

  // ─── Budget Plan (single doc per account) ────────────────────────────────────

  /**
   * Reads the account's single recurring budget plan (`budgetPlans/{accountId}`) offline-first.
   * If no plan exists yet, performs a one-time migration that folds any legacy per-category
   * `budgets` documents into one plan (`monthlyBudget` = Σ limits, `categoryBudgets` keyed by
   * each doc's `categoryId`). Returns `null` when neither a plan nor legacy budgets exist.
   */
  async getBudgetPlan(): Promise<BudgetPlan | null> {
    const accountId = await this.selectedAccountKey();
    if (!accountId) return null;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return null;

    const plan = await this.offlineCrud.fetchOne<BudgetPlan>(
      BUDGET_PLANS_STORE,
      accountId,
      () => this.fetchBudgetPlanDirect(accountId, uid),
    );
    if (plan) return plan;

    return this.migrateLegacyBudgetsToPlan(accountId);
  }

  /** Creates or merges the account's budget plan. Idempotent; safe to call repeatedly. */
  async upsertBudgetPlan(input: BudgetPlanUpsertInput): Promise<BudgetPlan> {
    const uid = this.requireUid();
    const accountId = input.accountId || (await this.requireSelectedAccountKey());
    const monthlyBudget = Number(input.monthlyBudget) || 0;
    const categoryBudgets = this.sanitizeCategoryBudgets(input.categoryBudgets);
    const day = date().format('YYYY-MM-DD');

    let existing = (await this.idbCache.getByKey<BudgetPlan>(BUDGET_PLANS_STORE, accountId)) ?? null;
    if (!existing && this.network.isOnline()) {
      existing = await this.fetchBudgetPlanDirect(accountId, uid).catch(() => null);
    }

    if (existing) {
      const patch = { monthlyBudget, categoryBudgets };
      await this.offlineCrud.update<BudgetPlan>(
        BUDGET_PLANS_STORE,
        accountId,
        async () => {
          const ref = doc(this.firestore, BUDGET_PLANS_COLLECTION, accountId);
          await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
        },
        patch,
        existing as unknown as Record<string, unknown>,
      );
      return { ...existing, monthlyBudget, categoryBudgets };
    }

    return this.offlineCrud.create<BudgetPlan>(
      BUDGET_PLANS_STORE,
      'id',
      async (assignedId: string) => {
        const ref = doc(this.firestore, BUDGET_PLANS_COLLECTION, assignedId);
        await setDoc(ref, {
          ownerId: uid,
          accountId,
          monthlyBudget,
          categoryBudgets,
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const plan = await this.fetchBudgetPlanDirect(assignedId, uid);
        if (!plan) throw new Error('Failed to read budget plan after creation.');
        return plan;
      },
      { ownerId: uid, accountId, monthlyBudget, categoryBudgets, date: day },
      { fixedDocId: accountId },
    );
  }

  /**
   * Removes a categoryId's entry from the current plan. No-op if the plan is
   * missing or the id was not budgeted. Called after a category delete so its
   * limit doesn't linger as a phantom card. Returns the updated plan (or null).
   */
  async removeCategoryFromPlan(categoryId: string): Promise<BudgetPlan | null> {
    const plan = await this.getBudgetPlan();
    if (!plan) return null;
    if (!(categoryId in plan.categoryBudgets)) return plan;
    const categoryBudgets = { ...plan.categoryBudgets };
    delete categoryBudgets[categoryId];
    return this.upsertBudgetPlan({
      accountId: plan.accountId,
      monthlyBudget: plan.monthlyBudget,
      categoryBudgets,
    });
  }

  /** Sync-queue handler: applies a queued offline plan create to Firestore. */
  async applyPendingBudgetPlanCreate(docId: string, data: Record<string, unknown>): Promise<void> {
    const uid = this.requireUid();
    const ref = doc(this.firestore, BUDGET_PLANS_COLLECTION, docId);
    await setDoc(ref, {
      ownerId: (data['ownerId'] as string) ?? uid,
      accountId: data['accountId'],
      monthlyBudget: Number(data['monthlyBudget'] ?? 0),
      categoryBudgets: this.sanitizeCategoryBudgets(
        data['categoryBudgets'] as Record<string, number> | undefined,
      ),
      date: data['date'],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const plan = await this.fetchBudgetPlanDirect(docId, uid);
    if (plan) await this.idbCache.put(BUDGET_PLANS_STORE, { ...plan, _pendingSync: false });
  }

  /** Sync-queue handler: applies a queued offline plan update to Firestore. */
  async applyPendingBudgetPlanUpdate(docId: string, patch: Record<string, unknown>): Promise<void> {
    const ref = doc(this.firestore, BUDGET_PLANS_COLLECTION, docId);
    await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  }

  private async fetchBudgetPlanDirect(accountId: string, uid: string): Promise<BudgetPlan | null> {
    const snap = await getDoc(doc(this.firestore, `${BUDGET_PLANS_COLLECTION}/${accountId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapBudgetPlan(snap.id, data);
  }

  private async migrateLegacyBudgetsToPlan(accountId: string): Promise<BudgetPlan | null> {
    const legacy = await this.getBudgets().catch(() => [] as Budget[]);
    if (!legacy.length) return null;

    let monthlyBudget = 0;
    const categoryBudgets: Record<string, number> = {};
    for (const b of legacy) {
      const lim = Number(b.limit ?? 0);
      if (!Number.isFinite(lim) || lim <= 0) continue;
      monthlyBudget += lim;
      const cid = b.categoryId?.trim();
      if (cid) categoryBudgets[cid] = (categoryBudgets[cid] ?? 0) + lim;
    }
    if (monthlyBudget <= 0) return null;
    return this.upsertBudgetPlan({ accountId, monthlyBudget, categoryBudgets });
  }

  private sanitizeCategoryBudgets(
    raw: Record<string, number> | undefined,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  }

  private mapBudgetPlan(id: string, data: Record<string, unknown>): BudgetPlan {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    const created = createdAt?.toDate?.() ?? null;
    return {
      id,
      ownerId: (data['ownerId'] as string) ?? '',
      accountId: (data['accountId'] as string) ?? '',
      monthlyBudget: Number(data['monthlyBudget'] ?? 0),
      categoryBudgets: this.sanitizeCategoryBudgets(
        data['categoryBudgets'] as Record<string, number> | undefined,
      ),
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
      date: docCalendarDate(data, created),
    };
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
