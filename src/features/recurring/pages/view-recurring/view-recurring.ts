import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { RecurringTransactionRecord, TransactionRecord } from '../../../../shared/models/transaction.model';
import { frequencyLabel } from '../../types';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-view-recurring',
  imports: [CommonModule, Icon, ConfirmPrompt, SignedAmountPipe],
  templateUrl: './view-recurring.html',
})
export class ViewRecurring {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);

  readonly frequencyLabel = frequencyLabel;
  readonly today = new Date();

  recurringId = '';
  recurring = signal<RecurringTransactionRecord | null>(null);
  recentTransactions = signal<TransactionRecord[]>([]);
  currencyCode = signal<string>('INR');
  loading = signal(true);

  stopPromptOpen = signal(false);
  deletePromptOpen = signal(false);
  acting = signal(false);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.recurringId = id;
    if (!id) {
      this.notifier.error('Missing schedule ID.');
      void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
      return;
    }
    try {
      const acc = await this.accountsService.getSelectedAccount();
      this.currencyCode.set(acc?.currency ?? 'INR');

      const rec = await this.transactionsService.getRecurringTransaction(id);
      if (!rec) {
        this.notifier.error('Schedule not found.');
        void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
        return;
      }
      this.recurring.set(rec);

      const linked = await this.transactionsService
        .getTransactionsForRecurring(id)
        .catch(() => []);
      this.recentTransactions.set(linked.slice(0, 3));
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not load schedule.');
      void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
    } finally {
      this.loading.set(false);
    }
  }

  onBack() {
    void this.router.navigateByUrl('/user/recurring');
  }

  onEdit() {
    void this.router.navigateByUrl(`/user/recurring/edit/${this.recurringId}`);
  }

  onStopRequest() {
    this.stopPromptOpen.set(true);
  }

  async onStopConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) return;
    this.acting.set(true);
    try {
      await this.transactionsService.stopRecurringTransaction(this.recurringId);
      this.recurring.update((r) => (r ? { ...r, isActive: false } : r));
      this.notifier.success('Recurring schedule stopped.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not stop recurring schedule.');
    } finally {
      this.acting.set(false);
    }
  }

  onDeleteRequest() {
    this.deletePromptOpen.set(true);
  }

  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) return;
    this.acting.set(true);
    try {
      await this.transactionsService.deleteRecurringTransaction(this.recurringId);
      this.notifier.success('Recurring schedule deleted.');
      void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not delete recurring schedule.');
    } finally {
      this.acting.set(false);
    }
  }
}
