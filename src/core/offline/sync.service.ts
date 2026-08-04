import { Injectable, NgZone, inject, effect, signal } from '@angular/core';
import { NetworkService } from './network.service';
import { SyncQueueService } from './sync-queue.service';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { RevalidationTrackerService } from './revalidation-tracker.service';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { SyncLoggerService } from './sync-logger.service';
import { StorageQuotaService } from './storage-quota.service';
import { SyncQueueEntry } from './sync-queue.model';
import { consolidateQueue } from './sync-queue-consolidator';

import { AccountsService } from '../../services/accounts.service';
import { TransactionsService } from '../../services/transactions.service';
import { BudgetsService } from '../../services/budgets.service';
import { CategoriesService } from '../../services/categories.service';
import { GoalsService } from '../../services/goals.service';
import { ReportsService } from '../../services/reports.service';
import { GroupsService } from '../../features/groups/groups.service';
import { GroupExpensesService } from '../../features/groups/group-expenses.service';
import { GroupSettlementsService } from '../../features/groups/group-settlements.service';
import { GroupCloudFunctionsService } from '../../features/groups/group-cloud-functions.service';

import {
  TransactionCreateInput,
  TransactionRecord,
  RecurringTransactionCreateInput,
} from '../../shared/models/transaction.model';
import { BudgetCreateInput, BudgetUpdateInput } from '../../shared/models/budget.model';
import { GoalCreateInput, GoalUpdateInput } from '../../shared/models/goal.model';
import { AccountCreateInput, AccountUpdateInput } from '../../shared/models/account.model';
import { CategoryCreateInput, CategoryUpdateInput } from '../../features/categories/types';
import {
  GroupCreateInput,
  GroupExpenseCreateInput,
  GroupExpenseUpdateInput,
  GroupSettlementCreateInput,
} from '../../shared/models/group.model';

const MAX_RETRIES = 5;

/**
 * Web Locks name used to serialize `syncAll` across browser tabs. Only one tab
 * at a time holds the lock; other tabs' concurrent triggers no-op until it's
 * released. Falls back to a per-tab lock when `navigator.locks` is unavailable
 * (older browsers) — worst case is duplicate work, not incorrect writes since
 * every entry uses a pre-assigned Firestore doc id.
 */
