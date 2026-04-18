import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { RecurringTransactionRecord } from '../../../../shared/models/transaction.model';
import { frequencyLabel } from '../../types';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-recurring',
  imports: [CommonModule, Icon, ConfirmPrompt, SignedAmountPipe],
  templateUrl: './recurring.html',
  styleUrl: './recurring.css',
})
export class Recurring {
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);

  items = signal<RecurringTransactionRecord[]>([]);
  currencyCode = signal<string>('INR');
  deletePromptOpen = signal(false);
  deletingItem = signal<RecurringTransactionRecord | null>(null);
  deleting = signal(false);
  stopPromptOpen = signal(false);
  stoppingItem = signal<RecurringTransactionRecord | null>(null);
  stopping = signal(false);

  readonly frequencyLabel = frequencyLabel;

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    if (!account) return;
    this.currencyCode.set(account.currency ?? 'INR');
    await this.load();
  }

  private async load(): Promise<void> {
    const recs = await this.transactionsService.getRecurringTransactions().catch(() => []);
    this.items.set(recs ?? []);
  }

  onAdd() {
    void this.router.navigateByUrl('/user/transactions/add');
  }

  onView(rec: RecurringTransactionRecord) {
    void this.router.navigateByUrl(`/user/recurring/view/${rec.uid}`);
  }

  onEdit(event: Event, rec: RecurringTransactionRecord) {
    event.stopPropagation();
    void this.router.navigateByUrl(`/user/recurring/edit/${rec.uid}`);
  }

  onDeleteRequest(event: Event, rec: RecurringTransactionRecord): void {
    event.stopPropagation();
    this.deletingItem.set(rec);
    this.deletePromptOpen.set(true);
  }

  onStopRequest(event: Event, rec: RecurringTransactionRecord): void {
    event.stopPropagation();
    if (!rec.isActive) return;
    this.stoppingItem.set(rec);
    this.stopPromptOpen.set(true);
  }

  async onStopConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.stoppingItem.set(null);
      return;
    }
    const item = this.stoppingItem();
    if (!item) return;

    this.stopping.set(true);
    try {
      await this.transactionsService.stopRecurringTransaction(item.uid);
      this.items.update((list) =>
        list.map((r) => (r.uid === item.uid ? { ...r, isActive: false } : r)),
      );
      this.notifier.success('Recurring schedule stopped.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not stop recurring schedule.');
    } finally {
      this.stopping.set(false);
      this.stoppingItem.set(null);
    }
  }

  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.deletingItem.set(null);
      return;
    }
    const item = this.deletingItem();
    if (!item) return;

    this.deleting.set(true);
    try {
      await this.transactionsService.deleteRecurringTransaction(item.uid);
      this.items.update((list) => list.filter((r) => r.uid !== item.uid));
      this.notifier.success('Recurring schedule removed.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not remove recurring schedule.');
    } finally {
      this.deleting.set(false);
      this.deletingItem.set(null);
    }
  }
}
