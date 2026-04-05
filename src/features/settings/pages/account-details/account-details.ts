import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Account } from '../../../../shared/models/account.model';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { SETTINGS_CURRENCIES } from '../../settings-currencies';

@Component({
  selector: 'app-account-details',
  imports: [CommonModule, Icon],
  templateUrl: './account-details.html',
  styleUrl: './account-details.css',
})
export class AccountDetails {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);

  readonly currencies = SETTINGS_CURRENCIES;

  account = signal<Account | null>(null);
  recentActivity = signal<TransactionRecord[]>([]);
  loading = signal(true);
  selecting = signal(false);
  removing = signal(false);

  private readonly currentStored = signal<Account | null>(
    JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null,
  );

  readonly isCurrentAccount = computed(() => {
    const a = this.account();
    const c = this.currentStored();
    if (!a || !c) return false;
    return a.id === c.id;
  });

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) {
      this.notifier.error('Missing account.');
      await this.router.navigateByUrl('/user/settings');
      return;
    }

    try {
      const row = await this.accountsService.getAccount(id);
      if (!row) {
        this.notifier.error('Account not found.');
        await this.router.navigateByUrl('/user/settings');
        return;
      }
      this.account.set(row);
      const txs = await this.transactionsService.getTransactions().catch(() => []);
      this.recentActivity.set((txs ?? []).slice(0, 8));
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load account.');
      await this.router.navigateByUrl('/user/settings');
    } finally {
      this.loading.set(false);
    }
  }

  private refreshCurrentStored() {
    this.currentStored.set(
      JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null,
    );
  }

  onBack() {
    this.router.navigateByUrl('/user/settings');
  }

  async onSelectThisAccount() {
    const a = this.account();
    if (!a) return;
    this.selecting.set(true);
    try {
      await this.accountsService.selectAccount(a.id);
      this.refreshCurrentStored();
      this.notifier.success('This account is now active.');
      await this.router.navigateByUrl('/user/settings');
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
      const stored = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
      if (stored?.id === a.id) {
        const next = fresh ?? { ...stored, currency: code };
        next.isSelected = true;
        localStorage.setItem('currentAccount', JSON.stringify(next));
        this.refreshCurrentStored();
      }
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update currency.');
    }
  }

  async onRemoveAccount() {
    const a = this.account();
    if (!a) return;
    if (!confirm(`Remove “${a.name}”? This cannot be undone.`)) return;
    this.removing.set(true);
    try {
      await this.accountsService.deleteAccount(a.id);
      this.notifier.success('Account removed.');
      await this.router.navigateByUrl('/user/settings');
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Could not remove account.';
      this.notifier.error(msg);
    } finally {
      this.removing.set(false);
    }
  }
}
