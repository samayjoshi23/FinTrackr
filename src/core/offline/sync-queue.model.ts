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
}
