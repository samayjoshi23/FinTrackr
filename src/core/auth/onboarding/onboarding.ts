import { Component, inject, signal } from '@angular/core';
import { AccountsService } from '../../../services/accounts.service';
import { AuthService } from '../../../services/auth.service';
import { ProfileUploadService } from '../../../services/profile-upload.service';
import { UserProfile } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Icon } from '../../../shared/components/icon/icon';
import { currencies, onboardingPages } from './types';
import { budgetSuggestionCards } from './types';
import { Router } from '@angular/router';
import {
  Account,
  AccountCreateInput,
  AccountUpdateInput,
} from '../../../shared/models/account.model';
import { BudgetsService } from '../../../services/budgets.service';
import { GoalsService } from '../../../services/goals.service';
import { BudgetCreateInput } from '../../../shared/models/budget.model';
import { GoalCreateInput } from '../../../shared/models/goal.model';
import {
  Category,
  CategoryCreateInput,
  DEFAULT_CATEGORIES,
} from '../../../features/categories/types';
import { CategoriesService } from '../../../services/categories.service';

@Component({
  selector: 'app-onboarding',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
})
export class Onboarding {
  // Inject dependencies
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly goalsService = inject(GoalsService);
  private readonly authService = inject(AuthService);
  private readonly profileUploadService = inject(ProfileUploadService);
  private readonly router = inject(Router);
  private readonly categoriesService = inject(CategoriesService);
  // State
  userProfile = signal<UserProfile | null>(null);
  formModel = {
    user: {
      fullName: '',
      profilePicture: '',
    },
    account: {
      name: '',
      balance: '',
      currency: 'INR',
    },
    budget: {
      limit: '',
      month: '',
    },
    goal: {
      name: '',
      target: '',
      dueDate: '',
      currentAmount: '',
    },
  };
  currentPage = signal<number>(1);
  pages =
    signal<{ sequence: number; title: string; description: string; skippable: boolean }[]>(
      onboardingPages,
    );
  currencies = signal<{ value: string; label: string; isSelected: boolean }[]>(currencies);
  initialText = signal<string | null>(null);
  budgetSuggestions = signal<{ amount: string; isSelected: boolean }[]>(budgetSuggestionCards);
  ids = signal<{ accountId: string; budgetId: string; goalId: string }>({
    accountId: '',
    budgetId: '',
    goalId: '',
  });

  // Getters
  get rawForm() {
    return this.formModel;
  }

  ngOnInit() {
    this.userProfile.set(
      JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null,
    );
    console.log(this.userProfile(), 'userProfile');
    this.formModel.user.fullName = String(this.userProfile()?.['displayName'] ?? '');
    this.formModel.user.profilePicture = String(this.userProfile()?.['photoURL'] ?? '');
    this.updateProfileInitialText();
  }

  onChangeProfilePicture() {
    // Open file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg, image/png';
    input.multiple = false;

    input.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];

