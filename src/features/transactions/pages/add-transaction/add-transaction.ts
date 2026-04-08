import { Component, inject, signal } from '@angular/core';
import { Icon } from '../../../../shared/components/icon/icon';
import { FormsModule, NgForm } from '@angular/forms';
import {
  RecurringTransactionCreateInput,
  TransactionCreateInput,
  TransactionRecord,
} from '../../../../shared/models/transaction.model';
import { AccountsService } from '../../../../services/accounts.service';
import { Account } from '../../../../shared/models/account.model';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { Category } from '../../../categories/types';
import { CategoriesService } from '../../../../services/categories.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { ReportsService } from '../../../../services/reports.service';
import { date } from '../../../../core/date';
import { paymentSourceOptions, recurringFrequencyOptions } from '../../types';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-add-transaction',
  imports: [Icon, FormsModule, DatePicker],
  templateUrl: './add-transaction.html',
  styleUrl: './add-transaction.css',
})
export class AddTransaction {
  private readonly accountsService = inject(AccountsService);
  private readonly router = inject(Router);
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
  recurringFrequencies = signal<{ name: string; value: string }[]>(recurringFrequencyOptions);

  readonly limits = FORM_LIMITS;

  async ngOnInit() {
    let account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.selectedAccount.set(account);
    this.currency.set(account?.currency ?? 'INR');
    let categories = await this.categoriesService.getCategories();
    this.categories.set(categories);
    let symbolString = new CurrencyPipe('en-IN').transform(
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
    isRecurring: false,
    createdAt: null,
    updatedAt: null,
  });

  onChangeType(type: 'expense' | 'income') {
    this.transaction.set({
      ...this.transaction(),
      type,
    });
  }

  onChangeSource(source: string) {
    this.transaction.set({
      ...this.transaction(),
      source,
    });
  }

  onChangeCategory(category: Category) {
    this.transaction.set({
      ...this.transaction(),
      category: category.name,
      icon: category.icon,
    });
  }

  onChangeRecurringFrequency(frequency: string) {
    this.transaction.set({
      ...this.transaction(),
      recurringFrequency: frequency,
    });
  }

  onRecurringToggle(checked: boolean): void {
    this.transaction.set({ ...this.transaction(), isRecurring: checked });
  }

  onAutoPayToggle(checked: boolean): void {
    this.transaction.set({ ...this.transaction(), isAutoPay: checked });
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
      this.notifier.error(`Amount must be between ${FORM_LIMITS.amountMin} and ${FORM_LIMITS.amountMax}.`);
      return;
    }

    if (this.transaction().isRecurring) {
      const freq = this.transaction().recurringFrequency?.trim();
      if (!freq) {
        this.notifier.error('Select a recurring frequency.');
        return;
      }
      const nextVal = this.transaction().nextPaymentDate as Date | string | null | undefined;
      const nextOk =
        nextVal != null &&
        (typeof nextVal === 'string'
          ? nextVal.trim().length > 0
          : nextVal instanceof Date && !Number.isNaN(nextVal.getTime()));
      if (!nextOk) {
        this.notifier.error('Select a next payment date.');
        return;
      }
    }

    const transactionPayload: TransactionCreateInput = {
      accountId: account.uid ?? '',
      amount: rawAmount,
      description: this.transaction().description.trim(),
      category: this.transaction().category,
      icon: this.transaction().icon ?? null,
      type: this.transaction().type,
      source: this.transaction().source ?? null,
      isRecurring: this.transaction().isRecurring ?? false,
    };

    let transactionResponse: TransactionRecord;
    try {
      transactionResponse = await this.transactionsService.createTransaction(transactionPayload);
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not save transaction.');
      return;
    }

    try {
      await this.reportsService.updateReportForTransaction(transactionResponse);
    } catch (e) {
      console.error(e);
    }

    const accountDocId = account.id || account.uid;
    try {
      const newBalance = await this.accountsService.adjustBalanceForTransaction(
        accountDocId,
        Number(transactionPayload.amount),
        transactionPayload.type === 'income' ? 'income' : 'expense',
      );
      const updatedAccount: Account = { ...account, balance: newBalance };
      this.selectedAccount.set(updatedAccount);
      localStorage.setItem('currentAccount', JSON.stringify(updatedAccount));
    } catch (e) {
      console.error(e);
      this.notifier.error(
        'Transaction was saved, but the account balance could not be updated. Check your connection and try syncing again.',
      );
      return;
    }

    if (this.transaction().isRecurring) {
      const nextDate =
        this.transaction().nextPaymentDate instanceof Date
          ? this.transaction().nextPaymentDate
          : new Date(String(this.transaction().nextPaymentDate));
      const recurringTransactionPayload: RecurringTransactionCreateInput = {
        uid: transactionResponse.uid,
        accountId: account.uid ?? '',
        transactionId: transactionResponse.uid,
        lastPaymentDate: new Date(),
        nextPaymentDate: nextDate ?? new Date(),
      };
      try {
        await this.transactionsService.createRecurringTransaction(recurringTransactionPayload);
      } catch (e) {
        console.error(e);
        this.notifier.error('Could not save recurring schedule.');
      }
    }

    this.router.navigateByUrl('/user/dashboard');
  }

  onBack() {
    this.router.navigateByUrl('/user/dashboard');
  }
}
