import { CommonModule, Location } from '@angular/common';
import { Component, computed, effect, inject, model, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Account } from '../../../../shared/models/account.model';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { TransactionDetailModal } from '../../../../shared/components/transaction-detail-modal/transaction-detail-modal';
import { SETTINGS_CURRENCIES } from '../../settings-currencies';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';
import { Modal } from '../../../../shared/components/modal/modal';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-account-details',
  imports: [CommonModule, FormsModule, Icon, Modal, TransactionDetailModal, SignedAmountPipe],
  templateUrl: './account-details.html',
  styleUrl: './account-details.css',
})
export class AccountDetails {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  readonly currencies = SETTINGS_CURRENCIES;
  readonly limits = FORM_LIMITS;

  account = signal<Account | null>(null);
  recentActivity = signal<TransactionRecord[]>([]);
  loading = signal(true);
  selecting = signal(false);
  removing = signal(false);
  savingEdit = signal(false);
  editModalOpen = false;
  editName = '';
  editBalance: number | null = null;

  txDetailOpen = model(false);
  selectedTransaction = signal<TransactionRecord | null>(null);

  private readonly selectedAccount = signal<Account | null>(null);

  readonly isCurrentAccount = computed(() => {
    const a = this.account();
    const c = this.selectedAccount();
    if (!a || !c) return false;
    return a.id === c.id;
  });

  /** Gain/loss relative to initialBalance. Null when initialBalance is not set. */
  readonly balanceChange = computed(() => {
    const a = this.account();
    if (!a || a.initialBalance == null) return null;
    const initial = a.initialBalance;
    const current = a.balance;
    const diff = current - initial;
    const pct = initial !== 0 ? (diff / Math.abs(initial)) * 100 : 0;
    return { diff, pct, isGain: diff >= 0 };
  });

  constructor() {
    effect(() => {
      if (!this.txDetailOpen()) this.selectedTransaction.set(null);
    });
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) {
      this.notifier.error('Missing account.');
      await this.router.navigateByUrl('/user/settings', { replaceUrl: true });
      return;
    }

    try {
      const row = await this.accountsService.getAccount(id);
      if (!row) {
        this.notifier.error('Account not found.');
        await this.router.navigateByUrl('/user/settings', { replaceUrl: true });
        return;
      }
      this.account.set(row);
      this.selectedAccount.set(await this.accountsService.getSelectedAccount());
      const accountKey = row.uid ?? row.id;
      const txs = await this.transactionsService
        .getTransactionsForAccount(accountKey)
        .catch(() => []);
      this.recentActivity.set((txs ?? []).slice(0, 8));
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load account.');
      await this.router.navigateByUrl('/user/settings', { replaceUrl: true });
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshSelectedAccount() {
    this.selectedAccount.set(await this.accountsService.getSelectedAccount());
  }

  onBack() {
    this.location.back();
  }

  openEditModal(): void {
    const a = this.account();
    if (!a) return;
    this.editName = a.name ?? '';
    this.editBalance = Number(a.balance ?? 0);
    this.editModalOpen = true;
  }

  async saveAccountEdit(form: NgForm): Promise<void> {
    const a = this.account();
    if (!a) return;
    if (form.invalid || this.editBalance === null || Number.isNaN(Number(this.editBalance))) {
      form.control.markAllAsTouched();
      this.notifier.error('Enter a valid name and balance.');
      return;
    }

    this.savingEdit.set(true);
    try {
      await this.accountsService.updateAccount(a.id, {
        name: this.editName.trim(),
        balance: Number(this.editBalance),
      });
      const fresh = await this.accountsService.getAccount(a.id);
      if (fresh) {
        this.account.set(fresh);
        const sel = this.selectedAccount();
        if (sel?.id === fresh.id) {
          await this.accountsService.writeAccountToCache(fresh);
          this.selectedAccount.set(fresh);
          await this.reportsService.rebuildCurrentMonthReport().catch(() => {});
        }
      }
      this.editModalOpen = false;
      this.notifier.success('Account updated.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update account.');
    } finally {
      this.savingEdit.set(false);
    }
  }

  async onSelectThisAccount() {
    const a = this.account();
    if (!a) return;
    this.selecting.set(true);
    try {
      await this.accountsService.selectAccount(a.id);
      await this.refreshSelectedAccount();
      this.notifier.success('This account is now active.');
      await this.router.navigateByUrl('/user/settings', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not select account.');
    } finally {
      this.selecting.set(false);
    }
  }

  amountClass(t: TransactionRecord): string {
    return (t.type ?? '').toLowerCase() === 'income' ? 'text-primary' : 'text-rose-500';
  }

  isCurrencyActive(code: string): boolean {
    const a = this.account();
    return (a?.currency ?? '').toUpperCase() === code.toUpperCase();
  }

  async onSelectCurrency(code: string) {
    const a = this.account();
    if (!a) return;
    try {
      await this.accountsService.updateAccount(a.id, { currency: code });
      const fresh = await this.accountsService.getAccount(a.id);
      if (fresh) {
        this.account.set(fresh);
      }
      const sel = this.selectedAccount();
      if (sel?.id === a.id && fresh) {
        await this.accountsService.writeAccountToCache(fresh);
        await this.refreshSelectedAccount();
      }
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update currency.');
    }
  }

  openTransactionDetail(t: TransactionRecord): void {
    this.selectedTransaction.set(t);
    this.txDetailOpen.set(true);
  }

  async onRemoveAccount() {
    const a = this.account();
    if (!a) return;
    if (!confirm(`Remove “${a.name}”? This cannot be undone.`)) return;
    this.removing.set(true);
    try {
      await this.accountsService.deleteAccount(a.id);
      this.notifier.success('Account removed.');
      await this.router.navigateByUrl('/user/settings', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Could not remove account.';
      this.notifier.error(msg);
    } finally {
      this.removing.set(false);
    }
  }
}
