import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { GroupExpense } from '../../shared/models/group.model';
import { PostSyncCallable } from '../../core/offline/offline-crud.service';

export interface NotifyExpensePayload {
  groupId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByName: string;
  memberIds: string[];
}

export interface RecordSettlementPayload {
  groupId: string;
  settlementId: string;
  creditorId: string;
  debtorId: string;
  debtorName: string;
  amount: number;
  description: string;
  category: string;
  source: string;
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class GroupCloudFunctionsService {
  private readonly functions = inject(Functions);

  /** Invoke a callable by name; errors are swallowed and logged (fire-and-forget). */
  invokeFireAndForget(name: string, payload: Record<string, unknown>): void {
    try {
      const fn = httpsCallable(this.functions, name);
      void fn(payload).catch((e) => console.error(`Callable '${name}' failed:`, e));
    } catch (e) {
      console.error(`Failed to invoke callable '${name}':`, e);
    }
  }

  /** Await invocation — throws on failure (used by SyncService post-sync execution). */
  async invoke(name: string, payload: Record<string, unknown>): Promise<void> {
    const fn = httpsCallable(this.functions, name);
    await fn(payload);
  }

  /** Build a `notifyGroupExpense` callable descriptor. */
  buildNotifyExpenseCallable(
    expense: GroupExpense,
    paidByName: string,
    memberIds: string[],
  ): PostSyncCallable {
    return {
      name: 'notifyGroupExpense',
      payload: {
        groupId: expense.groupId,
        expenseId: expense.id,
        description: expense.description,
        amount: expense.amount,
        paidByName,
        memberIds,
      },
    };
  }

  /** Build a `recordGroupSettlement` callable descriptor. */
  buildRecordSettlementCallable(p: RecordSettlementPayload): PostSyncCallable {
    return {
      name: 'recordGroupSettlement',
      payload: { ...p } as Record<string, unknown>,
    };
  }
}
