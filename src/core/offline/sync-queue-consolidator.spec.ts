import { consolidateQueue } from './sync-queue-consolidator';
import { SyncQueueEntry } from './sync-queue.model';

let seq = 0;
function entry(partial: Partial<SyncQueueEntry>): SyncQueueEntry {
  seq++;
  return {
    id: partial.id ?? `id-${seq}`,
    storeName: 'transactions',
    operation: 'update',
    payload: {},
    timestamp: seq,
    status: 'pending',
    retryCount: 0,
    ...partial,
  };
}

describe('consolidateQueue', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('passes single entries through with their own id as source', () => {
    const e = entry({ operation: 'create', tempLocalId: 'a' });
    const out = consolidateQueue([e]);
    expect(out.length).toBe(1);
    expect(out[0].sourceIds).toEqual([e.id]);
    expect(out[0].payload).toEqual(e.payload);
  });

  it('merges multiple updates of the same doc, later fields win', () => {
    const e1 = entry({ docId: 'doc1', payload: { amount: 10, note: 'first' } });
    const e2 = entry({ docId: 'doc1', payload: { amount: 20 } });
    const e3 = entry({ docId: 'doc1', payload: { category: 'food' } });
    const out = consolidateQueue([e1, e2, e3]);
    expect(out.length).toBe(1);
    expect(out[0].operation).toBe('update');
    expect(out[0].payload).toEqual({ amount: 20, note: 'first', category: 'food' });
    expect(out[0].sourceIds).toEqual([e1.id, e2.id, e3.id]);
    expect(out[0].timestamp).toBe(e1.timestamp);
  });

  it('folds updates into a preceding create and keeps _syncPreassignedId', () => {
    const e1 = entry({
      operation: 'create',
      tempLocalId: 'pre-1',
      payload: { _syncPreassignedId: 'pre-1', amount: 10, name: 'x' },
    });
    const e2 = entry({ docId: 'pre-1', payload: { amount: 99 } });
    const out = consolidateQueue([e1, e2]);
    expect(out.length).toBe(1);
    expect(out[0].operation).toBe('create');
    expect(out[0].payload).toEqual({ _syncPreassignedId: 'pre-1', amount: 99, name: 'x' });
    expect(out[0].sourceIds).toEqual([e1.id, e2.id]);
  });

  it('keeps only the delete when updates precede it (delete payload wins)', () => {
    const e1 = entry({ docId: 'doc1', payload: { amount: 5 } });
    const e2 = entry({ operation: 'delete', docId: 'doc1', payload: { _groupId: 'g1' } });
    const out = consolidateQueue([e1, e2]);
    expect(out.length).toBe(1);
    expect(out[0].operation).toBe('delete');
    expect(out[0].payload).toEqual({ _groupId: 'g1' });
    expect(out[0].sourceIds).toEqual([e1.id, e2.id]);
  });

  it('drops a create→update→delete chain entirely when no callables attached', () => {
    const e1 = entry({ operation: 'create', tempLocalId: 'pre-1', payload: { a: 1 } });
    const e2 = entry({ docId: 'pre-1', payload: { a: 2 } });
    const e3 = entry({ operation: 'delete', docId: 'pre-1' });
    expect(consolidateQueue([e1, e2, e3])).toEqual([]);
  });

  it('leaves a create→delete chain untouched when a callable is attached', () => {
    const e1 = entry({
      operation: 'create',
      tempLocalId: 'pre-1',
      postSyncCallables: [{ name: 'notifyMembers', payload: {} }],
    });
    const e2 = entry({ operation: 'delete', docId: 'pre-1' });
    const out = consolidateQueue([e1, e2]);
    expect(out.length).toBe(2);
    expect(out.map((e) => e.operation)).toEqual(['create', 'delete']);
    expect(out[0].sourceIds).toEqual([e1.id]);
    expect(out[1].sourceIds).toEqual([e2.id]);
  });

  it('concatenates postSyncCallables across merged entries in order', () => {
    const e1 = entry({
      operation: 'create',
      tempLocalId: 'pre-1',
      payload: { _syncPreassignedId: 'pre-1' },
      postSyncCallables: [{ name: 'first', payload: {} }],
    });
    const e2 = entry({
      docId: 'pre-1',
      postSyncCallables: [{ name: 'second', payload: {} }],
    });
    const out = consolidateQueue([e1, e2]);
    expect(out.length).toBe(1);
    expect(out[0].postSyncCallables?.map((c) => c.name)).toEqual(['first', 'second']);
  });

  it('never merges entries of different docs or stores and preserves timestamp order', () => {
    const e1 = entry({ storeName: 'accounts', docId: 'acc1', payload: { balance: 1 } });
    const e2 = entry({ storeName: 'transactions', docId: 'tx1', payload: { amount: 2 } });
    const e3 = entry({ storeName: 'accounts', docId: 'acc1', payload: { balance: 3 } });
    const out = consolidateQueue([e1, e2, e3]);
    expect(out.length).toBe(2);
    expect(out[0].storeName).toBe('accounts');
    expect(out[0].payload).toEqual({ balance: 3 });
    expect(out[1].storeName).toBe('transactions');
  });

  it('isolates entries with no document identity (never merged)', () => {
    const e1 = entry({ docId: undefined, tempLocalId: undefined, payload: { a: 1 } });
    const e2 = entry({ docId: undefined, tempLocalId: undefined, payload: { a: 2 } });
    const out = consolidateQueue([e1, e2]);
    expect(out.length).toBe(2);
  });
});
