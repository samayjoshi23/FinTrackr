import { Component, inject, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { FormsModule, NgForm } from '@angular/forms';
import {
  LinkedObject,
  RecurringTransactionCreateInput,
  TransactionCreateInput,
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
import { paymentSourceOptions, recurringFrequencyOptions } from '../../../transactions/types';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-add-recurring-transaction',
  imports: [Icon, FormsModule, DatePicker],
  templateUrl: './add-recurring-transaction.html',
  styleUrl: './add-recurring-transaction.css',
})
export class AddRecurringTransaction {
  private readonly accountsService = inject(AccountsService);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly location = inject(Location);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);
  private readonly reportsService = inject(ReportsService);

  selectedAccount = signal<Account | null>(null);
  currencySymbol = signal<string>('₹');
  categories = signal<Category[]>([]);
  paymentSources = signal<{ name: string; icon: string }[]>(paymentSourceOptions);
  recurringFrequencies = signal<{ name: string; value: string }[]>(recurringFrequencyOptions);

  readonly limits = FORM_LIMITS;

  type = signal<'expense' | 'income'>('expense');
  amount = signal<number | null>(null);
  description = signal('');
  source = signal('');
  category = signal('');
  icon = signal<string | null>(null);
  recurringFrequency = signal('');
  nextPaymentDate = signal<Date | null>(null);
  isAutoPay = signal(false);
  saving = signal(false);

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    this.selectedAccount.set(account);
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

  onChangeType(t: 'expense' | 'income') {
    this.type.set(t);
  }

  onChangeSource(s: string) {
    this.source.set(s);
  }

  onChangeCategory(cat: Category) {
    this.category.set(cat.name);
    this.icon.set(cat.icon ?? null);
  }

  onChangeFrequency(freq: string) {
    this.recurringFrequency.set(freq);
  }

  onAutoPayToggle(checked: boolean) {
    this.isAutoPay.set(checked);
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

    const rawAmount = Number(this.amount());
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

    if (!this.source().trim()) {
      this.notifier.error('Select a payment source.');
      return;
    }

    if (!this.category().trim()) {
      this.notifier.error('Select a category.');
      return;
    }

    if (!this.recurringFrequency().trim()) {
      this.notifier.error('Select a recurring frequency.');
      return;
    }

    const nextPay = this.nextPaymentDate();
    if (!nextPay || Number.isNaN(nextPay.getTime())) {
      this.notifier.error('Select a next payment date.');
      return;
    }

    this.saving.set(true);
    try {
      const recurringPayload: RecurringTransactionCreateInput = {
        accountId: account.uid ?? '',
        transactionId: '',
        description: this.description().trim(),
        category: this.category(),
        amount: rawAmount,
        type: this.type(),
        icon: this.icon(),
        source: this.source(),
        recurringFrequency: this.recurringFrequency(),
        isAutoPay: this.isAutoPay(),
        isActive: true,
        lastPaymentDate: new Date(),
        nextPaymentDate: nextPay,
      };

      const recurringResponse = await this.transactionsService.createRecurringTransaction(
        recurringPayload,
        { syncRemoteInBackground: true },
      );
      const recurringId = recurringResponse.uid;

      const linkedObject: LinkedObject = {
        type: 'recurring',
        id: recurringId,
        recordId: recurringId,
      };

      const paidBy = this.paidByForAccount(account);
      const transactionPayload: TransactionCreateInput = {
        accountId: account.uid ?? '',
        amount: rawAmount,
        description: this.description().trim(),
        category: this.category(),
        ...(paidBy ? { paidBy } : {}),
        icon: this.icon(),
        type: this.type(),
        source: this.source(),
        date: date().format('YYYY-MM-DD'),
        linkedObject,
        isRecurring: true,
        recurringTransactionId: recurringId,
      };

      const transactionResponse = await this.transactionsService.createTransaction(
        transactionPayload,
        { syncRemoteInBackground: true },
      );

      void this.transactionsService
        .updateRecurringTransaction(recurringId, { transactionId: transactionResponse.uid })
        .catch((e) => console.error(e));

      const delta = transactionPayload.type === 'income' ? rawAmount : -rawAmount;
      const updatedBalance = (Number(account.balance) || 0) + delta;
      const updatedAccount: Account = { ...account, balance: updatedBalance };
      await this.accountsService.writeAccountToCache(updatedAccount);

      void this.reportsService
        .updateReportForTransaction(transactionResponse)
        .catch((e) => console.error(e));
      void this.accountsService
        .adjustBalanceForTransaction(
          account.id || account.uid,
          rawAmount,
          transactionPayload.type === 'income' ? 'income' : 'expense',
        )
        .catch((e) => console.error(e));

      await this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not save recurring transaction.');
    } finally {
      this.saving.set(false);
    }
  }

  onBack() {
    this.location.back();
  }

  private paidByForAccount(account: Account): string | undefined {
    if (account.accountType !== 'multi-user') return undefined;
    return this.auth.currentUser?.uid ?? undefined;
  }
}
