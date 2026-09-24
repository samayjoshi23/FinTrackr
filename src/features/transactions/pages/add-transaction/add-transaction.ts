import { Component, inject, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { FormsModule, NgForm } from '@angular/forms';
import {
  RecurringTransactionRecord,
  TransactionCreateInput,
  TransactionRecord,
} from '../../../../shared/models/transaction.model';
import { AccountsService } from '../../../../services/accounts.service';
import { Account } from '../../../../shared/models/account.model';
import { ActivatedRoute, Router } from '@angular/router';
import { CurrencyPipe, Location } from '@angular/common';
import { Category } from '../../../categories/types';
import { CategoriesService } from '../../../../services/categories.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { ReportsService } from '../../../../services/reports.service';
import { date } from '../../../../core/date';
import { nextRecurringDate, paymentSourceOptions } from '../../types';
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
  private readonly route = inject(ActivatedRoute);

  /** Set when arriving via a "Mark paid" recurring-due notification deep link. */
  private recurring = signal<RecurringTransactionRecord | null>(null);

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

    // "Mark paid" from a recurring-due notification deep-links here with
    // ?recurringId=<id>. Prefill from the schedule so paying it is one tap, and
    // remember the schedule so onSubmit can link the transaction and advance the
    // schedule's next payment date.
    const recurringId = this.route.snapshot.queryParamMap.get('recurringId');
    if (recurringId) {
      try {
        const rec = await this.transactionsService.getRecurringTransaction(recurringId);
        if (rec && rec.accountId === (account?.uid ?? '')) {
          this.recurring.set(rec);
          this.transaction.set({
            ...this.transaction(),
            amount: rec.amount ?? null,
            description: rec.description ?? '',
            category: rec.category ?? '',
            icon: rec.icon ?? null,
            type: rec.type ?? 'expense',
            source: rec.source ?? '',
          });
        }
      } catch (e) {
        // Non-fatal: fall back to a blank manual entry.
        console.error(e);
      }
    }
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

  /** Deep-link to the new-category page. */
  onAddCategory(): void {
    void this.router.navigateByUrl('/user/categories/new');
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
      const rec = this.recurring();
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
        ...(rec
          ? { linkedObject: { type: 'recurring', id: rec.uid, recordId: rec.uid } }
          : {}),
      };

      const transactionResponse = await this.transactionsService.createTransaction(
        transactionPayload,
      );

      // Marking a manual recurring schedule as paid: link this transaction to the
      // schedule and roll its next payment date forward one period (past `now`).
      if (rec) {
        const base = rec.nextPaymentDate ?? new Date();
        const next = nextRecurringDate(base, rec.recurringFrequency);
        void this.transactionsService
          .updateRecurringTransaction(rec.uid, {
            transactionId: transactionResponse.uid,
            lastPaymentDate: new Date(),
            nextPaymentDate: next,
          })
          .catch((e) => console.error(e));
      }

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
