import { Component, inject, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { FormsModule, NgForm } from '@angular/forms';
import {
  TransactionCreateInput,
  TransactionRecord,
} from '../../../../shared/models/transaction.model';
import { AccountsService } from '../../../../services/accounts.service';
import { Account } from '../../../../shared/models/account.model';
import { Router } from '@angular/router';
import { CurrencyPipe, Location } from '@angular/common';
import { Category } from '../../../categories/types';
import { CategoriesService } from '../../../../services/categories.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { ReportsService } from '../../../../services/reports.service';
import { date } from '../../../../core/date';
import { paymentSourceOptions } from '../../types';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-add-transaction',
  imports: [Icon, FormsModule],
  templateUrl: './add-transaction.html',
  styleUrl: './add-transaction.css',
})
export class AddTransaction {
  private readonly accountsService = inject(AccountsService);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly location = inject(Location);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);
  private readonly reportsService = inject(ReportsService);

  selectedAccount = signal<Account | null>(null);
  currency = signal<string>('INR');
  currencySymbol = signal<string>('₹');
  categories = signal<Category[]>([]);
  today = signal<string>(date().format('YYYY-MM-DD'));
  paymentSources = signal<{ name: string; icon: string }[]>(paymentSourceOptions);

  readonly limits = FORM_LIMITS;

  /** True while IndexedDB write runs; buttons stay disabled until navigation. */
  saving = signal(false);

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    this.selectedAccount.set(account);
    this.currency.set(account?.currency ?? 'INR');
    const categories = await this.categoriesService.getCategories();
    this.categories.set(categories);

    const symbolString = new CurrencyPipe('en-IN').transform(
      0,
      account?.currency ?? 'INR',
      'symbol',
      '0.0-0',
    );
    this.currencySymbol.set((symbolString ?? '₹').split('')[0]);
  }

  transaction = signal<TransactionRecord>({
    uid: '',
    accountId: '',
    amount: null,
    description: '',
    category: '',
    type: 'expense',
    source: '',
    createdAt: null,
    updatedAt: null,
  });

  onChangeType(type: 'expense' | 'income') {
    this.transaction.set({ ...this.transaction(), type });
  }

  onChangeSource(source: string) {
    this.transaction.set({ ...this.transaction(), source });
  }

  onChangeCategory(category: Category) {
    this.transaction.set({ ...this.transaction(), category: category.name, icon: category.icon });
  }

  async onSubmit(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const account = this.selectedAccount();
    if (!account) {
      this.notifier.error('No account selected.');
      return;
    }

    const rawAmount = Number(this.transaction().amount);
    if (
      !Number.isFinite(rawAmount) ||
      rawAmount < FORM_LIMITS.amountMin ||
      rawAmount > FORM_LIMITS.amountMax
    ) {
      this.notifier.error(
        `Amount must be between ${FORM_LIMITS.amountMin} and ${FORM_LIMITS.amountMax}.`,
      );
      return;
    }

    this.saving.set(true);
    try {
      const paidBy = this.paidByForAccount(account);
      const transactionPayload: TransactionCreateInput = {
        accountId: account.uid ?? '',
        amount: rawAmount,
        description: this.transaction().description.trim(),
        category: this.transaction().category,
        ...(paidBy ? { paidBy } : {}),
        icon: this.transaction().icon ?? null,
        type: this.transaction().type,
        source: this.transaction().source ?? null,
        date: date().format('YYYY-MM-DD'),
      };

      const transactionResponse = await this.transactionsService.createTransaction(
        transactionPayload,
        { syncRemoteInBackground: true },
      );

      // Optimistic balance update
      const delta = transactionPayload.type === 'income' ? rawAmount : -rawAmount;
      const optimisticBalance = (Number(account.balance) || 0) + delta;
      const updatedAccount: Account = { ...account, balance: optimisticBalance };
      this.selectedAccount.set(updatedAccount);
      await this.accountsService.writeAccountToCache(updatedAccount);

      const accountDocId = account.id || account.uid;
      void this.reportsService
        .applyTransactionDelta({ kind: 'create', tx: transactionResponse })
        .catch((e) => console.error(e));
      void this.accountsService
        .adjustBalanceForTransaction(
          accountDocId,
          rawAmount,
          transactionPayload.type === 'income' ? 'income' : 'expense',
        )
        .catch((e) => {
          console.error(e);
          this.notifier.error(
            'Balance will sync when online. Check your connection if this persists.',
          );
        });

      await this.router.navigateByUrl('/user/transactions/list', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not save transaction.');
    } finally {
      this.saving.set(false);
    }
  }

  onBack() {
    this.location.back();
  }

  private paidByForAccount(account: Account): string | undefined {
    if (account.accountType !== 'multi-user') return undefined;
    const uid = this.auth.currentUser?.uid;
    if (uid) return uid;
    return undefined;
  }
}
