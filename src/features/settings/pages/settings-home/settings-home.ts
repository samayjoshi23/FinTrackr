import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UserProfile } from 'firebase/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { Modal } from '../../../../shared/components/modal/modal';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { AccountsService } from '../../../../services/accounts.service';
import { AuthService } from '../../../../services/auth.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';
import { Account } from '../../../../shared/models/account.model';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_KEY = 'fintrackr-theme';

@Component({
  selector: 'app-settings-home',
  imports: [CommonModule, RouterLink, Icon, Modal, FormsModule, SignedAmountPipe],
  templateUrl: './settings-home.html',
  styleUrl: './settings-home.css',
})
export class SettingsHome {
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly authService = inject(AuthService);
  private readonly notifier = inject(NotifierService);
  private readonly router = inject(Router);

  userProfile = signal<UserProfile | null>(null);
  accounts = signal<Account[]>([]);
  currentAccount = signal<Account | null>(null);
  themeMode = signal<ThemePreference>('light');
  totalTransactions = signal(0);
  totalBalance = signal(0);
  initials = signal('');

  personalInfoModalOpen = false;
  editDisplayName = '';
  savingProfile = false;
  dateJoined = signal<Date>(new Date());
  readonly limits = FORM_LIMITS;

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

    let userProfile: UserProfile | null = JSON.parse(
      localStorage.getItem('userProfile') ?? 'null',
    ) as UserProfile | null;
    this.userProfile.set(userProfile ?? null);
    const date: string | null = (userProfile?.['date'] as string) ?? null;
    this.dateJoined.set(!!date ? new Date(date) : new Date());
    let accounts = await this.accountsService.getAccounts().catch(() => []);
    this.accounts.set(accounts ?? []);

    const current = await this.accountsService.getSelectedAccount();
    this.currentAccount.set(current);

    this.setInitials();

    let txTotal = 0;
    let balanceSum = 0;
    for (const a of accounts ?? []) {
      const aid = a.uid || a.id;
      const txs = await this.transactionsService.getTransactions().catch(() => []);
      txTotal += txs.length;
      balanceSum += Number(a.balance ?? 0);
    }
    this.totalTransactions.set(txTotal);
    this.totalBalance.set(balanceSum);
  }

  private refreshUserProfileFromStorage() {
    const next = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
    this.userProfile.set(next ?? null);
    this.setInitials();
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
    await this.authService.logout();
  }

  openAccount(a: Account) {
    this.router.navigateByUrl(`/user/settings/accounts/${a.id}`);
  }

  editPersonalInfo() {
    this.editDisplayName = (this.userProfile()?.['displayName'] as string) ?? '';
    this.personalInfoModalOpen = true;
  }

  async savePersonalInfo(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }
    this.savingProfile = true;
    try {
      await this.authService.updateDisplayName(this.editDisplayName);
      this.refreshUserProfileFromStorage();
      this.personalInfoModalOpen = false;
      this.notifier.success('Profile updated.');
    } catch (e) {
      console.error(e);
      this.notifier.error(e instanceof Error ? e.message : 'Could not update your profile.');
    } finally {
      this.savingProfile = false;
    }
  }

  addAccount() {
    this.router.navigateByUrl('/user/settings/accounts/new');
  }
}
