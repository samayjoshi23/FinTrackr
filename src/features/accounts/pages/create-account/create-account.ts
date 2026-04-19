import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UserProfile } from 'firebase/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { AccountsService } from '../../../../services/accounts.service';
import { BudgetsService } from '../../../../services/budgets.service';
import { CategoriesService } from '../../../../services/categories.service';
import { GoalsService } from '../../../../services/goals.service';
import { ReportsService } from '../../../../services/reports.service';
import { UsersLookupService, UserLookupHit } from '../../../../services/users-lookup.service';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';
import {
  Account,
  AccountCreateInput,
  AccountMember,
  AccountType,
} from '../../../../shared/models/account.model';
import { BudgetCreateInput } from '../../../../shared/models/budget.model';
import { GoalCreateInput } from '../../../../shared/models/goal.model';
import {
  Category,
  CategoryCreateInput,
  DEFAULT_CATEGORIES,
} from '../../../categories/types';
import { currencies, budgetSuggestionCards } from '../../../../core/auth/onboarding/types';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

const CREATE_ACCOUNT_PAGES: {
  sequence: number;
  title: string;
  description: string;
  skippable: boolean;
}[] = [
  {
    sequence: 1,
    title: 'Account details',
    description: 'Name and starting balance',
    skippable: false,
  },
  {
    sequence: 2,
    title: 'Currency',
    description: 'Default currency for this account',
    skippable: false,
  },
  {
    sequence: 3,
    title: 'Account type',
    description: 'Single-user or shared with others',
    skippable: false,
  },
  {
    sequence: 4,
    title: 'Optional budget',
    description: 'Set a monthly budget for a category',
    skippable: true,
  },
  {
    sequence: 5,
    title: 'Optional goal',
    description: 'Track a savings goal (optional)',
    skippable: true,
  },
];

@Component({
  selector: 'app-create-account',
  imports: [CommonModule, FormsModule, Icon, DatePicker, SignedAmountPipe],
  templateUrl: './create-account.html',
  styleUrl: './create-account.css',
})
export class CreateAccount {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly goalsService = inject(GoalsService);
  private readonly reportsService = inject(ReportsService);
  private readonly usersLookup = inject(UsersLookupService);
  private readonly notifier = inject(NotifierService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly pages = signal(CREATE_ACCOUNT_PAGES);
  readonly limits = FORM_LIMITS;
  currentPage = signal(1);

  userProfile = signal<UserProfile | null>(null);
  formModel = {
    account: {
      name: '',
      balance: '' as string | number,
      currency: 'INR',
    },
    budget: {
      limit: '',
      month: '',
      categoryUid: '',
    },
    goal: {
      name: '',
      target: '',
      dueDate: '',
      currentAmount: '',
    },
  };

  currencies = signal(currencies.map((c) => ({ ...c })));
  budgetSuggestions = signal(budgetSuggestionCards.map((b) => ({ ...b })));

  accountType = signal<AccountType>('single-user');
  searchEmail = '';
  searchingUser = false;
  searchHit = signal<UserLookupHit | null>(null);
  /** Users invited to a multi-user account (pending join). */
  invitedMembers = signal<UserLookupHit[]>([]);

  accountCategories = signal<Category[]>([]);
  /** Set after step 3 create + seed. */
  createdAccount = signal<Account | null>(null);
  accountCommitted = signal(false);
  /** True while creating account, budget, goal, or finishing. */
  stepBusy = signal(false);

  private ownerUid = '';

  ngOnInit() {
    const profile = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
    this.userProfile.set(profile);
    this.ownerUid = (profile?.['uid'] as string) ?? '';
    this.formModel.budget.month = new Date().toLocaleString('en-US', { month: 'long' });
    this.onSelectCurrency(this.formModel.account.currency);
  }

  onSelectCurrency(value: string) {
    this.formModel.account.currency = value;
    this.currencies.update((prev) => prev.map((c) => ({ ...c, isSelected: c.value === value })));
  }

  onSelectBudgetSuggestion(amount: string) {
    this.formModel.budget.limit = amount;
    this.budgetSuggestions.update((prev) =>
      prev.map((s) => ({ ...s, isSelected: s.amount === amount })),
    );
  }

  selectBudgetCategory(uid: string) {
    this.formModel.budget.categoryUid = uid;
  }

  setAccountType(t: AccountType) {
    this.accountType.set(t);
    if (t === 'single-user') {
      this.invitedMembers.set([]);
      this.searchHit.set(null);
      this.searchEmail = '';
    }
  }

  async searchUserByEmail() {
    const email = this.searchEmail.trim();
    if (!email) {
      this.notifier.error('Enter an email to search.');
      return;
    }
    this.searchingUser = true;
    this.searchHit.set(null);
    try {
      const hit = await this.usersLookup.findByEmail(email);
      if (!hit) {
        this.notifier.error('No user found with that email.');
        return;
      }
      if (hit.uid === this.ownerUid) {
        this.notifier.error("You can't add yourself as a member.");
        return;
      }
      this.searchHit.set(hit);
      if (this.isInvited(hit.uid)) {
        this.notifier.show('This person is already on your invite list.');
      }
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not search users.');
    } finally {
      this.searchingUser = false;
    }
  }

  /** True if this user is already on the invite list for the new account. */
  isInvited(uid: string): boolean {
    return this.invitedMembers().some((m) => m.uid === uid);
  }

  addInvitedMember() {
    const hit = this.searchHit();
    if (!hit) return;
    if (this.isInvited(hit.uid)) {
      this.notifier.show('That person is already added.');
      return;
    }
    this.invitedMembers.update((list) => [...list, hit]);
    this.searchHit.set(null);
    this.searchEmail = '';
    this.notifier.success('Member added.');
  }

  removeInvitedMember(uid: string) {
    this.invitedMembers.update((list) => list.filter((m) => m.uid !== uid));
  }

  onInviteEmailKeydown(ev: KeyboardEvent) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (!this.accountCommitted() && !this.searchingUser) void this.searchUserByEmail();
  }

