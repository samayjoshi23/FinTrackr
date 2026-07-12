import { SyncQueueEntry } from './sync-queue.model';

/**
 * A queue entry that stands in for one or more original entries.
 * `sourceIds` lists every original entry id it absorbed — the sync loop marks
 * them all in-progress before processing and dequeues them all on success, so
 * a crash mid-sync loses nothing (the originals stay in IndexedDB untouched).
 */
export interface ConsolidatedEntry extends SyncQueueEntry {
  sourceIds: string[];
}

/**
 * Collapses redundant offline operations before flushing to Firestore.
 * N edits of the same document while offline currently replay as N sequential
 * writes; since replay is last-writer-wins per field, merging them produces the
 * identical final server state with one write.
 *
 * Rules (input must be timestamp-sorted, which `getAllPending` guarantees):
 *   - create + update(s)  → one create with the updates shallow-merged in
 *     (later wins per field, `_syncPreassignedId` preserved).
 *   - update + update(s)  → one update, payloads shallow-merged later-wins.
 *   - update(s) + delete  → just the delete (with the delete's own payload,
 *     e.g. `_groupId` for subcollection path reconstruction).
 *   - create + … + delete → the whole chain is dropped (doc never existed
 *     server-side) — UNLESS any entry in the chain carries `postSyncCallables`,
 *     in which case the chain is left as-is (side effects must not be skipped).
 *
 * Entries for different documents are never merged; output preserves each
 * group's earliest timestamp order so cross-store dependencies (account created
 * before its transactions) still sync in the right sequence.
 */
export function consolidateQueue(pending: SyncQueueEntry[]): ConsolidatedEntry[] {
  const groups = new Map<string, SyncQueueEntry[]>();
  const order: string[] = [];

  for (const entry of pending) {
    const docKey = entry.docId ?? entry.tempLocalId;
    // No document identity → can't safely merge; isolate under a unique key.
    const key = docKey ? `${entry.storeName}::${docKey}` : `~solo::${entry.id}`;
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
      order.push(key);
    }
  }

  const result: ConsolidatedEntry[] = [];
  for (const key of order) {
    result.push(...consolidateGroup(groups.get(key)!));
  }
  // Stable-sort by each survivor's (earliest) timestamp to preserve global order.
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

function consolidateGroup(entries: SyncQueueEntry[]): ConsolidatedEntry[] {
  if (entries.length === 1) {
    return [asConsolidated(entries[0])];
  }

  const hasCreate = entries[0].operation === 'create';
  const deleteEntry = entries.find((e) => e.operation === 'delete');

  // create + … + delete → net no-op, unless side effects are attached.
  if (hasCreate && deleteEntry) {
    const hasCallables = entries.some((e) => e.postSyncCallables?.length);
    if (hasCallables) {
      return entries.map(asConsolidated); // replay untouched — side effects must run
    }
    return []; // never existed server-side; drop entirely
  }

  // update(s) + delete → only the delete matters.
  if (deleteEntry) {
    return [
      {
        ...deleteEntry,
        sourceIds: entries.map((e) => e.id),
        postSyncCallables: mergeCallables(entries),
      },
    ];
  }

  // create+updates or updates-only → merge payloads into the first entry.
  const base = entries[0];
  const mergedPayload: Record<string, unknown> = { ...base.payload };
  for (let i = 1; i < entries.length; i++) {
    Object.assign(mergedPayload, entries[i].payload);
  }
  // The create's preassigned id must survive later update payloads (which lack it).
  if (typeof base.payload['_syncPreassignedId'] === 'string') {
    mergedPayload['_syncPreassignedId'] = base.payload['_syncPreassignedId'];
  }

  return [
    {
      ...base,
      payload: mergedPayload,
      sourceIds: entries.map((e) => e.id),
      postSyncCallables: mergeCallables(entries),
    },
  ];
}

function mergeCallables(entries: SyncQueueEntry[]): SyncQueueEntry['postSyncCallables'] {
  const merged = entries.flatMap((e) => e.postSyncCallables ?? []);
  return merged.length ? merged : undefined;
}

function asConsolidated(entry: SyncQueueEntry): ConsolidatedEntry {
  return { ...entry, sourceIds: [entry.id] };
}
