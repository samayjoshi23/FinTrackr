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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import {
  Category,
  CategoryCreateInput,
  CategoryUpdateInput,
  DEFAULT_CATEGORIES,
} from './types';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import { SyncQueueService } from '../../core/offline/sync-queue.service';
import {
  REVALIDATION_TTL_MS,
  RevalidationTrackerService,
} from '../../core/offline/revalidation-tracker.service';
import { AccountsService } from '../accounts/accounts.service';
import { BudgetsService } from '../budgets/budgets.service';
import { date, docCalendarDate } from '../../core/date';

const CATEGORIES_COLLECTION = 'categories';

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);
  private readonly syncQueue = inject(SyncQueueService);
  private readonly tracker = inject(RevalidationTrackerService);
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);

  /**
   * Session memo of the base category rows per account (WITHOUT the synthetic
   * "Other" row, which is appended fresh on every return). `getCategories()` has
   * 13+ call sites across pages; without this each one re-reads IndexedDB and can
   * trigger a background Firestore query. Invalidated on every category mutation.
   */
  private categoriesMemo: { accountId: string; rows: Category[]; at: number } | null = null;

  /** Drop the in-memory categories memo (mutations + logout). */
  clearSessionCache(): void {
    this.categoriesMemo = null;
  }

  private async selectedAccountKey(): Promise<string | null> {
    const a = await this.accountsService.getSelectedAccount();
    return a?.uid ?? a?.id ?? null;
  }

  private async requireSelectedAccountKey(): Promise<string> {
    const id = await this.selectedAccountKey();
    if (!id) throw new Error('No account selected.');
    return id;
  }

  async getCategories(): Promise<Category[]> {
    const uid = this.requireUid();
    const accountId = await this.selectedAccountKey();
    if (!accountId) return [];

    const memo = this.categoriesMemo;
    if (
      memo &&
      memo.accountId === accountId &&
      Date.now() - memo.at < REVALIDATION_TTL_MS['categories']
    ) {
      return [...memo.rows, this.syntheticOtherCategory(accountId)];
    }

    const rows = await this.offlineCrud.fetchAll<Category>(
      'categories',
      async () => {
        const base = collection(this.firestore, CATEGORIES_COLLECTION);
        const constraints = [where('ownerId', '==', uid), where('accountId', '==', accountId)];
        const snap = await getDocs(query(base, ...constraints));
        return snap.docs.map((d) => this.mapCategory(d.id, d.data()));
      },
      { indexName: 'accountId', value: accountId },
    );
    this.categoriesMemo = { accountId, rows: [...rows], at: Date.now() };

    return [...rows, this.syntheticOtherCategory(accountId)];
  }

  /** Fallback bucket for uncategorized transactions — appended per call, never cached. */
  private syntheticOtherCategory(accountId: string): Category {
    return {
      uid: 'default',
      name: 'Other',
      description: 'Uncategorized transactions',
      icon: 'other',
      accountId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getCategory(categoryId: string): Promise<Category | null> {
    return this.offlineCrud.fetchOne<Category>('categories', categoryId, async () => {
      const uid = this.requireUid();
      const snap = await getDoc(doc(this.firestore, `${CATEGORIES_COLLECTION}/${categoryId}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      if (data['ownerId'] !== uid) return null;
      return this.mapCategory(snap.id, data);
    });
  }

  async createCategory(data: CategoryCreateInput, userId?: string): Promise<Category> {
    const uid = userId ?? this.requireUid();
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    this.clearSessionCache();
    return this.offlineCrud.create<Category>(
      'categories',
      'uid',
      async (assignedId: string) => {
        const ref = doc(this.firestore, CATEGORIES_COLLECTION, assignedId);
        await setDoc(ref, {
          ownerId: uid,
          accountId,
          name: data.name.trim(),
          description: (data.description ?? '').trim(),
          icon: (data.icon ?? 'tags').trim() || 'tags',
          date: day,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const category = await this.getCategoryDirect(assignedId, uid);
        if (!category) {
          throw new Error('Failed to read category after creation.');
        }
        return category;
      },
      {
        ownerId: uid,
        accountId,
        name: data.name.trim(),
        description: (data.description ?? '').trim(),
        icon: (data.icon ?? 'tags').trim() || 'tags',
        date: day,
      },
    );
  }

  async applyPendingCategoryCreate(docId: string, data: CategoryCreateInput): Promise<void> {
    const uid = this.requireUid();
    const accountId = data.accountId ?? (await this.requireSelectedAccountKey());
    const day = date().format('YYYY-MM-DD');
    const ref = doc(this.firestore, CATEGORIES_COLLECTION, docId);
    await setDoc(ref, {
      ownerId: uid,
      accountId,
      name: data.name.trim(),
      description: (data.description ?? '').trim(),
      icon: (data.icon ?? 'tags').trim() || 'tags',
      date: day,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const category = await this.getCategoryDirect(docId, uid);
    if (!category) throw new Error('Failed to read category after pending create sync.');
    await this.idbCache.put('categories', { ...category, _pendingSync: false });
    this.clearSessionCache();
  }

  async updateCategory(categoryId: string, patch: CategoryUpdateInput): Promise<void> {
    const uid = this.requireUid();
    const cached = await this.offlineCrud.fetchOne<Category>('categories', categoryId, async () => {
      const snap = await getDoc(doc(this.firestore, `${CATEGORIES_COLLECTION}/${categoryId}`));
      if (!snap.exists()) return null;
      return this.mapCategory(snap.id, snap.data());
    });

    if (!cached) {
      throw new Error('Category not found or access denied.');
    }

    const patchRecord: Record<string, unknown> = {};
    if (patch.name !== undefined) patchRecord['name'] = patch.name.trim();
    if (patch.description !== undefined)
      patchRecord['description'] = (patch.description ?? '').trim();
    if (patch.icon !== undefined) patchRecord['icon'] = (patch.icon ?? 'tags').trim() || 'tags';

    await this.offlineCrud.update<Category>(
      'categories',
      categoryId,
      async () => {
        const categoryRef = doc(this.firestore, `${CATEGORIES_COLLECTION}/${categoryId}`);
        const existing = await getDoc(categoryRef);
        if (!existing.exists() || existing.data()['ownerId'] !== uid) {
          throw new Error('Category not found or access denied.');
        }
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await updateDoc(categoryRef, updates);
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
    this.clearSessionCache();
  }

  async deleteCategory(categoryId: string): Promise<void> {
    await this.offlineCrud.remove('categories', categoryId, async () => {
      const uid = this.requireUid();
      const categoryRef = doc(this.firestore, `${CATEGORIES_COLLECTION}/${categoryId}`);
      const existing = await getDoc(categoryRef);
      if (!existing.exists() || existing.data()['ownerId'] !== uid) {
        throw new Error('Category not found or access denied.');
      }
      await deleteDoc(categoryRef);
    });
    this.clearSessionCache();
    // Strip any budget line still pointing at this categoryId so the current
    // (and future) plan doesn't render a phantom "Category" card. Past-month
    // reports keep the entry — the freeze rule protects historical accuracy.
    await this.budgetsService.removeCategoryFromPlan(categoryId).catch((e) => {
      console.warn('Failed to clean deleted category out of the budget plan', e);
    });
  }

  /** Direct Firestore read bypassing offline layer (used internally after create). */
  private async getCategoryDirect(categoryId: string, uid: string): Promise<Category | null> {
    const snap = await getDoc(doc(this.firestore, `${CATEGORIES_COLLECTION}/${categoryId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapCategory(snap.id, data);
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage categories.');
    return uid;
  }

  private mapCategory(id: string, data: Record<string, unknown>): Category {
    const createdAt = data['createdAt'] as Timestamp | null | undefined;
    const updatedAt = data['updatedAt'] as Timestamp | null | undefined;
    const created = createdAt?.toDate?.() ?? null;
    return {
      uid: id,
      name: (data['name'] as string) ?? '',
      description: (data['description'] as string) ?? '',
      icon: (data['icon'] as string) ?? 'tags',
      accountId: (data['accountId'] as string) ?? '',
      createdAt: createdAt ?? Timestamp.now(),
      updatedAt: updatedAt ?? createdAt ?? Timestamp.now(),
      date: docCalendarDate(data, created),
    };
  }

  /**
   * Seeds many categories with ONE batched Firestore commit instead of a
   * `setDoc` + read-back per category (used by onboarding). When offline or if
   * the commit fails, each category is queued as a standard pending create —
   * the same shape `OfflineCrudService.create` enqueues — so the sync worker
   * replays them unchanged. Returns the created rows (optimistic when queued).
   */
  async seedDefaultCategoriesBatch(
    inputs: CategoryCreateInput[],
    userId?: string,
  ): Promise<Category[]> {
    if (inputs.length === 0) return [];
    const uid = userId ?? this.requireUid();
    const day = date().format('YYYY-MM-DD');
    const now = Timestamp.now();

    const prepared = inputs.map((input) => {
      const id = doc(collection(this.firestore, CATEGORIES_COLLECTION)).id;
      const payload = {
        ownerId: uid,
        accountId: input.accountId,
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        icon: (input.icon ?? 'tags').trim() || 'tags',
        date: day,
      };
      const row: Category = {
        uid: id,
        name: payload.name,
        description: payload.description,
        icon: payload.icon,
        accountId: payload.accountId,
        date: day,
        // Client timestamps; the next background revalidation replaces them
        // with the canonical serverTimestamp values.
        createdAt: now,
        updatedAt: now,
      };
      return { id, payload, row };
    });

    if (this.network.isOnline()) {
      try {
        const batch = writeBatch(this.firestore);
        for (const { id, payload } of prepared) {
          batch.set(doc(this.firestore, CATEGORIES_COLLECTION, id), {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        const rows = prepared.map((p) => ({ ...p.row, _pendingSync: false }));
        await this.idbCache.putAll('categories', rows);
        this.tracker.markStale('categories');
        this.clearSessionCache();
        return rows;
      } catch {
        /* fall through to the queued-create path */
      }
    }

    // Offline / commit failed: queue standard pending creates for the sync worker.
    for (const { id, payload } of prepared) {
      await this.syncQueue.enqueue({
        storeName: 'categories',
        operation: 'create',
        payload: { ...payload, _syncPreassignedId: id },
        tempLocalId: id,
        timestamp: Date.now(),
      });
    }
    const rows = prepared.map((p) => ({ ...p.row, _pendingSync: true }));
    await this.idbCache.putAll('categories', rows);
    this.tracker.markStale('categories');
    this.clearSessionCache();
    return rows;
  }

  async addDefaultCategories() {
    const accountId = await this.requireSelectedAccountKey();
    await this.seedDefaultCategoriesBatch(
      DEFAULT_CATEGORIES.map((category: Category) => ({
        name: category.name,
        description: category.description,
        icon: category.icon,
        accountId,
      })),
    );
  }
}
