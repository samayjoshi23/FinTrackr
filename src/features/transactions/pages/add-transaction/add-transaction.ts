import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Auth } from '@angular/fire/auth';
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
import { CurrencyPipe, Location } from '@angular/common';
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
  private readonly route = inject(ActivatedRoute);
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
  recurringFrequencies = signal<{ name: string; value: string }[]>(recurringFrequencyOptions);

  readonly limits = FORM_LIMITS;

  /** Auto-pay is now part of RecurringTransaction, not TransactionRecord. */
  isAutoPay = signal(false);

  /** True while IndexedDB write runs; buttons stay disabled until navigation. */
  saving = signal(false);

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    this.selectedAccount.set(account);
    this.currency.set(account?.currency ?? 'INR');
    let categories = await this.categoriesService.getCategories();
    this.categories.set(categories);

    const recurringId = this.route.snapshot.queryParamMap.get('recurringId')?.trim();
    if (recurringId) {
      const rec = await this.transactionsService.getRecurringTransaction(recurringId);
      if (rec) {
        this.transaction.set({
          ...this.transaction(),
          description: rec.description,
          category: rec.category,
          amount: rec.amount,
          type: (rec.type === 'income' ? 'income' : 'expense') as 'income' | 'expense',
          icon: rec.icon ?? undefined,
          source: rec.source ?? '',
          isRecurring: false,
        });
      }
    }

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

    const nextPay =
      this.transaction().nextPaymentDate instanceof Date
        ? (this.transaction().nextPaymentDate as Date)
        : this.transaction().nextPaymentDate
          ? new Date(String(this.transaction().nextPaymentDate))
          : null;

    this.saving.set(true);
    try {
      let recurringTransactionId: string | null = null;

      // ── Step 1: Create recurring schedule first (if recurring) ──────────
      if (this.transaction().isRecurring) {
        const recurringPayload: RecurringTransactionCreateInput = {
          accountId: account.uid ?? '',
          transactionId: '', // will be updated after transaction is created
          description: this.transaction().description.trim(),
          category: this.transaction().category ?? '',
          amount: rawAmount,
          type: this.transaction().type,
          icon: this.transaction().icon ?? null,
          source: this.transaction().source ?? null,
          recurringFrequency: this.transaction().recurringFrequency?.trim() ?? null,
          isAutoPay: this.isAutoPay(),
          isActive: true,
          lastPaymentDate: new Date(),
          nextPaymentDate: nextPay && !Number.isNaN(nextPay.getTime()) ? nextPay : new Date(),
        };
        const recurringResponse = await this.transactionsService.createRecurringTransaction(
          recurringPayload,
          { syncRemoteInBackground: true },
        );
        recurringTransactionId = recurringResponse.uid;
      }

      // ── Step 2: Create the transaction linked to the recurring schedule ──
      const paidBy = this.paidByLabelForAccount(account);
      const transactionPayload: TransactionCreateInput = {
        accountId: account.uid ?? '',
        amount: rawAmount,
        description: this.transaction().description.trim(),
        category: this.transaction().category,
        ...(paidBy ? { paidBy: paidBy } : {}),
        icon: this.transaction().icon ?? null,
        type: this.transaction().type,
        source: this.transaction().source ?? null,
        isRecurring: this.transaction().isRecurring ?? false,
        ...(this.transaction().isRecurring
          ? {
              recurringFrequency: this.transaction().recurringFrequency?.trim() ?? null,
              recurringTransactionId,
              nextPaymentDate: nextPay && !Number.isNaN(nextPay.getTime()) ? nextPay : null,
            }
          : {}),
      };

      const transactionResponse = await this.transactionsService.createTransaction(
        transactionPayload,
        { syncRemoteInBackground: true },
      );

      // ── Step 3: Link the transaction back to the recurring schedule ──────
      if (recurringTransactionId) {
        void this.transactionsService
          .updateRecurringTransaction(recurringTransactionId, {
            transactionId: transactionResponse.uid,
          })
          .catch((e) => console.error(e));
      }

      // ── Step 4: Optimistic balance update + remote adjustments ───────────
      const delta = transactionPayload.type === 'income' ? rawAmount : -rawAmount;
      const optimisticBalance = (Number(account.balance) || 0) + delta;
      const updatedAccount: Account = { ...account, balance: optimisticBalance };
      this.selectedAccount.set(updatedAccount);
      await this.accountsService.writeAccountToCache(updatedAccount);

      const accountDocId = account.id || account.uid;
      void this.reportsService
        .updateReportForTransaction(transactionResponse)
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

      await this.router.navigateByUrl('/user/dashboard', { replaceUrl: true });
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

  private paidByLabelForAccount(account: Account): string | undefined {
    if (account.accountType !== 'multi-user') return undefined;
    const dn = this.auth.currentUser?.displayName?.trim();
    if (dn) return dn;
    try {
      const raw = localStorage.getItem('userProfile');
      const p = raw ? (JSON.parse(raw) as { displayName?: string }) : null;
      return p?.displayName?.trim() || 'Member';
    } catch {
      return 'Member';
    }
  }
}