  goToPreviousStep() {
    const page = this.currentPage();
    if (page === 1) {
      this.location.back();
      return;
    }
    if (page === 4 && this.accountCommitted()) {
      this.currentPage.set(3);
      return;
    }
    if (page === 5 && this.accountCommitted()) {
      this.currentPage.set(4);
      return;
    }
    if (page === 3 && this.accountCommitted()) {
      this.notifier.show('This account is already created. Continue or finish the setup.');
      return;
    }
    this.currentPage.set(page - 1);
  }

  async goToNextStep(skip = false) {
    if (this.stepBusy()) return;
    if (!skip) {
      switch (this.currentPage()) {
        case 1: {
          const n = this.formModel.account.name?.trim();
          const bal = this.formModel.account.balance;
          if (!n || bal === '' || bal === null || Number.isNaN(Number(bal))) {
            this.notifier.error('Enter account name and balance.');
            return;
          }
          break;
        }
        case 2: {
          if (!this.formModel.account.currency) {
            this.notifier.error('Select a currency.');
            return;
          }
          break;
        }
        case 3: {
          if (!this.accountCommitted()) {
            this.stepBusy.set(true);
            try {
              const err = await this.runCreateAccountAndSeedCategories();
              if (err) {
                console.error(err);
                return;
              }
            } finally {
              this.stepBusy.set(false);
            }
          }
          break;
        }
        case 4: {
          const lim = this.formModel.budget.limit?.toString().trim();
          const catUid = this.formModel.budget.categoryUid?.trim();
          if (lim || catUid) {
            if (!lim || !catUid) {
              this.notifier.error('Pick a category and budget amount, or skip.');
              return;
            }
            this.stepBusy.set(true);
            try {
              await this.createBudgetRow();
            } catch (e) {
              console.error(e);
              this.notifier.error('Could not create budget.');
              return;
            } finally {
              this.stepBusy.set(false);
            }
          }
          break;
        }
        case 5: {
          const g = this.formModel.goal;
          const hasCurrent =
            g.currentAmount !== '' && g.currentAmount !== null && g.currentAmount !== undefined;
          if (g.name?.trim() || g.target !== '' || g.dueDate || hasCurrent) {
            if (!g.name?.trim() || g.target === '' || !g.dueDate || !hasCurrent) {
              this.notifier.error('Fill all goal fields or skip.');
              return;
            }
            this.stepBusy.set(true);
            try {
              await this.createGoalRow();
            } catch (e) {
              console.error(e);
              this.notifier.error('Could not create goal.');
              return;
            } finally {
              this.stepBusy.set(false);
            }
          }
          break;
        }
      }
    }

    if (this.currentPage() === this.pages().length) {
      this.stepBusy.set(true);
      try {
        await this.finalize();
      } finally {
        this.stepBusy.set(false);
      }
      return;
    }
    this.currentPage.set(this.currentPage() + 1);
  }

