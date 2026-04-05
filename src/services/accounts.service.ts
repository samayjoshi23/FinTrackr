import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { increment } from 'firebase/firestore';
import { UserProfile } from 'firebase/auth';
import { Account, AccountCreateInput, AccountUpdateInput } from '../shared/models/account.model';
import { Router } from '@angular/router';
import { NotifierService } from '../shared/components/notifier/notifier.service';
import { OfflineCrudService } from '../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../core/offline/indexed-db-cache.service';
import { NetworkService } from '../core/offline/network.service';

const ACCOUNTS_COLLECTION = 'accounts';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);

  private accountDocRef(userId: string) {
    return doc(this.firestore, `${ACCOUNTS_COLLECTION}/${userId}`);
  }

  /** Upsert a single account doc for the current user. Returns the account document. */
  async createAccount(data: AccountCreateInput, userId?: string): Promise<Account> {
    const uid = userId ?? this.requireUid();
    return this.offlineCrud.create<Account>(
      'accounts',
      'id',
      async () => {
        const ref = this.accountDocRef(uid);
        const existing = await getDoc(ref);
        const payload: Record<string, unknown> = {
          uid,
          name: data.name.trim(),
          balance: Number(data.balance),
          currency: data.currency,
          isSelected: data.isSelected,
          isActive: data.isActive,
          members: data.members,
          ownerId: data.ownerId,
          updatedAt: serverTimestamp(),
        };
        if (!existing.exists()) {
          payload['createdAt'] = serverTimestamp();
        }
        await setDoc(ref, payload, { merge: true });
        const account = await this.getAccountDirect(uid);
        if (!account) {
          throw new Error('Failed to read account after creation.');
        }
        return account;
      },
      {
        uid,
        name: data.name.trim(),
        balance: Number(data.balance),
        currency: data.currency,
        isSelected: data.isSelected,
        isActive: data.isActive,
        members: data.members,
        ownerId: data.ownerId,
      },
    );
  }

  /**
   * Atomically adjusts `balance` on `accounts/{accountDocId}` for a posted transaction.
   * Income increases balance; expense decreases. Returns the new balance after the write.
   * When offline, applies the change optimistically to the local cache.
   */
  async adjustBalanceForTransaction(
    accountDocId: string,
    amount: number,
    type: 'income' | 'expense',
  ): Promise<number> {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('Invalid transaction amount.');
    }
    const delta = type === 'income' ? amt : -amt;

    if (this.network.isOnline()) {
      try {
        const ref = this.accountDocRef(accountDocId);
        await updateDoc(ref, {
          balance: increment(delta),
          updatedAt: serverTimestamp(),
        });
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          throw new Error('Account not found after balance update.');
        }
        const newBalance = Number(snap.data()['balance'] ?? 0);
        // Update cache with authoritative balance
        const cached = await this.cache.getByKey<Account>('accounts', accountDocId);
        if (cached) {
          cached.balance = newBalance;
          cached.updatedAt = new Date();
          await this.cache.put('accounts', cached);
        }
        return newBalance;
      } catch {
        // Fall through to offline handling
      }
    }

    // Offline: apply optimistic balance change
    const cached = await this.cache.getByKey<Account>('accounts', accountDocId);
    if (cached) {
      cached.balance = (cached.balance ?? 0) + delta;
      cached.updatedAt = new Date();
      cached._pendingSync = true;
      await this.cache.put('accounts', cached);
      // Also update localStorage
      const currentRaw = localStorage.getItem('currentAccount');
      if (currentRaw) {
        const current = JSON.parse(currentRaw) as Account;
        if (current.id === accountDocId) {
          current.balance = cached.balance;
          localStorage.setItem('currentAccount', JSON.stringify(current));
        }
      }
      return cached.balance;
    }
    throw new Error('Account not found in cache.');
  }

  /** Patch fields on `accounts/{accountId}` (only keys present in `patch` are written). */
  async updateAccount(accountId: string, patch: AccountUpdateInput): Promise<void> {
    const cached = await this.cache.getByKey<Account>('accounts', accountId);

    const patchRecord: Record<string, unknown> = {};
    if (patch.name !== undefined) patchRecord['name'] = patch.name.trim();
    if (patch.balance !== undefined) patchRecord['balance'] = Number(patch.balance);
    if (patch.currency !== undefined) patchRecord['currency'] = patch.currency;
    if (patch.isSelected !== undefined) patchRecord['isSelected'] = patch.isSelected;
    if (patch.isActive !== undefined) patchRecord['isActive'] = patch.isActive;
    if (patch.members !== undefined) patchRecord['members'] = patch.members;

    await this.offlineCrud.update<Account>(
      'accounts',
      accountId,
      async () => {
        const ref = this.accountDocRef(accountId);
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await setDoc(ref, updates, { merge: true });
      },
      patchRecord,
      (cached ?? { id: accountId }) as unknown as Record<string, unknown>,
    );
  }

  /** Get the account doc by user id (defaults to current user). */
  async getAccount(userId?: string): Promise<Account | null> {
    const uid = userId ?? this.requireUid();
    return this.offlineCrud.fetchOne<Account>(
      'accounts',
      uid,
      async () => this.getAccountDirect(uid),
    );
  }

  /** For now, this returns a single-element list because we store one account per uid. */
  async getAccounts(userId?: string): Promise<Account[]> {
    const uid = userId ?? this.requireUid();
    return this.offlineCrud.fetchAll<Account>(
      'accounts',
      async () => {
        const accountsSnap = await getDocs(
          query(collection(this.firestore, 'accounts'), where('ownerId', '==', uid)),
        );
        return accountsSnap.docs.map((docSnap) => this.mapAccount(docSnap.id, docSnap.data()));
      },
      { indexName: 'ownerId', value: uid },
    );
  }

  /**
   * Marks one account selected in Firestore (`isSelected`) and caches it in localStorage.
   * Pass `accountId` as the Firestore document id (`Account.id`). Omit to resolve from flags/first.
   */
  async selectAccount(accountId?: string | null): Promise<Account | null> {
    const accounts = await this.getAccounts();
    if (accounts.length === 0) {
      this.notifier.error('No accounts found. Please setup your accounts first');
      await this.router.navigateByUrl('/onboarding');
      return null;
    }

    let selected: Account | undefined;
    if (accountId) {
      selected = accounts.find((a) => a.id === accountId || a.uid === accountId);
      if (!selected) {
        this.notifier.error('Account not found.');
        return null;
      }
    } else {
      selected = accounts.find((a) => a.isSelected) ?? accounts[0];
    }

    const selectedDocId = selected.id;

    await Promise.all(
      accounts.map((account) =>
        this.updateAccount(account.id, {
          isSelected: account.id === selectedDocId,
        }),
      ),
    );

    const refreshed = await this.getAccount(selectedDocId);
    if (!refreshed) {
      this.notifier.error('Could not load the selected account.');
      return null;
    }

    refreshed.isSelected = true;
    localStorage.setItem('currentAccount', JSON.stringify(refreshed));
    return refreshed;
  }

  async deleteAccount(accountDocId: string): Promise<void> {
    const uid = this.requireUid();

    const all = await this.getAccounts();
    if (all.length <= 1) {
      throw new Error('You must keep at least one account.');
    }

    await this.offlineCrud.remove(
      'accounts',
      accountDocId,
      async () => {
        const ref = this.accountDocRef(accountDocId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          throw new Error('Account not found.');
        }
        if ((snap.data()['ownerId'] as string | undefined) !== uid) {
          throw new Error('Not allowed to remove this account.');
        }
        await deleteDoc(ref);
      },
    );

    const currentRaw = localStorage.getItem('currentAccount');
    const current = currentRaw ? (JSON.parse(currentRaw) as Account) : null;
    if (current?.id === accountDocId) {
      localStorage.removeItem('currentAccount');
    }

    await this.selectAccount(null);
  }

  // --- User profile (existing helper; kept for onboarding) ---

  async updateUserProfile(userId: string, userProfile: UserProfile) {
    const userProfileRef = doc(this.firestore, `users/${userId}`);
    await setDoc(
      userProfileRef,
      {
        ...userProfile,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  /** Direct Firestore read bypassing offline layer (used internally after create). */
  private async getAccountDirect(userId: string): Promise<Account | null> {
    const snap = await getDoc(this.accountDocRef(userId));
    if (!snap.exists()) return null;
    return this.mapAccount(userId, snap.data());
  }

  private requireUid(): string {
    const userProfile = JSON.parse(
      localStorage.getItem('userProfile') ?? 'null',
    ) as UserProfile | null;
    if (!userProfile) {
      throw new Error('You must be signed in to manage accounts.');
    }
    return userProfile['uid'] as string;
  }

  private mapAccount(id: string, data: unknown): Account {
    const d = data as Record<string, unknown>;
    const createdAt = d['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = d['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      id,
      uid: (d['uid'] as string) ?? id,
      name: (d['name'] as string) ?? '',
      balance: Number(d['balance'] ?? 0),
      currency: (d['currency'] as string) ?? '',
      isSelected: d['isSelected'] as boolean | undefined,
      isActive: d['isActive'] as boolean | undefined,
      members: (d['members'] as string[] | undefined) ?? undefined,
      ownerId: (d['ownerId'] as string | undefined) ?? undefined,
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
