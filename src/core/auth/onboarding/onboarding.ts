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
import { Account, AccountCreateInput } from '../../../shared/models/account.model';
import { BudgetsService } from '../../../services/budgets.service';
import { GoalsService } from '../../../services/goals.service';
import { BudgetCreateInput } from '../../../shared/models/budget.model';
import { Goal, GoalCreateInput } from '../../../shared/models/goal.model';
import {
  Category,
  CategoryCreateInput,
  DEFAULT_CATEGORIES,
} from '../../../features/categories/types';
import { CategoriesService } from '../../../services/categories.service';
import { ReportsService } from '../../../services/reports.service';

@Component({
  selector: 'app-onboarding',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
})
export class Onboarding {
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly goalsService = inject(GoalsService);
  private readonly authService = inject(AuthService);
  private readonly profileUploadService = inject(ProfileUploadService);
  private readonly router = inject(Router);
  private readonly categoriesService = inject(CategoriesService);
  private readonly reportsService = inject(ReportsService);

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
      categoryUid: '',
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
  ids = signal<{
    accountId: string;
    budgetId: string;
    goalId: string;
    categoryIds: string[];
  }>({
    accountId: '',
    budgetId: '',
    goalId: '',
    categoryIds: [],
  });

  onboardingCategories = signal<Category[]>([]);

  get rawForm() {
    return this.formModel;
  }

  ngOnInit() {
    this.userProfile.set(
      JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null,
    );
    this.formModel.user.fullName = String(this.userProfile()?.['displayName'] ?? '');
    this.formModel.user.profilePicture = String(this.userProfile()?.['photoURL'] ?? '');
    this.formModel.budget.month = new Date().toLocaleString('en-US', { month: 'long' });
    this.updateProfileInitialText();
    void this.bootstrapOnboardingSession();
  }

  /** Restore first-account ids and lists so back/forward does not duplicate rows. */
  private async bootstrapOnboardingSession(): Promise<void> {
    const uid = this.userProfile()?.['uid'] as string | undefined;
    if (!uid) return;

    try {
      const existingAcc = await this.accountsService.getAccount(uid);
      if (existingAcc) {
        this.patchAccountIntoSession(existingAcc);
        await this.refreshOnboardingCategoriesFromServer();
        await this.hydrateBudgetAndGoalFromServer();
      } else {
        const cached = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
        if (cached && (cached.ownerId === uid || cached.id === uid)) {
          this.patchAccountIntoSession(cached);
          await this.refreshOnboardingCategoriesFromServer();
          await this.hydrateBudgetAndGoalFromServer();
        }
      }
    } catch {
      const cached = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
      if (cached && (cached.ownerId === uid || cached.id === uid)) {
        this.patchAccountIntoSession(cached);
        await this.refreshOnboardingCategoriesFromServer();
        await this.hydrateBudgetAndGoalFromServer();
      }
    }
  }

  private patchAccountIntoSession(account: Account): void {
    this.ids.update((s) => ({ ...s, accountId: account.id }));
    localStorage.setItem('currentAccount', JSON.stringify(account));
    if (!this.formModel.account.name?.trim()) this.formModel.account.name = account.name ?? '';
    if (this.formModel.account.balance === '' || this.formModel.account.balance == null) {
      this.formModel.account.balance = String(account.balance ?? '');
    }
    if (account.currency) {
      this.formModel.account.currency = account.currency;
      this.onSelectCurrency(account.currency);
    }
  }

  /** Rebuild the ordered default-category chip list from IndexedDB / Firestore (no creates). */
  private async refreshOnboardingCategoriesFromServer(): Promise<void> {
    if (!this.ids().accountId) return;
    const list = await this.categoriesService.getCategories();
    const key = (n: string) => n.trim().toLowerCase();
    const byName = new Map(list.map((c) => [key(c.name), c]));
    const ordered: Category[] = [];
    for (const tmpl of DEFAULT_CATEGORIES) {
      const c = byName.get(key(tmpl.name));
      if (c) ordered.push(c);
    }
    if (ordered.length === 0) return;
    this.onboardingCategories.set(ordered);
    this.ids.update((s) => ({ ...s, categoryIds: ordered.map((c) => c.uid) }));
  }