  private buildMemberRows(): AccountMember[] {
    return this.invitedMembers().map((m) => ({
      memberId: m.uid,
      memberDisplayName: m.displayName || m.email || 'Member',
      isJoined: false,
      isActive: false,
    }));
  }

  private async runCreateAccountAndSeedCategories(): Promise<string | null> {
    try {
      const ownerId = this.ownerUid;
      if (!ownerId) return 'Not signed in.';

      const input: AccountCreateInput = {
        name: this.formModel.account.name,
        balance: Number(this.formModel.account.balance),
        currency: this.formModel.account.currency,
        isSelected: false,
        isActive: false,
        ownerId,
        accountType: this.accountType(),
        members: this.accountType() === 'multi-user' ? this.buildMemberRows() : [],
      };

      const account = await this.accountsService.createAdditionalAccount(input);
      this.createdAccount.set(account);
      this.accountCommitted.set(true);
      await this.accountsService.selectAccount(account.id);

      await this.seedDefaultCategories(account.id, ownerId);

      const list = await this.categoriesService.getCategories();
      const key = (n: string) => n.trim().toLowerCase();
      const byName = new Map(list.map((c) => [key(c.name), c]));
      const ordered: Category[] = [];
      for (const tmpl of DEFAULT_CATEGORIES) {
        const c = byName.get(key(tmpl.name));
        if (c) ordered.push(c);
      }
      this.accountCategories.set(ordered);
      if (ordered.length > 0 && !this.formModel.budget.categoryUid) {
        this.formModel.budget.categoryUid = ordered[0].uid;
      }

      // TODO: Send notification to each invited member asking them to join this account.

      return null;
    } catch (e) {
      console.error(e);
      return 'Could not create account.';
    }
  }

  private async seedDefaultCategories(accountId: string, ownerUid: string): Promise<void> {
    const existing = await this.categoriesService.getCategories();
    const key = (n: string) => n.trim().toLowerCase();
    const byName = new Map(existing.map((c) => [key(c.name), c]));

    for (const tmpl of DEFAULT_CATEGORIES) {
      const k = key(tmpl.name);
      if (byName.has(k)) continue;
      const rowInput: CategoryCreateInput = {
        accountId,
        name: tmpl.name,
        description: tmpl.description ?? '',
        icon: tmpl.icon,
      };
      const row = await this.categoriesService.createCategory(rowInput, ownerUid);
      byName.set(k, row);
    }
  }

  private async createBudgetRow(): Promise<void> {
    const acc = this.createdAccount();
    if (!acc) throw new Error('No account');
    const cat = this.accountCategories().find((c) => c.uid === this.formModel.budget.categoryUid);
    const input: BudgetCreateInput = {
      limit: this.formModel.budget.limit,
      month: this.formModel.budget.month,
      accountId: acc.id,
      name: cat?.name ?? 'Budget',
      category: cat?.name ?? '',
      categoryId: this.formModel.budget.categoryUid?.trim() || undefined,
    };
    await this.budgetsService.createBudget(input);
  }

  private async createGoalRow(): Promise<void> {
    const acc = this.createdAccount();
    if (!acc) throw new Error('No account');
    const g = this.formModel.goal;
    const data: GoalCreateInput = {
      accountId: acc.id,
      name: g.name,
      target: g.target,
      dueDate: g.dueDate,
      currentAmount: g.currentAmount,
    };
    await this.goalsService.createGoal(data);
  }

  private async finalize(): Promise<void> {
    const acc = this.createdAccount();
    if (!acc) {
      this.notifier.error('Missing account.');
      return;
    }
    try {
      await this.accountsService.selectAccount(acc.id);
      const ordered = this.accountCategories();
      if (ordered.length > 0) {
        const b = this.formModel.budget;
        const budgetMeta =
          b.limit?.toString().trim() && b.categoryUid?.trim()
            ? { categoryUid: b.categoryUid.trim(), limit: Number(b.limit) }
            : null;
        await this.reportsService
          .createOnboardingStarterMonthlyReport(
            acc.id,
            ordered.map((c) => ({ uid: c.uid, name: c.name })),
            budgetMeta,
          )
          .catch(() => {});
      }
      this.notifier.success('Account created.');
      await this.router.navigateByUrl('/user/settings', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not activate the new account.');
    }
  }
}