const SYNC_LOCK_NAME = 'fintrackr:sync-all';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly network = inject(NetworkService);
  private readonly syncQueue = inject(SyncQueueService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly tracker = inject(RevalidationTrackerService);
  private readonly notifier = inject(NotifierService);
  private readonly zone = inject(NgZone);
  private readonly logger = inject(SyncLoggerService);
  private readonly quota = inject(StorageQuotaService);

  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly goalsService = inject(GoalsService);
  private readonly reportsService = inject(ReportsService);
  private readonly groupsService = inject(GroupsService);
  private readonly groupExpensesService = inject(GroupExpensesService);
  private readonly groupSettlementsService = inject(GroupSettlementsService);
  private readonly groupCloudFunctions = inject(GroupCloudFunctionsService);

  private syncing = false;
  /** Timer handle for the next scheduled backoff-driven sync pass, if any. */
  private nextRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Queue entries that exhausted their retries. Surfaced in the shell as a
   * warning banner with retry/discard actions so offline changes can never be
   * lost silently.
   */
  readonly failedEntries = signal<SyncQueueEntry[]>([]);

  /**
   * Months ('YYYY-MM') whose report must be rebuilt after this sync pass.
   * Collected while processing entries so N synced transactions trigger ONE
   * report rebuild per distinct month instead of one per entry (each rebuild
   * re-reads transactions + budgets + categories).
   */
  private readonly pendingReportMonths = new Set<string>();

  constructor() {
    // Reset any interrupted entries on startup, then surface any stranded
    // failures from previous sessions.
    void this.syncQueue.resetInterruptedEntries().then(() => this.refreshFailedEntries());

    // Watch for online status changes and trigger sync
    effect(() => {
      const isOnline = this.network.isOnline();
      const pendingCount = this.network.pendingSyncCount();
      if (isOnline && pendingCount > 0 && !this.syncing) {
        this.syncAll();
      }
    });
  }

  async syncAll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    try {
      // Cross-tab coordination: only one tab runs syncAll at a time. If another
      // tab holds the lock, `ifAvailable: true` causes the callback to be invoked
      // with null and we skip this pass — the tab holding the lock covers it.
      if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
        await navigator.locks.request(
          SYNC_LOCK_NAME,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return; // another tab is syncing — nothing to do
            await this.runSyncPass();
          },
        );
      } else {
        await this.runSyncPass();
      }
    } finally {
      this.syncing = false;
      await this.refreshFailedEntries();
      await this.scheduleNextBackoffRun();
    }
  }

  /** The actual sync work — extracted so it can run inside a Web Lock callback. */
  private async runSyncPass(): Promise<void> {
    const passStartedAt = performance.now();
    // Only pick entries whose exponential-backoff window has elapsed. Newly-queued
    // entries (retryCount === 0) are always ready; retried entries wait per
    // `backoffMsForRetry(retryCount)`.
    const ready = await this.syncQueue.getPendingReadyNow();
    if (ready.length === 0) return;

    this.logger.info({ event: 'sync.pass.start', counts: { ready: ready.length } });
    this.notifier.show('Syncing offline changes...');

    // Rebind `pending` to only the ready subset for the rest of the pass. Anything
    // still in backoff sits in the queue and is picked up by the scheduled retry.
    const pending = ready;

    // Collapse redundant offline ops (N edits of one doc → 1 write). Chains that
    // net out to nothing (create → delete, no side effects) vanish from the output;
    // dequeue those originals up front — there is nothing to send for them.
    const merged = consolidateQueue(pending);
    const survivorIds = new Set(merged.flatMap((e) => e.sourceIds));
    const collapsedCount = pending.length - merged.length;
    if (collapsedCount > 0) {
      this.logger.info({
        event: 'sync.consolidate',
        counts: { collapsed: collapsedCount, in: pending.length, out: merged.length },
      });
    }
    for (const entry of pending) {
      if (!survivorIds.has(entry.id)) {
        await this.syncQueue.dequeue(entry.id);
      }
    }

    let successCount = 0;
    let failCount = 0;

    for (const entry of merged) {
      try {
        for (const id of entry.sourceIds) {
          await this.syncQueue.markInProgress(id);
        }
        const success = await this.processEntry(entry);
        if (success) {
          // Dequeue every original the consolidated entry absorbed — only after
          // the server write succeeded, so a crash mid-sync loses nothing.
          for (const id of entry.sourceIds) {
            await this.syncQueue.dequeue(id);
          }
          // Server now holds canonical data (timestamps, ids) — force the next
          // read of this store to revalidate.
          this.tracker.markStale(entry.storeName);
          successCount++;
        } else {
          // `processEntry` returned false without throwing — a data-inconsistency
          // case (e.g. missing `_syncPreassignedId` for a store that requires it).
          // Retrying will never help since the payload is malformed. Mark as
          // failed immediately so the entry doesn't sit in `in-progress` limbo
          // and get re-picked-up every sync pass forever.
          for (const id of entry.sourceIds) {
            await this.syncQueue.markFailed(
              id,
              `Malformed queue entry for store "${entry.storeName}" — cannot process`,
            );
          }
          failCount++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          {
            event: 'sync.entry.failed',
            storeName: entry.storeName,
            counts: { sourceIds: entry.sourceIds.length },
            extra: { operation: entry.operation },
          },
          error,
        );
        // Originals of a consolidated entry retry in lockstep; when they exhaust
        // MAX_RETRIES the whole group is marked failed (counted once).
        let groupFailed = false;
        for (const id of entry.sourceIds) {
          const retryCount = await this.syncQueue.incrementRetry(id);
          if (retryCount >= MAX_RETRIES) {
            await this.syncQueue.markFailed(id, msg);
            groupFailed = true;
          }
        }
        if (groupFailed) {
          this.logger.error({
            event: 'sync.entry.exhausted',
            storeName: entry.storeName,
            counts: { retries: MAX_RETRIES, sourceIds: entry.sourceIds.length },
          });
          failCount++;
        }
      }
    }

    // One report rebuild per distinct affected month, after the whole pass.
    if (this.pendingReportMonths.size > 0) {
      const months = [...this.pendingReportMonths];
      this.pendingReportMonths.clear();
      await this.reportsService.rebuildReportsForMonths(months);
    }

    if (failCount === 0 && successCount > 0) {
      this.notifier.success('All changes synced!');
    } else if (failCount > 0) {
      this.notifier.error(`${failCount} change(s) failed to sync. Check your data.`);
    }

    this.logger.info({
      event: 'sync.pass.complete',
      counts: { success: successCount, fail: failCount, ready: ready.length },
      durationMs: Math.round(performance.now() - passStartedAt),
    });

    // Opportunistically check the storage quota after a successful pass — if
    // we're approaching the browser's limit the user needs to know before writes
    // start rejecting with `QuotaExceededError`.
    if (successCount > 0) void this.quota.check();
  }

  /**
   * If any queue entries are still waiting on their exponential backoff, schedule
   * a single setTimeout to re-run `syncAll` at the earliest eligible retry time.
   * Runs outside Angular's zone so the delay doesn't churn change detection.
   */
  private async scheduleNextBackoffRun(): Promise<void> {
    if (this.nextRetryTimer) {
      clearTimeout(this.nextRetryTimer);
      this.nextRetryTimer = null;
    }
    if (!this.network.isOnline()) return;
    const nextAt = await this.syncQueue.getNextRetryAt();
    if (nextAt == null) return;
    const delay = Math.max(0, nextAt - Date.now());
    this.zone.runOutsideAngular(() => {
      this.nextRetryTimer = setTimeout(() => {
        this.nextRetryTimer = null;
        if (this.network.isOnline()) void this.syncAll();
      }, delay);
    });
  }

  /** Re-read failed entries from the queue into the banner signal. */
  async refreshFailedEntries(): Promise<void> {
    this.failedEntries.set(await this.syncQueue.getFailedEntries());
  }

  /** Requeue every failed entry and kick a sync pass immediately. */
  async retryAllFailed(): Promise<void> {
    const failed = this.failedEntries();
    for (const entry of failed) {
      await this.syncQueue.retryFailed(entry.id);
    }
    await this.refreshFailedEntries();
    if (this.network.isOnline()) {
      await this.syncAll();
    }
  }

  /** Permanently discard every failed entry (user-confirmed). */
  async discardAllFailed(): Promise<void> {
    const failed = this.failedEntries();
    for (const entry of failed) {
      await this.syncQueue.discardFailed(entry.id);
    }
    await this.refreshFailedEntries();
  }

  private async processEntry(entry: SyncQueueEntry): Promise<boolean> {
    let success = false;
    switch (entry.operation) {
      case 'create':
        success = await this.processCreate(entry);
        break;
      case 'update':
        success = await this.processUpdate(entry);
        break;
      case 'delete':
        success = await this.processDelete(entry);
        break;
      default:
        return false;
    }

    if (success && entry.postSyncCallables?.length) {
      for (const callable of entry.postSyncCallables) {
        try {
          await this.groupCloudFunctions.invoke(callable.name, callable.payload);
        } catch (e) {
          // Log but don't fail the queue entry — callable errors are non-blocking
          this.logger.warn(
            {
              event: 'sync.callable.failed',
              extra: { callable: callable.name },
            },
            e,
          );
        }
      }
    }

    return success;
  }

  private extractPreassignedCreate(
    payload: Record<string, unknown>,
  ): { id: string; rest: Record<string, unknown> } | null {
    const raw = payload['_syncPreassignedId'];
    if (typeof raw !== 'string') return null;
    const { _syncPreassignedId: _x, ...rest } = payload;
    return { id: raw, rest };
  }

  private async processCreate(entry: SyncQueueEntry): Promise<boolean> {
    const p = entry.payload as Record<string, unknown>;
    const pre = this.extractPreassignedCreate(p);
    let created = false;

    // Every queued create MUST carry a preassigned doc id (`_syncPreassignedId`);
    // the worker replays it idempotently via applyPendingXCreate. Applying one
    // WITHOUT it by calling the public createX() would re-route through
    // offlineCrud.create, which ENQUEUES A BRAND-NEW entry (fresh id, retryCount 0)
    // on failure. A retryCount-0 entry is always "ready" and gets zero backoff, and
    // enqueue bumps pendingSyncCount which re-triggers syncAll — an infinite,
    // MAX_RETRIES-bypassing re-enqueue loop that hammers Firestore. So the `!pre`
    // path fails the entry (return false → markFailed) instead of retrying via the
    // enqueuing method.
    switch (entry.storeName) {
      case 'transactions': {
        let syncedRow: TransactionRecord | null = null;
        if (pre) {
          await this.transactionsService.applyPendingTransactionCreate(
            pre.id,
            pre.rest as unknown as TransactionCreateInput,
          );
          syncedRow = await this.transactionsService.getTransaction(pre.id);
        } else {
          return false;
        }
        if (syncedRow) {
          this.pendingReportMonths.add(this.reportsService.monthKeyForTransaction(syncedRow));
        }
        created = true;
        break;
      }
      case 'budgets':
        if (pre) {
          await this.budgetsService.applyPendingBudgetCreate(pre.id, pre.rest as unknown as BudgetCreateInput);
        } else {
          return false;
        }
        created = true;
        break;
      case 'budgetPlans':
        if (pre) {
          await this.budgetsService.applyPendingBudgetPlanCreate(pre.id, pre.rest);
          this.pendingReportMonths.add(this.reportsService.currentMonthKey());
        } else {
          return false;
        }
        created = true;
        break;
      case 'goals':
        if (pre) {
          await this.goalsService.applyPendingGoalCreate(pre.id, pre.rest as unknown as GoalCreateInput);
        } else {
          return false;
        }
        created = true;
        break;
      case 'categories':
        if (pre) {
          await this.categoriesService.applyPendingCategoryCreate(
            pre.id,
            pre.rest as unknown as CategoryCreateInput,
          );
        } else {
          return false;
        }
        created = true;
        break;
      case 'accounts':
        if (pre) {
          await this.accountsService.applyPendingAccountCreate(pre.id, pre.rest as unknown as AccountCreateInput);
        } else {
          return false;
        }
        created = true;
        break;
      case 'recurring-transactions':
        if (pre) {
          await this.transactionsService.applyPendingRecurringCreate(
            pre.id,
            pre.rest as unknown as RecurringTransactionCreateInput,
          );
        } else {
          return false;
        }
        created = true;
        break;
      case 'monthly-reports':
        if (pre) {
          await this.reportsService.applyPendingMonthlyReportCreate(pre.id, pre.rest);
        } else {
          return false;
        }
        created = true;
        break;
      case 'groups':
        if (pre) {
          await this.groupsService.applyPendingGroupCreate(
            pre.id,
            pre.rest as unknown as GroupCreateInput,
          );
        } else {
          return false;
        }
        created = true;
        break;
      case 'group-expenses':
        if (pre) {
          await this.groupExpensesService.applyPendingGroupExpenseCreate(
            pre.id,
            pre.rest as unknown as GroupExpenseCreateInput,
          );
        } else {
          return false;
        }
        created = true;
        break;
      case 'group-settlements':
        if (pre) {
          await this.groupSettlementsService.applyPendingGroupSettlementCreate(
            pre.id,
            pre.rest as unknown as GroupSettlementCreateInput,
          );
        } else {
          return false;
        }
        created = true;
        break;
      default:
        return false;
    }

    if (created && entry.tempLocalId?.startsWith('offline_')) {
      await this.cache.delete(entry.storeName, entry.tempLocalId);
    }

    return created;
  }

  private async processUpdate(entry: SyncQueueEntry): Promise<boolean> {
    if (!entry.docId) return false;

    switch (entry.storeName) {
      case 'transactions':
        await this.transactionsService.updateTransaction(
          entry.docId,
          entry.payload as unknown as TransactionCreateInput,
        );
        {
          const row = await this.transactionsService.getTransaction(entry.docId);
          if (row) this.pendingReportMonths.add(this.reportsService.monthKeyForTransaction(row));
        }
        break;
      case 'budgets':
        await this.budgetsService.updateBudget(
          entry.docId,
          entry.payload as unknown as BudgetUpdateInput,
        );
        this.pendingReportMonths.add(this.reportsService.currentMonthKey());
        break;
      case 'budgetPlans':
        await this.budgetsService.applyPendingBudgetPlanUpdate(
          entry.docId,
          entry.payload as Record<string, unknown>,
        );
        this.pendingReportMonths.add(this.reportsService.currentMonthKey());
        break;
      case 'goals':
        await this.goalsService.updateGoal(
          entry.docId,
          entry.payload as unknown as GoalUpdateInput,
        );
        break;
      case 'categories':
        await this.categoriesService.updateCategory(
          entry.docId,
          entry.payload as unknown as CategoryUpdateInput,
        );
        {
          const p = entry.payload as CategoryUpdateInput;
          if (p.name !== undefined && p.name.trim()) {
            await this.reportsService
              .patchCategoryNameInCurrentMonthReport(entry.docId, p.name)
              .catch(() => {});
          }
        }
        break;
      case 'accounts':
        await this.accountsService.updateAccount(
          entry.docId,
          entry.payload as unknown as AccountUpdateInput,
        );
        break;
      case 'recurring-transactions':
        await this.transactionsService.applyPendingRecurringUpdate(
          entry.docId,
          entry.payload as Record<string, unknown>,
        );
        break;
      case 'groups':
        await this.groupsService.applyPendingGroupUpdate(
          entry.docId,
          entry.payload as Record<string, unknown>,
        );
        break;
      case 'group-expenses': {
        const { _groupId, ...patch } = entry.payload as Record<string, unknown>;
        await this.groupExpensesService.applyPendingGroupExpenseUpdate(
          _groupId as string,
          entry.docId,
          patch as GroupExpenseUpdateInput,
        );
        break;
      }
      default:
        return false;
    }

    return true;
  }

  private async processDelete(entry: SyncQueueEntry): Promise<boolean> {
    if (!entry.docId) return false;

    try {
      switch (entry.storeName) {
        case 'transactions': {
          const beforeDelete = await this.transactionsService.getTransaction(entry.docId);
          await this.transactionsService.deleteTransaction(entry.docId);
          if (beforeDelete) {
            this.pendingReportMonths.add(
              this.reportsService.monthKeyForTransaction(beforeDelete),
            );
          }
          break;
        }
        case 'accounts':
          await this.accountsService.deleteAccount(entry.docId);
          break;
        case 'recurring-transactions':
          await this.transactionsService.applyPendingRecurringDelete(entry.docId);
          break;
        case 'groups':
          await this.groupsService.applyPendingGroupDelete(entry.docId);
          break;
        case 'group-expenses': {
          const groupId = entry.payload['_groupId'] as string | undefined;
          if (!groupId) return false;
          await this.groupExpensesService.applyPendingGroupExpenseDelete(groupId, entry.docId);
          break;
        }
        case 'group-settlements':
          // Settlements are immutable; no delete path in the UI
          return false;
        default:
          return false;
      }
    } catch (error) {
      // If doc is already gone, treat as success
      if (error instanceof Error && error.message.includes('not found')) {
        return true;
      }
      throw error;
    }

    return true;
  }

  /** Clear all cached data and sync queue (call on logout). */
  async clearAllData(): Promise<void> {
    this.tracker.reset();
    // Re-arm the quota warning: this wipe frees up significant storage, so a
    // future usage climb during the next session should be able to warn again
    // without waiting for a page reload.
    this.quota.resetSessionDedupe();
    this.accountsService.clearSessionCache();
    this.categoriesService.clearSessionCache();
    await this.syncQueue.clearAll();
    await this.cache.clear('accounts');
    await this.cache.clear('transactions');
    await this.cache.clear('recurring-transactions');
    await this.cache.clear('budgets');
    await this.cache.clear('budgetPlans').catch(() => {});
    await this.cache.clear('goals');
    await this.cache.clear('categories');
    await this.cache.clear('groups');
    await this.cache.clear('group-expenses').catch(() => {});
    await this.cache.clear('group-settlements').catch(() => {});
    await this.cache.clear('sync-metadata');
    await this.cache.clear('monthly-reports').catch(() => {});
    await this.cache.clear('notifications').catch(() => {});
  }
}
