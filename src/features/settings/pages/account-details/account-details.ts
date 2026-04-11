import { CommonModule, Location } from '@angular/common';
import { Component, computed, effect, inject, model, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Account } from '../../../../shared/models/account.model';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { TransactionDetailModal } from '../../../../shared/components/transaction-detail-modal/transaction-detail-modal';
import { SETTINGS_CURRENCIES } from '../../settings-currencies';

@Component({
  selector: 'app-account-details',
  imports: [CommonModule, Icon, TransactionDetailModal],
  templateUrl: './account-details.html',
  styleUrl: './account-details.css',
})
export class AccountDetails {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);

  readonly currencies = SETTINGS_CURRENCIES;

  account = signal<Account | null>(null);
  recentActivity = signal<TransactionRecord[]>([]);
  loading = signal(true);
  selecting = signal(false);
  removing = signal(false);

  txDetailOpen = model(false);
  selectedTransaction = signal<TransactionRecord | null>(null);

  private readonly selectedAccount = signal<Account | null>(null);

  readonly isCurrentAccount = computed(() => {
    const a = this.account();
    const c = this.selectedAccount();
    if (!a || !c) return false;
    return a.id === c.id;
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

  signedAmount(t: TransactionRecord): number {
    const raw = Math.abs(Number(t.amount ?? 0));
    return (t.type ?? '').toLowerCase() === 'income' ? raw : -raw;
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
