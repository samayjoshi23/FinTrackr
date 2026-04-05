import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { CategoriesService } from '../../../../services/categories.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Account } from '../../../../shared/models/account.model';
import { CATEGORY_ICON_OPTIONS, CategoryCreateInput } from '../../types';

@Component({
  selector: 'app-new-category',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './new-category.html',
  styleUrl: './new-category.css',
})
export class NewCategory {
  private readonly router = inject(Router);
  private readonly categoriesService = inject(CategoriesService);
  private readonly notifier = inject(NotifierService);

  selectedAccount = signal<Account | null>(null);
  readonly iconOptions = CATEGORY_ICON_OPTIONS;

  categoryName = '';
  description = '';
  selectedIcon = 'tags';

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.selectedAccount.set(account);
  }

  onBack() {
    this.router.navigateByUrl('/user/categories');
  }

  async onCreate() {
    const account = this.selectedAccount();
    if (!account) {
      this.notifier.error('Select an account first.');
      return;
    }
    const name = this.categoryName?.trim();
    if (!name) {
      this.notifier.error('Enter a category name.');
      return;
    }

    const payload: CategoryCreateInput = {
      accountId: account.id ?? account.uid ?? '',
      name,
      description: this.description?.trim() ?? '',
      icon: this.selectedIcon || 'tags',
    };

    try {
      await this.categoriesService.createCategory(payload);
      this.router.navigateByUrl('/user/categories');
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not create category.');
    }
  }
}
