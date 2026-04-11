import { CommonModule } from '@angular/common';
import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TransactionRecord } from '../../models/transaction.model';
import { Icon } from '../icon/icon';
import { Modal } from '../modal/modal';
import { ConfirmPrompt } from '../confirm-prompt/confirm-prompt';
import { TransactionsService } from '../../../services/transactions.service';
import { AccountsService } from '../../../services/accounts.service';
import { ReportsService } from '../../../services/reports.service';
import { NotifierService } from '../notifier/notifier.service';
import { RecordAction, RecordActionType } from '../../enums/recordActions.enum';

@Component({
  selector: 'app-transaction-detail-modal',
  imports: [CommonModule, Modal, Icon, FormsModule, ConfirmPrompt],
  templateUrl: './transaction-detail-modal.html',
  styleUrl: './transaction-detail-modal.css',
})
export class TransactionDetailModal {
  private readonly transactionsService = inject(TransactionsService);
  private readonly accountsService = inject(AccountsService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  open = model(false);
  transaction = input<TransactionRecord | null>(null);
  currency = input<string>('INR');

  /** Emits the updated record after a successful amount edit. */
  transactionUpdated = output<{
    transaction: TransactionRecord | null;
    action: RecordActionType;
  }>();

  editMode = signal(false);
  editAmountValue = signal<number | null>(null);
  deletePromptOpen = signal(false);
  saving = signal(false);

  protected iconFor(t: TransactionRecord): string {
    if (t.icon) return t.icon;
    const c = (t.category ?? '').toLowerCase();
    if (c.includes('food') || c.includes('dining')) return 'utensils';
    if (c.includes('transport') || c.includes('travel')) return 'car-side';
    if (c.includes('bill') || c.includes('electric')) return 'notes';
    if (c.includes('entertain') || c.includes('stream')) return 'entertainment';
    return 'wallet';
  }

  protected sourceLabel(t: TransactionRecord): string {
    const s = t.source?.trim();
    if (s) return s.toUpperCase();
    const c = t.category?.trim();
    return c ? c.toUpperCase() : '—';
  }

  onEditStart(tx: TransactionRecord): void {
    this.editAmountValue.set(tx.amount ?? 0);
    this.editMode.set(true);
  }

  onEditCancel(): void {
    this.editMode.set(false);
    this.editAmountValue.set(null);
  }

  async onEditSave(tx: TransactionRecord): Promise<void> {
    const newAmount = this.editAmountValue();
    if (newAmount == null || newAmount <= 0) {
      this.notifier.error('Enter a valid amount greater than 0.');
      return;
    }

    const oldAmount = tx.amount ?? 0;
    this.saving.set(true);
    try {
      await this.transactionsService.updateTransaction(tx.uid, {
        accountId: tx.accountId,
        amount: newAmount,
        description: tx.description,
        category: tx.category,
        type: tx.type,
      });

      // Reverse old balance effect then apply new amount
      const reverseType = tx.type === 'income' ? 'expense' : 'income';
      await this.accountsService.adjustBalanceForTransaction(
        tx.accountId,
        oldAmount,
        reverseType as 'income' | 'expense',
      );
      await this.accountsService.adjustBalanceForTransaction(
        tx.accountId,
        newAmount,
        tx.type as 'income' | 'expense',
      );

      await this.reportsService.updateReportForTransaction({ ...tx, amount: newAmount });

      const updated: TransactionRecord = { ...tx, amount: newAmount, updatedAt: new Date() };
      this.transactionUpdated.emit({
        transaction: updated as TransactionRecord,
        action: RecordAction.UPDATE,
      });
      this.editMode.set(false);
      this.editAmountValue.set(null);
      this.notifier.success('Amount updated.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update transaction.');
    } finally {
      this.saving.set(false);
    }
  }

  onDeleteRequested(): void {
    this.deletePromptOpen.set(true);
  }

  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) return;
    const tx = this.transaction();
    if (!tx) return;

    this.saving.set(true);
    try {
      await this.transactionsService.deleteTransaction(tx.uid);

      // Reverse the transaction's effect on the account balance
      const reverseType = tx.type === 'income' ? 'expense' : 'income';
      await this.accountsService.adjustBalanceForTransaction(
        tx.accountId,
        tx.amount ?? 0,
        reverseType as 'income' | 'expense',
      );

      // Rebuild report (transaction already removed from cache before this call in practice,
      // but rebuildCurrentMonthReport fetches fresh data anyway)
      await this.reportsService.updateReportForTransaction(tx);
      this.transactionUpdated.emit({ transaction: null, action: RecordAction.DELETE });
      this.open.set(false);
      this.notifier.success('Transaction deleted.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not delete transaction.');
    } finally {
      this.saving.set(false);
    }
  }
}
