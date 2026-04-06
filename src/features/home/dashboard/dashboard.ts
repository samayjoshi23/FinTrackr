import { Component, inject, signal } from '@angular/core';
import { UserProfile } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { Icon } from '../../../shared/components/icon/icon';
import { quickActions } from '../types';
import { AccountsService } from '../../../services/accounts.service';
import { TransactionsService } from '../../../services/transactions.service';
import { Account } from '../../../shared/models/account.model';
import { Router } from '@angular/router';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import { TransactionRecord } from '../../../shared/models/transaction.model';

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
  selectedAccount = signal<Account | null>(null);
  recentTransactions = signal<TransactionRecord[]>([]);
  currency = signal<string>('INR');

  async ngOnInit() {
    let profile = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
    this.userProfile.set(profile ?? null);
    this.setUserInitials();
    this.setGreetingMessage();

    let account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.selectedAccount.set(account ?? null);
    this.currency.set(account?.currency ?? 'INR');
    if (this.selectedAccount()) {
      let recentTransactions = await this.transactionsService.getTransactionsPage(
        {
          search: '',
          type: 'all',
          category: 'all',
          datePreset: 'all',
        },
        0,
        10,
      );
      this.recentTransactions.set(recentTransactions.items);
    }
  }

  goToQuickAction(path: string) {
    const clean = (path ?? '').toString().replace(/^\/+/, '');
    this.router.navigateByUrl(`/${clean}`);
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
