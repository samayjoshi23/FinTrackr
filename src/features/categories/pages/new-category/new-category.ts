import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { CategoriesService } from '../../../../services/categories.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Account } from '../../../../shared/models/account.model';
import { CATEGORY_ICON_OPTIONS, Category, CategoryCreateInput } from '../../types';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-new-category',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './new-category.html',
  styleUrl: './new-category.css',
})
export class NewCategory {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  selectedAccount = signal<Account | null>(null);
  existingCategories = signal<Category[]>([]);
  readonly iconOptions = CATEGORY_ICON_OPTIONS;
  readonly limits = FORM_LIMITS;

  categoryName = '';
  description = '';
  selectedIcon = 'tags';
  saving = signal(false);

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    this.selectedAccount.set(account);
    try {
      const list = await this.categoriesService.getCategories();
      this.existingCategories.set(list ?? []);
      const taken = new Set((list ?? []).map((c) => (c.icon || '').trim()));
      const firstFree = CATEGORY_ICON_OPTIONS.find((id) => !taken.has(id));
      if (firstFree) this.selectedIcon = firstFree;
    } catch {
      this.existingCategories.set([]);
    }
  }

  pickIcon(iconId: string): void {
    if (this.isIconUnavailable(iconId) && this.selectedIcon !== iconId) return;
    this.selectedIcon = iconId;
  }

  /** Icon is taken by another category (for new: any existing). */
  isIconUnavailable(iconId: string): boolean {
    const inUse = this.existingCategories().some((c) => (c.icon || '').trim() === iconId);
    return inUse;
  }

  isNameDuplicate(name: string): boolean {
    const key = name.trim().toLowerCase();
    if (!key) return false;
    return this.existingCategories().some((c) => c.name.trim().toLowerCase() === key);
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
      this.notifier.error('Select an account first.');
      return;
    }
    const name = this.categoryName?.trim() ?? '';
    if (!name) {
      this.notifier.error('Enter a category name.');
      return;
    }
    if (this.isNameDuplicate(name)) {
      this.notifier.error('A category with this name already exists.');
      return;
    }
    if (this.isIconUnavailable(this.selectedIcon)) {
      this.notifier.error('That icon is already used by another category.');
      return;
    }

    const payload: CategoryCreateInput = {
      accountId: account.id ?? account.uid ?? '',
      name,
      description: (this.description?.trim() ?? '').slice(0, FORM_LIMITS.descriptionMax),
      icon: this.selectedIcon || 'tags',
    };

    this.saving.set(true);
    try {
      const created = await this.categoriesService.createCategory(payload);
      await this.reportsService.appendCategoryToCurrentMonthReport(created.uid, created.name);
      this.router.navigateByUrl('/user/categories', { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not create category.');
    } finally {
      this.saving.set(false);
    }
  }
}
