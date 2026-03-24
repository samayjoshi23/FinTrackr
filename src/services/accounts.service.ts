import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
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
import { UserProfile } from 'firebase/auth';
import { Account, AccountCreateInput, AccountUpdateInput } from '../shared/models/account.model';

const ACCOUNTS_COLLECTION = 'accounts';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private accountDocRef(userId: string) {
    return doc(this.firestore, `${ACCOUNTS_COLLECTION}/${userId}`);
  }

  /** Upsert a single account doc for the current user. Returns the account document. */
  async createAccount(data: AccountCreateInput, userId?: string): Promise<Account> {
    const uid = userId ?? this.requireUid();
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

    // Only set createdAt on first write.
    if (!existing.exists()) {
      payload['createdAt'] = serverTimestamp();
    }

    await setDoc(ref, payload, { merge: true });

    const account = await this.getAccount(uid);
    if (!account) {
      throw new Error('Failed to read account after creation.');
    }
    return account;
  }

  /** Update the account doc for the given user (defaults to current user). */
  async updateAccount(
    accountId: string,
    patch: AccountUpdateInput,
    userId?: string,
  ): Promise<void> {
    const ref = this.accountDocRef(accountId);

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
      name: patch.name?.trim(),
      balance: Number(patch.balance),
      currency: patch.currency,
      isSelected: patch.isSelected,
      isActive: patch.isActive,
      members: patch.members,
    };

    await setDoc(ref, updates, { merge: true });
  }

  /** Get the account doc by user id (defaults to current user). */
  async getAccount(userId?: string): Promise<Account | null> {
    const uid = userId ?? this.requireUid();
    const snap = await getDoc(this.accountDocRef(uid));
    if (!snap.exists()) {
      return null;
    }

    return this.mapAccount(uid, snap.data());
  }

  /** For now, this returns a single-element list because we store one account per uid. */
  async getAccounts(userId?: string): Promise<Account[]> {
    // Fetch all accounts where ownerId == userId
    const uid = userId ?? this.requireUid();
    const accountsSnap = await getDocs(
      query(collection(this.firestore, 'accounts'), where('ownerId', '==', uid)),
    );
    return accountsSnap.docs.map((docSnap) => this.mapAccount(docSnap.id, docSnap.data()));
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
    const doc = data as Record<string, unknown>;
    const createdAt = doc['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = doc['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      id,
      uid: (doc['uid'] as string) ?? id,
      name: (doc['name'] as string) ?? '',
      balance: Number(doc['balance'] ?? 0),
      currency: (doc['currency'] as string) ?? '',
      isSelected: doc['isSelected'] as boolean | undefined,
      isActive: doc['isActive'] as boolean | undefined,
      members: (doc['members'] as string[] | undefined) ?? undefined,
      ownerId: (doc['ownerId'] as string | undefined) ?? undefined,
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
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
}
