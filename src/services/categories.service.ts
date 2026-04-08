import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  collection,
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
} from '@angular/fire/firestore';
import {
  Category,
  CategoryCreateInput,
  CategoryUpdateInput,
  DEFAULT_CATEGORIES,
} from '../features/categories/types';
import { Account } from '../shared/models/account.model';
import { OfflineCrudService } from '../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../core/offline/indexed-db-cache.service';
import { date, docCalendarDate } from '../core/date';

const CATEGORIES_COLLECTION = 'categories';

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);

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

  async getCategories(): Promise<Category[]> {
    const uid = this.requireUid();
    const accountId = this.selectedAccountKey();
    if (!accountId) return [];
    return this.offlineCrud.fetchAll<Category>(
      'categories',
      async () => {
        const base = collection(this.firestore, CATEGORIES_COLLECTION);
        const constraints = [where('ownerId', '==', uid), where('accountId', '==', accountId)];
        const snap = await getDocs(query(base, ...constraints));
        return snap.docs.map((d) => this.mapCategory(d.id, d.data()));
      },
      { indexName: 'accountId', value: accountId },
    );
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
    const accountId = data.accountId ?? this.requireSelectedAccountKey();
    const day = date().format('YYYY-MM-DD');
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
    const accountId = data.accountId ?? this.requireSelectedAccountKey();
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

  async addDefaultCategories() {
    const accountId = this.requireSelectedAccountKey();
    DEFAULT_CATEGORIES.forEach(async (category: Category) => {
      let categoryData: CategoryCreateInput = {
        name: category.name,
        description: category.description,
        icon: category.icon,
        accountId: accountId,
      };
      await this.createCategory(categoryData as CategoryCreateInput);
    });
  }
}
