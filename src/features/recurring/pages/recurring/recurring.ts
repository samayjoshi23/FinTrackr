import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { RecurringTransactionRecord } from '../../../../shared/models/transaction.model';
import { frequencyLabel } from '../../types';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

@Component({
  selector: 'app-recurring',
  imports: [CommonModule, Icon, SignedAmountPipe],
  templateUrl: './recurring.html',
  styleUrl: './recurring.css',
})
export class Recurring {
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);

  items = signal<RecurringTransactionRecord[]>([]);
  currencyCode = signal<string>('INR');

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
}
