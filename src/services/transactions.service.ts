import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import {
  TransactionCreateInput,
  TransactionRecord,
  TransactionUpdateInput,
} from '../shared/models/transaction.model';

const TRANSACTIONS_COLLECTION = 'transactions';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  async createTransaction(data: TransactionCreateInput, userId?: string): Promise<TransactionRecord> {
    const uid = userId ?? this.requireUid();
    const ref = await addDoc(collection(this.firestore, TRANSACTIONS_COLLECTION), {
      ownerId: uid,
      accountId: data.accountId,
      amount: Number(data.amount),
      description: data.description.trim(),
      category: data.category.trim(),
      type: data.type,
      status: data.status ?? 'posted',
      ...(data.source !== undefined ? { source: data.source.trim() } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const row = await this.getTransaction(ref.id);
    if (!row) {
      throw new Error('Failed to read transaction after creation.');
    }
    return row;
  }

  async updateTransaction(transactionId: string, patch: TransactionUpdateInput): Promise<void> {
    const uid = this.requireUid();
    const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
    const existing = await getDoc(transactionRef);
    if (!existing.exists() || existing.data()['ownerId'] !== uid) {
      throw new Error('Transaction not found or access denied.');
    }

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.accountId !== undefined) updates['accountId'] = patch.accountId;
    if (patch.amount !== undefined) updates['amount'] = Number(patch.amount);
    if (patch.description !== undefined) updates['description'] = patch.description.trim();
    if (patch.category !== undefined) updates['category'] = patch.category.trim();
    if (patch.type !== undefined) updates['type'] = patch.type;
    if (patch.status !== undefined) updates['status'] = patch.status;
    if (patch.source !== undefined) updates['source'] = patch.source.trim();
    await updateDoc(transactionRef, updates);
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    const uid = this.requireUid();
    const transactionRef = doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`);
    const existing = await getDoc(transactionRef);
    if (!existing.exists() || existing.data()['ownerId'] !== uid) {
      throw new Error('Transaction not found or access denied.');
    }
    await deleteDoc(transactionRef);
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    const uid = this.requireUid();
    const snap = await getDoc(doc(this.firestore, `${TRANSACTIONS_COLLECTION}/${transactionId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data['ownerId'] !== uid) return null;
    return this.mapTransaction(snap.id, data);
  }

  /** All transactions for the current user (unsorted; use account filter when possible). */
  async getTransactions(): Promise<TransactionRecord[]> {
    const uid = this.requireUid();
    const snap = await getDocs(
      query(collection(this.firestore, TRANSACTIONS_COLLECTION), where('ownerId', '==', uid)),
    );
    return this.sortByCreatedAtDesc(snap.docs.map((d) => this.mapTransaction(d.id, d.data())));
  }

  /** Transactions for one account (`accountId` on each doc). */
  async getTransactionsByAccount(accountId: string): Promise<TransactionRecord[]> {
    const uid = this.requireUid();
    const snap = await getDocs(
      query(
        collection(this.firestore, TRANSACTIONS_COLLECTION),
        where('ownerId', '==', uid),
        where('accountId', '==', accountId),
      ),
    );
    return this.sortByCreatedAtDesc(snap.docs.map((d) => this.mapTransaction(d.id, d.data())));
  }

  async getRecentTransactions(limitHint = 50): Promise<TransactionRecord[]> {
    const all = await this.getTransactions();
    return all.slice(0, limitHint);
  }

  private sortByCreatedAtDesc(rows: TransactionRecord[]): TransactionRecord[] {
    return [...rows].sort((a, b) => {
      const ta = a.createdAt?.getTime() ?? 0;
      const tb = b.createdAt?.getTime() ?? 0;
      return tb - ta;
    });
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('You must be signed in to manage transactions.');
    return uid;
  }

  private mapTransaction(id: string, data: Record<string, unknown>): TransactionRecord {
    const createdAt = data['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = data['updatedAt'] as { toDate?: () => Date } | null | undefined;
    return {
      id,
      ownerId: (data['ownerId'] as string) ?? '',
      accountId: (data['accountId'] as string) ?? '',
      amount: Number(data['amount'] ?? 0),
      description: (data['description'] as string) ?? '',
      category: (data['category'] as string) ?? '',
      type: (data['type'] as string) ?? '',
      status: (data['status'] as string) ?? '',
      source: data['source'] as string | undefined,
      createdAt: createdAt?.toDate?.() ?? null,
      updatedAt: updatedAt?.toDate?.() ?? null,
    };
  }
}
