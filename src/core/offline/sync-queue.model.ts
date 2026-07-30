export interface PostSyncCallable {
  name: string;
  payload: Record<string, unknown>;
}

export interface SyncQueueEntry {
  id: string;
  storeName: string;
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  tempLocalId?: string;
  docId?: string;
  timestamp: number;
  status: 'pending' | 'in-progress' | 'failed';
  retryCount: number;
  errorMessage?: string;
  /**
   * Wall-clock time (ms) of the last sync attempt for this entry. Combined with
   * `retryCount` this drives exponential backoff — an entry whose backoff window
   * hasn't elapsed is filtered out of the ready queue and skipped until its next
   * eligible retry time.
   */
  lastAttemptAt?: number;
  /** Cloud Functions callables to invoke after the Firestore write succeeds during sync. */
  postSyncCallables?: PostSyncCallable[];
}
