import { Injectable, inject } from '@angular/core';
import {
  collection,
  DocumentData,
  Firestore,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  Timestamp,
  where,
} from '@angular/fire/firestore';

const TRANSACTIONS_COLLECTION = 'transactions';

/** A server transaction doc, decoupled from the Firestore SDK types. */
export interface RemoteTxDoc {
  id: string;
  data: Record<string, unknown>;
  /** Local write not yet acknowledged by the server. */
  hasPendingWrites: boolean;
}

export interface RemoteTxChange {
  type: 'added' | 'modified' | 'removed';
  doc: RemoteTxDoc;
}

/**
 * Every Firestore query the transaction delta sync issues, in one place. Kept separate
 * from {@link TransactionSyncService} so the sync rules can be unit-tested with a fake.
 *
 * Index requirements (see `firestore.indexes.json`):
 *   - `accountId ASC, createdAt DESC` — window / older pages
 *   - `accountId ASC, updatedAt ASC`  — deltas + live listener
 *   - `accountId ASC, deletedAt ASC`  — tombstone count
 */
@Injectable({ providedIn: 'root' })
export class TransactionRemote {
  private readonly firestore = inject(Firestore);

  private get col() {
    return collection(this.firestore, TRANSACTIONS_COLLECTION);
  }

  /** Docs created on/after `from`, newest first. */
  async createdSince(accountKey: string, from: Timestamp): Promise<RemoteTxDoc[]> {
    const snap = await getDocs(
      query(
        this.col,
        where('accountId', '==', accountKey),
        where('createdAt', '>=', from),
        orderBy('createdAt', 'desc'),
      ),
    );
    return snap.docs.map(toRemote);
  }

  /** Up to `size` docs created strictly before `before`, newest first. */
  async createdBefore(accountKey: string, before: Timestamp, size: number): Promise<RemoteTxDoc[]> {
    const snap = await getDocs(
      query(
        this.col,
        where('accountId', '==', accountKey),
        where('createdAt', '<', before),
        orderBy('createdAt', 'desc'),
        limit(size),
      ),
    );
    return snap.docs.map(toRemote);
  }

  /** Every doc of the account — only used when the composite index is missing. */
  async allForAccount(accountKey: string): Promise<RemoteTxDoc[]> {
    const snap = await getDocs(query(this.col, where('accountId', '==', accountKey)));
    return snap.docs.map(toRemote);
  }

  /** Docs whose `updatedAt` is strictly after `cursor`. */
  async updatedAfter(accountKey: string, cursor: Timestamp): Promise<RemoteTxDoc[]> {
    const snap = await getDocs(this.updatedAfterQuery(accountKey, cursor));
    return snap.docs.map(toRemote);
  }

  /** Live version of {@link updatedAfter}. Returns the unsubscribe function. */
  listenUpdatedAfter(
    accountKey: string,
    cursor: Timestamp,
    onChanges: (changes: RemoteTxChange[], fromCache: boolean) => void,
    onError: (e: unknown) => void,
  ): () => void {
    return onSnapshot(
      this.updatedAfterQuery(accountKey, cursor),
      (snap) =>
        onChanges(
          snap.docChanges().map((c) => ({ type: c.type, doc: toRemote(c.doc) })),
          snap.metadata.fromCache,
        ),
      onError,
    );
  }

  /** Live (non-deleted) doc count via aggregation queries (~1 read per 1,000 docs each). */
  async countLive(accountKey: string): Promise<number> {
    const [all, deleted] = await Promise.all([
      getCountFromServer(query(this.col, where('accountId', '==', accountKey))),
      getCountFromServer(
        query(this.col, where('accountId', '==', accountKey), where('deletedAt', '!=', null)),
      ),
    ]);
    return all.data().count - deleted.data().count;
  }

  private updatedAfterQuery(accountKey: string, cursor: Timestamp) {
    return query(
      this.col,
      where('accountId', '==', accountKey),
      where('updatedAt', '>', cursor),
      orderBy('updatedAt', 'asc'),
    );
  }
}

function toRemote(d: QueryDocumentSnapshot<DocumentData>): RemoteTxDoc {
  return { id: d.id, data: d.data(), hasPendingWrites: d.metadata.hasPendingWrites };
}
