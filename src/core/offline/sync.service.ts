import { Injectable, inject, effect } from '@angular/core';
import { NetworkService } from './network.service';
import { SyncQueueService } from './sync-queue.service';
import { IndexedDbCacheService } from './indexed-db-cache.service';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { SyncQueueEntry } from './sync-queue.model';

import { AccountsService } from '../../services/accounts.service';
import { TransactionsService } from '../../services/transactions.service';
import { BudgetsService } from '../../services/budgets.service';
import { CategoriesService } from '../../services/categories.service';
import { GoalsService } from '../../services/goals.service';
import { ReportsService } from '../../services/reports.service';

import { TransactionCreateInput, RecurringTransactionCreateInput } from '../../shared/models/transaction.model';
import { BudgetCreateInput, BudgetUpdateInput } from '../../shared/models/budget.model';
import { GoalCreateInput, GoalUpdateInput } from '../../shared/models/goal.model';
import { AccountCreateInput, AccountUpdateInput } from '../../shared/models/account.model';
import { CategoryCreateInput, CategoryUpdateInput } from '../../features/categories/types';

const MAX_RETRIES = 5;

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly network = inject(NetworkService);
  private readonly syncQueue = inject(SyncQueueService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly notifier = inject(NotifierService);

  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly goalsService = inject(GoalsService);
  private readonly reportsService = inject(ReportsService);

  private syncing = false;

  constructor() {
    // Reset any interrupted entries on startup
    this.syncQueue.resetInterruptedEntries();

    // Watch for online status changes and trigger sync
    effect(() => {
      if (this.network.isOnline() && !this.syncing) {
        this.syncAll();
      }
    });
  }

  async syncAll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    try {
      const pending = await this.syncQueue.getAllPending();
      if (pending.length === 0) {
        this.syncing = false;
        return;
      }

      this.notifier.show('Syncing offline changes...');

      let successCount = 0;
      let failCount = 0;

      for (const entry of pending) {
        try {
          await this.syncQueue.markInProgress(entry.id);
          const success = await this.processEntry(entry);
          if (success) {
            await this.syncQueue.dequeue(entry.id);
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          const retryCount = await this.syncQueue.incrementRetry(entry.id);
          if (retryCount >= MAX_RETRIES) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            await this.syncQueue.markFailed(entry.id, msg);
            failCount++;
          }
        }
      }

      if (failCount === 0 && successCount > 0) {
        this.notifier.success('All changes synced!');
      } else if (failCount > 0) {
        this.notifier.error(`${failCount} change(s) failed to sync. Check your data.`);
      }
    } finally {
      this.syncing = false;
    }
  }

  private async processEntry(entry: SyncQueueEntry): Promise<boolean> {
    switch (entry.operation) {
      case 'create':
        return this.processCreate(entry);
      case 'update':
        return this.processUpdate(entry);
      case 'delete':
        return this.processDelete(entry);
      default:
        return false;
    }
  }

  private async processCreate(entry: SyncQueueEntry): Promise<boolean> {
    const p = entry.payload;
    let created = false;

    switch (entry.storeName) {
      case 'transactions':
        await this.transactionsService.createTransaction(p as unknown as TransactionCreateInput);
        created = true;
        break;
      case 'budgets':
        await this.budgetsService.createBudget(p as unknown as BudgetCreateInput);
        created = true;
        break;
      case 'goals':
        await this.goalsService.createGoal(p as unknown as GoalCreateInput);
        created = true;
        break;
      case 'categories':
        await this.categoriesService.createCategory(p as unknown as CategoryCreateInput);
        created = true;
        break;
      case 'accounts':
        await this.accountsService.createAccount(p as unknown as AccountCreateInput);
        created = true;
        break;
      case 'recurring-transactions':
        await this.transactionsService.createRecurringTransaction(p as unknown as RecurringTransactionCreateInput);
        created = true;
        break;
      default:
        return false;
    }

    // Remove the temp cached entry
    if (created && entry.tempLocalId) {
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
        break;
      case 'budgets':
        await this.budgetsService.updateBudget(
          entry.docId,
          entry.payload as unknown as BudgetUpdateInput,
        );
        await this.reportsService.rebuildCurrentMonthReport().catch(() => {});
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
      default:
        return false;
    }

    return true;
  }

  private async processDelete(entry: SyncQueueEntry): Promise<boolean> {
    if (!entry.docId) return false;

    try {
      switch (entry.storeName) {
        case 'transactions':
          await this.transactionsService.deleteTransaction(entry.docId);
          break;
        case 'accounts':
          await this.accountsService.deleteAccount(entry.docId);
          break;
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
    await this.syncQueue.clearAll();
    await this.cache.clear('accounts');
    await this.cache.clear('transactions');
    await this.cache.clear('recurring-transactions');
    await this.cache.clear('budgets');
    await this.cache.clear('goals');
    await this.cache.clear('categories');
    await this.cache.clear('sync-metadata');
  }
}