      // Only jpg, pngs are allowed
      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        alert('Only JPG and PNG images are allowed.');
        return;
      }

      // Max size is 1MB
      if (file.size > 1024 * 1024) {
        alert('Max file size is 1MB.');
        return;
      }

      // The file will be uploaded to the server
      try {
        // Assume there is an upload service or function available
        // Replace this with your real file upload logic as needed
        const uploadUrl = await this.uploadProfilePicture(file);

        this.formModel.user.profilePicture = uploadUrl;

        // The initial text will be updated
        this.initialText.set(null);
      } catch (error) {
        alert('Failed to upload image. Please try again.');
      }
    };

    input.click();
  }

  uploadProfilePicture(file: File): Promise<string> {
    return this.profileUploadService.uploadProfilePicture(file);
  }

  updateProfileInitialText() {
    const profileUrl = this.formModel.user.profilePicture;
    const fullName = this.formModel.user.fullName;
    if (profileUrl || !fullName) {
      this.initialText.set(null);
      return;
    }

    let fullNameArr = fullName.split(' ');
    let initial = fullNameArr[0].charAt(0);
    if (fullNameArr.length > 1) {
      initial += fullNameArr[1].charAt(0);
    }
    this.initialText.set(initial.toUpperCase());
  }

  goToPreviousStep() {
    this.currentPage.set(this.currentPage() - 1);
  }

  async goToNextStep(isSkipping: boolean = false) {
    if (!isSkipping) {
      switch (this.currentPage()) {
        case 1:
          if (!this.rawForm.user.fullName) return;
          else
            this.updateUserProfile().catch((err) => console.error('updateUserProfile failed', err));
          break;
        case 2:
          if (!(this.rawForm.account.name && this.rawForm.account.balance)) return;
          break;
        case 3:
          if (!this.rawForm.account.currency) return;
          else
            this.createOrUpdateFirstAccount().catch((err) =>
              console.error('createOrUpdateFirstAccount failed', err),
            );
          break;
        case 4:
          if (!this.rawForm.budget.limit) return;
          else
            this.createOrUpdateFirstBudget().catch((err) =>
              console.error('createOrUpdateFirstBudget failed', err),
            );
          break;
        case 5:
          if (
            !(
              this.rawForm.goal.name &&
              this.rawForm.goal.target &&
              this.rawForm.goal.dueDate &&
              this.rawForm.goal.currentAmount
            )
          )
            return;
          else
            this.createOrUpdateFirstGoal().catch((err) =>
              console.error('createOrUpdateFirstGoal failed', err),
            );
          break;
      }
    }

    if (this.currentPage() === this.pages().length) {
      await this.categoriesService.addDefaultCategories(this.ids().accountId);
      const uid = this.userProfile()?.['uid'] as string;
      if (uid) {
        await this.authService.markOnboarded(uid);
      }
      this.router.navigateByUrl('/user/dashboard');
    }
    this.currentPage.set(this.currentPage() + 1);
  }

  onSelectCurrency(value: string) {
    this.formModel.account.currency = value;
    this.currencies.update((prev) =>
      prev.map((c) => ({ ...c, isSelected: c.value === value ? true : false })),
    );
  }

  onSelectBudgetSuggestion(amount: string) {
    this.formModel.budget.limit = amount;
    this.budgetSuggestions.update((prev) =>
      prev.map((s) => ({ ...s, isSelected: s.amount === amount ? true : false })),
    );
  }

  private async updateUserProfile() {
    let profile = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
    if (!profile?.['uid']) this.router.navigateByUrl('/login');
    this.userProfile.set({
      ...this.userProfile(),
      photoURL: this.rawForm.user.profilePicture,
      displayName: this.rawForm.user.fullName,
    });
    let userData: {
      uid: string;
      email: string;
      displayName: string;
      photoURL: string | null;
      provider: 'password' | 'google';
    } = {
      uid: (this.userProfile()?.['uid'] as string) ?? '',
      email: (this.userProfile()?.['email'] as string) ?? '',
      displayName: (this.userProfile()?.['displayName'] as string) ?? '',
      photoURL: (this.userProfile()?.['photoURL'] as string | null) ?? null,
      provider: (this.userProfile()?.['provider'] as 'password' | 'google') ?? 'password',
    };
    console.log(userData, 'userData');
    await this.authService.upsertUserProfile(userData);
  }

  private async createOrUpdateFirstAccount() {
    let accountForm = this.rawForm.account;
    let accountData: AccountCreateInput = {
      name: accountForm.name,
      balance: Number(accountForm.balance),
      currency: accountForm.currency,
      isSelected: true,
      isActive: true,
      members: [],
      ownerId: this.userProfile()?.['uid'] as string,
    };

    let account = null;
    if (this.ids().accountId) {
      await this.accountsService.updateAccount(
        this.ids().accountId,
        accountData as AccountUpdateInput,
      );
      account = await this.accountsService.getAccount(this.ids().accountId);
    } else {
      account = await this.accountsService.createAccount(accountData as AccountCreateInput);
      this.ids.set({ ...this.ids(), accountId: account.id });
    }
    localStorage.setItem('currentAccount', JSON.stringify(account));
  }

  private async createOrUpdateFirstBudget() {
    let budgetForm = this.rawForm.budget;
    let currentAccount = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account;
    let budgetData: BudgetCreateInput = {
      limit: budgetForm.limit,
      month: budgetForm.month,
      accountId: currentAccount.id,
    };
    if (this.ids().budgetId) {
      await this.budgetsService.updateBudget(this.ids().budgetId, {
        limit: Number(budgetForm.limit),
        month: budgetForm.month,
      });
    } else {
      let budget = await this.budgetsService.createBudget(budgetData as BudgetCreateInput);
      this.ids.set({ ...this.ids(), budgetId: budget.id });
    }
  }

  private async createOrUpdateFirstGoal() {
    let goalForm = this.rawForm.goal;
    let currentAccount = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account;
    let goalData: GoalCreateInput = {
      name: goalForm.name,
      target: goalForm.target,
      dueDate: goalForm.dueDate,
      currentAmount: goalForm.currentAmount,
      accountId: currentAccount.id,
    };
    let goal = await this.goalsService.createGoal(goalData as GoalCreateInput);
    this.ids.set({ ...this.ids(), goalId: goal.id });
  }
}