  private async hydrateBudgetAndGoalFromServer(): Promise<void> {
    const budgets = await this.budgetsService.getBudgets();
    const month = this.formModel.budget.month;
    let b = budgets.find((x) => x.month === month);
    if (!b && budgets.length === 1) b = budgets[0];
    if (b) {
      this.ids.update((s) => ({ ...s, budgetId: b.id }));
      if (!this.formModel.budget.limit?.toString().trim()) {
        this.formModel.budget.limit = String(b.limit);
      }
      if (!this.formModel.budget.categoryUid?.trim() && b.categoryId) {
        this.formModel.budget.categoryUid = b.categoryId;
      }
    }

    const goals = await this.goalsService.getGoals();
    if (goals.length === 0) return;
    const sorted = [...goals].sort((a, b) => {
      const ta = a.createdAt?.getTime?.() ?? 0;
      const tb = b.createdAt?.getTime?.() ?? 0;
      return tb - ta;
    });
    const g: Goal = goals.length === 1 ? goals[0] : sorted[0];
    this.ids.update((s) => ({ ...s, goalId: g.id }));
    if (!this.formModel.goal.name?.trim()) this.formModel.goal.name = g.name;
    if (this.formModel.goal.target === '' || this.formModel.goal.target == null) {
      this.formModel.goal.target = String(g.target);
    }
    if (!this.formModel.goal.dueDate?.trim()) this.formModel.goal.dueDate = g.dueDate;
    if (this.formModel.goal.currentAmount === '' || this.formModel.goal.currentAmount == null) {
      this.formModel.goal.currentAmount = String(g.currentAmount);
    }
  }

  selectBudgetCategory(uid: string) {
    this.formModel.budget.categoryUid = uid;
  }

  onChangeProfilePicture() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg, image/png';
    input.multiple = false;

