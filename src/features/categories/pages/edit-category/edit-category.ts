import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { CategoriesService } from '../../../../services/categories.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { CATEGORY_ICON_OPTIONS, Category } from '../../types';

@Component({
  selector: 'app-edit-category',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './edit-category.html',
  styleUrl: './edit-category.css',
})
export class EditCategory {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly categoriesService = inject(CategoriesService);
  private readonly notifier = inject(NotifierService);

  private readonly extraIcon = signal<string | null>(null);

  readonly displayIcons = computed(() => {
    const extra = this.extraIcon();
    return extra ? [extra, ...CATEGORY_ICON_OPTIONS] : CATEGORY_ICON_OPTIONS;
  });

  categoryId = '';
  categoryName = '';
  description = '';
  selectedIcon = 'tags';
  loading = signal(true);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.categoryId = id;
    if (!id) {
      this.loading.set(false);
      this.notifier.error('Missing category.');
      this.router.navigateByUrl('/user/categories');
      return;
    }

    try {
      const row = await this.categoriesService.getCategory(id);
      if (!row) {
        this.notifier.error('Category not found.');
        this.router.navigateByUrl('/user/categories');
        return;
      }
      this.applyCategory(row);
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not load category.');
      this.router.navigateByUrl('/user/categories');
    } finally {
      this.loading.set(false);
    }
  }

  private applyCategory(c: Category) {
    this.categoryName = c.name ?? '';
    this.description = c.description ?? '';
    const icon = (c.icon || 'tags').trim() || 'tags';
    this.selectedIcon = icon;
    if (icon && !CATEGORY_ICON_OPTIONS.includes(icon)) {
      this.extraIcon.set(icon);
    }
  }

  onBack() {
    this.router.navigateByUrl('/user/categories');
  }

  async onSave() {
    const name = this.categoryName?.trim();
    if (!name) {
      this.notifier.error('Enter a category name.');
      return;
    }
    if (!this.categoryId) return;

    try {
      await this.categoriesService.updateCategory(this.categoryId, {
        name,
        description: this.description?.trim() ?? '',
        icon: this.selectedIcon || 'tags',
      });
      this.router.navigateByUrl('/user/categories');
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not update category.');
    }
  }
}
