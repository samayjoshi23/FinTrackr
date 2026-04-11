import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { AccountsService } from '../../../../services/accounts.service';
import { CategoriesService } from '../../../../services/categories.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Category } from '../../types';

@Component({
  selector: 'app-categories',
  imports: [CommonModule, Icon, ConfirmPrompt],
  templateUrl: './categories.html',
  styleUrl: './categories.css',
})
export class Categories {
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  categories = signal<Category[]>([]);
  deletePromptOpen = signal(false);
  deletingCategory = signal<Category | null>(null);
  deleting = signal(false);

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    if (!account) return;
    const rows = await this.categoriesService.getCategories().catch(() => []);
    this.categories.set(rows ?? []);
  }

  onNew() {
    this.router.navigateByUrl('/user/categories/new');
  }

  onEdit(c: Category) {
    this.router.navigateByUrl(`/user/categories/edit/${c.uid}`);
  }

  onDeleteRequest(event: Event, c: Category): void {
    event.stopPropagation();
    this.deletingCategory.set(c);
    this.deletePromptOpen.set(true);
  }

  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.deletingCategory.set(null);
      return;
    }
    const cat = this.deletingCategory();
    if (!cat) return;

    this.deleting.set(true);
    try {
      await this.categoriesService.deleteCategory(cat.uid);
      await this.reportsService.rebuildCurrentMonthReport();
      this.categories.update((list) => list.filter((c) => c.uid !== cat.uid));
      this.notifier.success('Category deleted.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not delete category.');
    } finally {
      this.deleting.set(false);
      this.deletingCategory.set(null);
    }
  }
}