    input.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];

      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        alert('Only JPG and PNG images are allowed.');
        return;
      }

      if (file.size > 1024 * 1024) {
        alert('Max file size is 1MB.');
        return;
      }

      try {
        const uploadUrl = await this.uploadProfilePicture(file);
        this.formModel.user.profilePicture = uploadUrl;
        this.initialText.set(null);
      } catch {
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

    const fullNameArr = fullName.split(' ');
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
        case 1: {
          if (!this.rawForm.user.fullName?.trim()) return;
          const err = await this.runStepUpdateProfile();
          if (err) {
            console.error(err);
            return;
          }
          break;
        }
        case 2:
          if (!(this.rawForm.account.name?.trim() && this.rawForm.account.balance !== '')) return;
          break;
        case 3: {
          if (!this.rawForm.account.currency) return;
          const err = await this.runStepCreateAccountAndCategories();
          if (err) {
            console.error(err);
            return;
          }
          const cats = this.onboardingCategories();
          if (cats.length > 0 && !this.formModel.budget.categoryUid?.trim()) {
            this.formModel.budget.categoryUid = cats[0].uid;
          }
          break;
        }
        case 4: {
          const lim = this.formModel.budget.limit?.toString().trim();
          const catUid = this.formModel.budget.categoryUid?.trim();
          if (lim || catUid) {
            if (!lim || !catUid) return;
            const err = await this.runStepCreateBudget();
            if (err) {
              console.error(err);
              return;
            }
          }
          break;
        }
        case 5: {
          const g = this.rawForm.goal;
          const hasCurrent =
            g.currentAmount !== '' && g.currentAmount !== null && g.currentAmount !== undefined;
          if (!g.name?.trim() || g.target === '' || !g.dueDate || !hasCurrent) {
            return;
          }
          const err = await this.runStepCreateGoal();
          if (err) {
            console.error(err);
            return;
          }
          break;
        }
      }
    }

    if (this.currentPage() === this.pages().length) {
      await this.finalizeOnboarding();
      return;
    }
    this.currentPage.set(this.currentPage() + 1);
  }

  private async runStepUpdateProfile(): Promise<string | null> {
    try {
      await this.updateUserProfile();
      return null;
    } catch {
      return 'Could not update profile.';
    }
  }

  private async runStepCreateAccountAndCategories(): Promise<string | null> {
    try {
      await this.createOrUpdateFirstAccount();
      await this.seedAllDefaultCategories();
      return null;
    } catch {
      return 'Could not save account or categories.';
    }
  }

  private async runStepCreateBudget(): Promise<string | null> {
    try {
      await this.createOrUpdateFirstBudget();
      return null;
    } catch {
      return 'Could not save budget.';
    }
  }

  private async runStepCreateGoal(): Promise<string | null> {
    try {
      await this.createOrUpdateFirstGoal();
      return null;
    } catch {
      return 'Could not save goal.';
    }
  }

  private async finalizeOnboarding() {
    const uid = this.userProfile()?.['uid'] as string;
    if (uid) {
      await this.authService.markOnboarded(uid);
    }

    const accountId = this.ids().accountId;
    const cats = this.onboardingCategories();
    if (accountId && cats.length > 0) {
      const b = this.formModel.budget;
      const budgetMeta =
        b.limit && b.categoryUid ? { categoryUid: b.categoryUid, limit: Number(b.limit) } : null;
      // Last step: starter `monthlyReports` row (IDB + queue + Firestore when online) — zeros + category breakdown.
      await this.reportsService
        .createOnboardingStarterMonthlyReport(
          accountId,
          cats.map((c) => ({ uid: c.uid, name: c.name })),
          budgetMeta,
        )
        .catch(() => {});
    }

    this.router.navigateByUrl('/user/dashboard');
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

  private async updateUserProfile() {
    const profile = JSON.parse(localStorage.getItem('userProfile') ?? 'null') as UserProfile | null;
    if (!profile?.['uid']) this.router.navigateByUrl('/login');
    this.userProfile.set({
      ...this.userProfile(),
      photoURL: this.rawForm.user.profilePicture,
      displayName: this.rawForm.user.fullName,
    });
    const userData = {
      uid: (this.userProfile()?.['uid'] as string) ?? '',
      email: (this.userProfile()?.['email'] as string) ?? '',
      displayName: (this.userProfile()?.['displayName'] as string) ?? '',
      photoURL: (this.userProfile()?.['photoURL'] as string | null) ?? null,
      provider: (this.userProfile()?.['provider'] as 'password' | 'google') ?? 'password',
    };
    await this.authService.upsertUserProfile(userData);
  }

  private async createOrUpdateFirstAccount() {
    const accountForm = this.rawForm.account;
    const ownerId = this.userProfile()?.['uid'] as string;
    const accountData: AccountCreateInput = {
      name: accountForm.name,
      balance: Number(accountForm.balance),
      currency: accountForm.currency,
      isSelected: true,
      isActive: true,
      members: [],
      ownerId,
    };

    const existing = await this.accountsService.getAccount(ownerId);
    let account: Account | null = null;

    if (existing) {
      await this.accountsService.updateAccount(existing.id, {
        name: accountData.name,
        balance: Number(accountData.balance),
        currency: accountData.currency,
        isSelected: true,
        isActive: true,
      });
      account = await this.accountsService.getAccount(existing.id);
      this.ids.update((s) => ({ ...s, accountId: existing.id }));
    } else {
      account = await this.accountsService.createAccount(accountData, ownerId);
      this.ids.update((s) => ({ ...s, accountId: account!.id }));
    }
    if (account) localStorage.setItem('currentAccount', JSON.stringify(account));
  }

  /**
   * Ensures each {@link DEFAULT_CATEGORIES} name exists once for this account.
   * Already-seeded names are skipped; re-running only creates missing templates and refreshes the ordered list.
   */
  private async seedAllDefaultCategories() {
    const accountId = this.ids().accountId;
    const uid = this.userProfile()?.['uid'] as string;
    if (!accountId || !uid) return;

    const existing = await this.categoriesService.getCategories();
    const key = (n: string) => n.trim().toLowerCase();
    const byName = new Map(existing.map((c) => [key(c.name), c]));

    for (const tmpl of DEFAULT_CATEGORIES) {
      const k = key(tmpl.name);
      if (byName.has(k)) continue;
      const input: CategoryCreateInput = {
        accountId,
        name: tmpl.name,
        description: tmpl.description ?? '',
        icon: tmpl.icon,
      };
      const row = await this.categoriesService.createCategory(input, uid);
      byName.set(k, row);
    }

    const ordered: Category[] = [];
    for (const tmpl of DEFAULT_CATEGORIES) {
      const c = byName.get(key(tmpl.name));
      if (c) ordered.push(c);
    }
    this.onboardingCategories.set(ordered);
    this.ids.update((s) => ({ ...s, categoryIds: ordered.map((c) => c.uid) }));
  }

  private async createOrUpdateFirstBudget() {
    const budgetForm = this.rawForm.budget;
    const cat = this.onboardingCategories().find((c) => c.uid === budgetForm.categoryUid);
    const budgetData: BudgetCreateInput = {
      limit: budgetForm.limit,
      month: budgetForm.month,
      accountId: this.ids().accountId,
      name: cat ? `${cat.name} budget` : 'Budget',
      category: cat?.name ?? '',
      categoryId: budgetForm.categoryUid?.trim() || undefined,
    };

    let budgetId = this.ids().budgetId;
    if (!budgetId) {
      const budgets = await this.budgetsService.getBudgets();
      const month = budgetForm.month;
      const catUid = budgetForm.categoryUid?.trim();
      let match = budgets.find((b) => b.month === month && (!catUid || b.categoryId === catUid));
      if (!match) match = budgets.find((b) => b.month === month);
      if (!match && budgets.length === 1) match = budgets[0];
      if (match) budgetId = match.id;
    }

    if (budgetId) {
      await this.budgetsService.updateBudget(budgetId, {
        limit: Number(budgetForm.limit),
        month: budgetForm.month,
        name: budgetData.name,
        category: cat?.name ?? '',
        categoryId: budgetForm.categoryUid?.trim() || undefined,
      });
      this.ids.update((s) => ({ ...s, budgetId }));
    } else {
      const budget = await this.budgetsService.createBudget(budgetData as BudgetCreateInput);
      this.ids.update((s) => ({ ...s, budgetId: budget.id }));
    }
  }

  private async createOrUpdateFirstGoal() {
    const goalForm = this.rawForm.goal;
    const accountId = this.ids().accountId;
    const patch = {
      name: goalForm.name.trim(),
      target: Number(goalForm.target),
      dueDate: goalForm.dueDate,
      currentAmount: Number(goalForm.currentAmount),
    };

    let goalId: string | undefined = this.ids().goalId.trim() || undefined;
    if (!goalId) {
      const goals = await this.goalsService.getGoals();
      if (goals.length === 1) {
        goalId = goals[0].id;
      } else if (goals.length > 1) {
        const want = goalForm.name.trim().toLowerCase();
        goalId = goals.find((g) => g.name.trim().toLowerCase() === want)?.id;
        if (!goalId) {
          const sorted = [...goals].sort((a, b) => {
            const ta = a.createdAt?.getTime?.() ?? 0;
            const tb = b.createdAt?.getTime?.() ?? 0;
            return tb - ta;
          });
          goalId = sorted[0]?.id;
        }
      }
    }

    if (goalId) {
      await this.goalsService.updateGoal(goalId, patch);
      this.ids.update((s) => ({ ...s, goalId }));
    } else {
      const goalData: GoalCreateInput = {
        name: goalForm.name,
        target: goalForm.target,
        dueDate: goalForm.dueDate,
        currentAmount: goalForm.currentAmount,
        accountId,
      };
      const goal = await this.goalsService.createGoal(goalData as GoalCreateInput);
      this.ids.update((s) => ({ ...s, goalId: goal.id }));
    }
  }
}
