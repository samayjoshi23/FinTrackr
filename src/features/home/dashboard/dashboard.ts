import { Component, inject, signal } from '@angular/core';
import { UserProfile } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { Icon } from '../../../shared/components/icon/icon';
import { quickActions } from '../types';
import { AccountsService } from '../../../services/accounts.service';
import { TransactionsService } from '../../../services/transactions.service';
import { Account } from '../../../shared/models/account.model';
import { TransactionRecord } from '../../../shared/models/transaction.model';
import { Router } from '@angular/router';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';

export interface DashboardTransactionRow {
  id: string;
  date: Date;
  amount: number;
  description: string;
  category: string;
  icon: string;
  type: string;
  source: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);

  userProfile = signal<UserProfile | null>(null);
  userInitials = signal<string>('');
  greetingMessage = signal<string>('');
  quickActions = quickActions;
  accounts = signal<Account[]>([]);
  recentTransactions = signal<DashboardTransactionRow[]>([]);

  async ngOnInit() {
    this.userProfile.set(
      JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null,
    );
    this.setUserInitials();
    this.setGreetingMessage();

    const selectedAccount = await this.setAccountsData();
    if (selectedAccount) {
      await this.loadTransactionsForAccount(selectedAccount.id);
    }
  }

  private async loadTransactionsForAccount(accountId: string) {
    try {
      const rows = await this.transactionsService.getTransactionsByAccount(accountId);
      this.recentTransactions.set(rows.slice(0, 20).map((t) => this.mapTransactionRow(t)));
    } catch (error) {
      console.error(error);
      this.notifier.error('Could not load transactions for this account.');
      this.recentTransactions.set([]);
    }
  }

  private mapTransactionRow(t: TransactionRecord): DashboardTransactionRow {
    return {
      id: t.id,
      date: t.createdAt ?? new Date(),
      amount: t.amount,
      description: t.description,
      category: t.category,
      icon: this.iconForCategory(t.category),
      type: t.type,
      source: t.source?.trim() ? t.source : t.category,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  private iconForCategory(category: string): string {
    const c = category.toLowerCase();
    if (c.includes('food') || c.includes('dining')) return 'utensils';
    if (c.includes('transport') || c.includes('travel')) return 'car-side';
    if (c.includes('entertain')) return 'entertainment';
    return 'tags';
  }

  async setAccountsData() {
    try {
      const accountsData = await this.accountsService.getAccounts();
      this.accounts.set(accountsData ?? []);
    } catch (error) {
      console.error(error);
      this.accounts.set([]);
    } finally {
      if (this.accounts().length === 0) {
        this.notifier.error('No accounts found. Please setup your accounts first');
        await this.router.navigateByUrl('/onboarding');
        return null;
      }
      let selectedAccount = this.accounts().find((account) => account.isSelected === true);
      if (!selectedAccount) {
        selectedAccount = this.accounts()[0];
        selectedAccount.isSelected = true;
        await this.accountsService.updateAccount(selectedAccount.id, { isSelected: true });
      }
      localStorage.setItem('currentAccount', JSON.stringify(selectedAccount));
      return selectedAccount;
    }
  }

  setUserInitials() {
    const displayName = (this.userProfile()?.['displayName'] as string) ?? '';
    const displayNameArr = displayName.split(' ');
    if (displayNameArr.length > 0) {
      this.userInitials.set(displayNameArr[0].charAt(0));
    }

    if (displayNameArr.length > 1) {
      this.userInitials.set(this.userInitials() + displayNameArr[1].charAt(0));
    }
  }

  setGreetingMessage() {
    const hour = new Date().getHours();
    let greeting = '';
    let displayName = (this.userProfile()?.['displayName'] as string) ?? '';
    displayName = displayName.split(' ')[0] ?? '';
    if (displayName.length === 0) {
      displayName = 'User';
    }
    if (hour < 12) {
      greeting = 'Good morning';
    } else if (hour < 18) {
      greeting = 'Good afternoon';
    } else {
      greeting = 'Good evening';
    }
    this.greetingMessage.set(`${greeting}, ${displayName}`);
  }
}
