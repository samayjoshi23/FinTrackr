import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UserProfile } from 'firebase/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { AuthService } from '../../../../services/auth.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { Account } from '../../../../shared/models/account.model';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_KEY = 'fintrackr-theme';

@Component({
  selector: 'app-settings-home',
  imports: [CommonModule, RouterLink, Icon],
  templateUrl: './settings-home.html',
  styleUrl: './settings-home.css',
})
export class SettingsHome {
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  userProfile = signal<UserProfile | null>(null);
  accounts = signal<Account[]>([]);
  currentAccount = signal<Account | null>(null);
  themeMode = signal<ThemePreference>('light');
  totalTransactions = signal(0);
  totalBalance = signal(0);
  initials = signal('');

  constructor() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.themeMode() === 'system') this.applyBodyTheme();
      });
    }
  }

  async ngOnInit() {
    const stored = (localStorage.getItem(THEME_KEY) as ThemePreference) || 'light';
    this.themeMode.set(
      stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'light',
    );
    this.applyBodyTheme();

    this.userProfile.set(
      JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null,
    );
    this.setInitials();

    await this.accountsService.selectAccount(null).catch(() => null);
    const current = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.currentAccount.set(current);

    const rows = await this.accountsService.getAccounts().catch(() => []);
    this.accounts.set(rows ?? []);

    let txTotal = 0;
    let balanceSum = 0;
    for (const a of rows ?? []) {
      const aid = a.uid || a.id;
      const txs = await this.transactionsService.getTransactions().catch(() => []);
      txTotal += txs.length;
      balanceSum += Number(a.balance ?? 0);
    }
    this.totalTransactions.set(txTotal);
    this.totalBalance.set(balanceSum);
  }

  private setInitials() {
    const name = (this.userProfile()?.['displayName'] as string) ?? '';
    if (!name.trim()) {
      this.initials.set('?');
      return;
    }
    const parts = name.trim().split(/\s+/);
    const i = (parts[0][0] ?? '') + (parts.length > 1 ? (parts[1][0] ?? '') : '');
    this.initials.set(i.toUpperCase());
  }

  setTheme(mode: ThemePreference) {
    this.themeMode.set(mode);
    localStorage.setItem(THEME_KEY, mode);
    this.applyBodyTheme();
  }

  isThemeActive(mode: ThemePreference): boolean {
    return this.themeMode() === mode;
  }

  applyBodyTheme() {
    const mode = this.themeMode();
    const dark =
      mode === 'dark' ||
      (mode === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
  }

  balanceClass(a: Account): string {
    return Number(a.balance ?? 0) < 0 ? 'text-rose-500' : 'text-primary';
  }

  async logout() {
    localStorage.removeItem('currentAccount');
    await this.authService.logout();
  }

  openAccount(a: Account) {
    this.router.navigateByUrl(`/user/settings/accounts/${a.id}`);
  }
}
