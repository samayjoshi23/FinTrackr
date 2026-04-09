import { Component, computed, effect, inject, model, signal } from '@angular/core';
import { UserProfile } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { Icon } from '../../../shared/components/icon/icon';
import { quickActions } from '../types';
import { AccountsService } from '../../../services/accounts.service';
import { TransactionsService } from '../../../services/transactions.service';
import { ReportsService } from '../../../services/reports.service';
import { Account } from '../../../shared/models/account.model';
import { CategoryBreakdownEntry, MonthlyReport } from '../../../shared/models/report.model';
import { Router } from '@angular/router';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import { TransactionRecord } from '../../../shared/models/transaction.model';
import { budgetUsageFillColor } from '../../../shared/utils/budget-usage-color';
import { TransactionDetailModal } from '../../../shared/components/transaction-detail-modal/transaction-detail-modal';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, Icon, TransactionDetailModal],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly reportsService = inject(ReportsService);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);

  constructor() {
    effect(() => {
      this.applyMonthlyReport(this.reportsService.dashboardMonthReport());
    });
    effect(() => {
      if (!this.txDetailOpen()) this.selectedTransaction.set(null);
    });
  }

  userProfile = signal<UserProfile | null>(null);
  userInitials = signal<string>('');
  greetingMessage = signal<string>('');
  quickActions = quickActions;
  accounts = signal<Account[]>([]);
  selectedAccount = signal<Account | null>(null);
  recentTransactions = signal<TransactionRecord[]>([]);
  currency = signal<string>('INR');
  txDetailOpen = model(false);
  selectedTransaction = signal<TransactionRecord | null>(null);

  /** Current calendar month summary from {@link ReportsService.ensureCurrentMonthReport}. */
  summaryMonthLabel = signal<string>('');
  monthlyIncome = signal<number>(0);
  monthlyExpense = signal<number>(0);
  budgetUsedPercent = signal<number>(0);
  monthlyBudgetTotal = signal<number>(0);

  /** Animate budget bar from 0 → width after first data + layout. */
  budgetProgressShown = signal(false);

  hasMonthlyBudget = computed(() => this.monthlyBudgetTotal() > 0);
  budgetBarWidth = computed(() => {
    const p = this.budgetUsedPercent();
    return `${Math.min(100, Math.max(0, p))}%`;
  });
  budgetBarFillColor = computed(() => budgetUsageFillColor(this.budgetUsedPercent()));
  budgetRemaining = computed(() => this.monthlyBudgetTotal() - this.monthlyExpense());
  /** Positive amount past the monthly budget total. */
  budgetOverAmount = computed(() => Math.max(0, this.monthlyExpense() - this.monthlyBudgetTotal()));
  isBudgetOver = computed(
    () => this.monthlyBudgetTotal() > 0 && this.monthlyExpense() > this.monthlyBudgetTotal(),
  );

  async ngOnInit() {
    let profile = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
    this.userProfile.set(profile ?? null);
    this.setUserInitials();
    this.setGreetingMessage();
    let account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.selectedAccount.set(account ?? null);
    this.currency.set(account?.currency ?? 'INR');
    if (this.selectedAccount()) {
      const [recentTransactions] = await Promise.all([
        this.transactionsService.getTransactionsPage(
          {
            search: '',
            type: 'all',
            category: 'all',
            datePreset: 'all',
          },
          0,
          10,
        ),
        this.reportsService.ensureCurrentMonthReport(),
      ]);
      this.recentTransactions.set(recentTransactions.items);
    }

    this.queueBudgetProgressAnimation();
  }

  private queueBudgetProgressAnimation(): void {
    this.budgetProgressShown.set(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.budgetProgressShown.set(true));
    });
  }

  private applyMonthlyReport(report: MonthlyReport | null): void {
    if (!report) {
      this.summaryMonthLabel.set('');
      this.monthlyIncome.set(0);
      this.monthlyExpense.set(0);
      this.budgetUsedPercent.set(0);
      this.monthlyBudgetTotal.set(0);
      return;
    }
    this.summaryMonthLabel.set(this.formatMonthLong(report.month));
    this.monthlyIncome.set(report.totalIncome);
    this.monthlyExpense.set(report.totalExpense);
    this.budgetUsedPercent.set(report.totalBudgetUsed);
    this.monthlyBudgetTotal.set(this.sumCategoryBudgets(report.categoryBreakdown));
  }

  private formatMonthLong(monthKey: string): string {
    const parts = (monthKey ?? '').split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (!y || !m) return '';
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
  }

  private sumCategoryBudgets(breakdown: Record<string, CategoryBreakdownEntry>): number {
    let sum = 0;
    for (const e of Object.values(breakdown)) {
      if (e.budget != null && e.budget > 0) sum += e.budget;
    }
    return sum;
  }

  goToQuickAction(path: string) {
    const clean = (path ?? '').toString().replace(/^\/+/, '');
    this.router.navigateByUrl(`/${clean}`);
  }

  private static readonly txListPrefillQuery = {
    date: 'month',
    category: 'all',
    advanced: '1',
  } as const;

  goToIncomeTransactions(): void {
    void this.router.navigate(['/user/transactions/list'], {
      queryParams: { type: 'income', ...Dashboard.txListPrefillQuery },
    });
  }

  goToExpenseTransactions(): void {
    void this.router.navigate(['/user/transactions/list'], {
      queryParams: { type: 'expense', ...Dashboard.txListPrefillQuery },
    });
  }

  goToBudgets(): void {
    void this.router.navigate(['/user/budgets']);
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

  goToProfile() {
    this.router.navigateByUrl('/user/settings');
  }

  goToNotifications(): void {
    void this.router.navigateByUrl('/user/notifications');
  }

  openTransactionDetail(t: TransactionRecord): void {
    this.selectedTransaction.set(t);
    this.txDetailOpen.set(true);
  }
}
