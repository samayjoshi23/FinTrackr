import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { RecurringTransactionRecord } from '../../../../shared/models/transaction.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';
import { frequencyLabel } from '../../types';

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

  readonly frequencyLabel = frequencyLabel;

  items = signal<RecurringTransactionRecord[]>([]);
  currencyCode = signal<string>('INR');
  loading = signal(true);

  async ngOnInit() {
    try {
      const acc = await this.accountsService.getSelectedAccount();
      this.currencyCode.set(acc?.currency ?? 'INR');
      const rows = await this.transactionsService.getRecurringTransactions();
      this.items.set(rows);
    } catch (err) {
      console.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  onAdd() {
    void this.router.navigateByUrl('/user/recurring/add');
  }

  onView(rec: RecurringTransactionRecord) {
    void this.router.navigateByUrl(`/user/recurring/view/${rec.uid}`);
  }
}
