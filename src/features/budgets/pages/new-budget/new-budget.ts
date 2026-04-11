import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { BudgetsService } from '../../../../services/budgets.service';
import { CategoriesService } from '../../../../services/categories.service';
import { Budget, BudgetCreateInput } from '../../../../shared/models/budget.model';
import { Category } from '../../../categories/types';
import { Account } from '../../../../shared/models/account.model';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-new-budget',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './new-budget.html',
  styleUrl: './new-budget.css',
})
export class NewBudget {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly notifier = inject(NotifierService);

  selectedAccount = signal<Account | null>(null);
  categories = signal<Category[]>([]);
  existingBudgets = signal<Budget[]>([]);

  saving = signal(false);
  selectedCategory = '';
  monthlyLimit: number | string = '';
  monthLabel = new Date().toLocaleString('en-US', { month: 'long' });
  readonly limits = FORM_LIMITS;

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    this.selectedAccount.set(account);

    const [cats, budgets] = await Promise.all([
      this.categoriesService.getCategories().catch(() => []),
      this.budgetsService.getBudgets().catch(() => []),
    ]);
    this.categories.set(cats ?? []);
    this.existingBudgets.set(budgets ?? []);
    const list = cats ?? [];
    const firstFree = list.find((c) => !this.categoryAlreadyBudgeted(c));
    this.selectedCategory = firstFree?.name ?? '';
  }

  private normMonth(value: string): string {
    return (value ?? '').trim().toLowerCase();
  }

  private budgetMonthMatchesNewBudget(b: Budget): boolean {
    return this.normMonth(b.month) === this.normMonth(this.monthLabel);
  }

  private budgetMatchesCategory(b: Budget, cat: Category): boolean {
    const bid = b.categoryId?.trim();
    if (bid && bid === cat.uid.trim()) return true;
    const bName = (b.category ?? '').trim().toLowerCase();
    const cName = cat.name.trim().toLowerCase();
    return bName.length > 0 && bName === cName;
  }

  /** True if this category already has a budget for the month being created. */
  categoryAlreadyBudgeted(cat: Category): boolean {
    return this.existingBudgets().some(
      (b) => this.budgetMonthMatchesNewBudget(b) && this.budgetMatchesCategory(b, cat),
    );
  }

  hasAvailableCategory(): boolean {
    return this.categories().some((c) => !this.categoryAlreadyBudgeted(c));
  }

  selectCategory(cat: Category): void {
    if (this.categoryAlreadyBudgeted(cat)) return;
    this.selectedCategory = cat.name;
  }

  onCreateNewCategory(): void {
    void this.router.navigateByUrl('/user/categories/new');
  }

  onBack() {
    this.location.back();
  }

  async onCreate(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const account = this.selectedAccount();
    if (!account) {
      this.notifier.error('No account selected.');
      return;
    }

    const catName = this.selectedCategory?.trim() ?? '';
    if (!catName) {
      this.notifier.error('Select a category.');
      return;
    }

    const categoryRow = this.categories().find(
      (c) => c.name.trim().toLowerCase() === catName.toLowerCase(),
    );
    if (!categoryRow) {
      this.notifier.error('Select a valid category.');
      return;
    }
    if (this.categoryAlreadyBudgeted(categoryRow)) {
      this.notifier.error('A budget for this category already exists this month.');
      return;
    }

    const limit = Number(this.monthlyLimit);
    if (
      !Number.isFinite(limit) ||
      limit < FORM_LIMITS.amountMin ||
      limit > FORM_LIMITS.budgetLimitMax
    ) {
      this.notifier.error(
        `Monthly limit must be between ${FORM_LIMITS.amountMin} and ${FORM_LIMITS.budgetLimitMax}.`,
      );
      return;
    }

    const payload: BudgetCreateInput = {
      accountId: account.id ?? account.uid ?? '',
      month: this.monthLabel,
      limit,
      name: catName,
      category: catName,
      categoryId: categoryRow.uid,
    };

    this.saving.set(true);
    try {
      await this.budgetsService.createBudget(payload);
      this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not create budget.');
    } finally {
      this.saving.set(false);
    }
  }
}
