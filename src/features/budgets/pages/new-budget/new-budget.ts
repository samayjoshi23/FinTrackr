import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { BudgetsService } from '../../../../services/budgets.service';
import { CategoriesService } from '../../../../services/categories.service';
import { ReportsService } from '../../../../services/reports.service';
import { Category } from '../../../categories/types';
import { Account } from '../../../../shared/models/account.model';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';

/**
 * Budget plan editor — sets the account's whole recurring monthly budget and the optional
 * per-category split. The leftover (`monthlyBudget − Σ category limits`) is the "Other" allowance.
 */
@Component({
  selector: 'app-new-budget',
  imports: [CommonModule, FormsModule, Icon, SignedAmountPipe],
  templateUrl: './new-budget.html',
  styleUrl: './new-budget.css',
})
export class NewBudget {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  selectedAccount = signal<Account | null>(null);
  categories = signal<Category[]>([]);

  /** True until the account + categories + plan initial reads resolve (drives skeleton). */
  loading = signal(true);
  saving = signal(false);
  monthlyLimit: number | string = '';
  /** categoryId → limit input. */
  categoryBudgets: Record<string, number | null> = {};
  monthLabel = new Date().toLocaleString('en-US', { month: 'long' });
  isAccountOwner = signal<boolean>(this.accountsService.isOwnerOfSelectedAccount() ?? false);
  readonly limits = FORM_LIMITS;

  async ngOnInit() {
    try {
      const account = await this.accountsService.getSelectedAccount();
      this.selectedAccount.set(account);

      const [cats, plan] = await Promise.all([
        this.categoriesService.getCategories().catch(() => [] as Category[]),
        this.budgetsService.getBudgetPlan().catch(() => null),
      ]);
      // Income is the allocation POOL for zero-based budgeting, not a spending category —
      // don't offer a limit row for it (the summary already treats income separately).
      const expenseCats = (cats ?? []).filter((c) => (c.name ?? '').trim().toLowerCase() !== 'income');
      this.categories.set(expenseCats);

      if (plan) {
        if (plan.monthlyBudget > 0) this.monthlyLimit = plan.monthlyBudget;
        const draft: Record<string, number | null> = {};
        for (const c of expenseCats) {
          const v = plan.categoryBudgets[c.uid];
          draft[c.uid] = v && v > 0 ? v : null;
        }
        this.categoryBudgets = draft;
      }
    } finally {
      this.loading.set(false);
    }
  }

  currency(): string {
    return this.selectedAccount()?.currency ?? 'INR';
  }

  monthlyBudgetAmount(): number {
    return Number(this.monthlyLimit) || 0;
  }

  categoryBudgetTotal(): number {
    return Object.values(this.categoryBudgets).reduce<number>(
      (acc, v) => acc + (Number(v) || 0),
      0,
    );
  }

  /** Leftover allocated to "Other" (can be negative to warn the user). */
  otherRemaining(): number {
    return this.monthlyBudgetAmount() - this.categoryBudgetTotal();
  }

  onCreateNewCategory(): void {
    void this.router.navigateByUrl('/user/categories/new');
  }

  onBack() {
    this.location.back();
  }

  async onCreate() {
    const account = this.selectedAccount();
    if (!account) {
      this.notifier.error('No account selected.');
      return;
    }

    const monthlyBudget = this.monthlyBudgetAmount();
    if (
      !Number.isFinite(monthlyBudget) ||
      monthlyBudget < FORM_LIMITS.amountMin ||
      monthlyBudget > FORM_LIMITS.budgetLimitMax
    ) {
      this.notifier.error(
        `Monthly budget must be between ${FORM_LIMITS.amountMin} and ${FORM_LIMITS.budgetLimitMax}.`,
      );
      return;
    }

    if (this.categoryBudgetTotal() > monthlyBudget) {
      this.notifier.error('Category budgets exceed your monthly budget.');
      return;
    }

    const categoryBudgets: Record<string, number> = {};
    for (const [id, v] of Object.entries(this.categoryBudgets)) {
      const n = Number(v);
      if (id && Number.isFinite(n) && n > 0) categoryBudgets[id] = n;
    }

    this.saving.set(true);
    try {
      await this.budgetsService.upsertBudgetPlan({
        accountId: account.id ?? account.uid ?? '',
        monthlyBudget,
        categoryBudgets,
      });
      // Recurring plan edit applies to this month and every future month.
      await this.reportsService.rebuildCurrentAndFutureReports().catch(() => {});
      this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not save budget.');
    } finally {
      this.saving.set(false);
    }
  }
}
