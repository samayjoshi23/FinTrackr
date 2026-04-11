import { CommonModule, Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { CategoriesService } from '../../../../services/categories.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { CATEGORY_ICON_OPTIONS, Category } from '../../types';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-edit-category',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './edit-category.html',
  styleUrl: './edit-category.css',
})
export class EditCategory {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly categoriesService = inject(CategoriesService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  private readonly extraIcon = signal<string | null>(null);
  allCategories = signal<Category[]>([]);

  readonly displayIcons = computed(() => {
    const extra = this.extraIcon();
    return extra ? [extra, ...CATEGORY_ICON_OPTIONS] : CATEGORY_ICON_OPTIONS;
  });

  readonly limits = FORM_LIMITS;

  categoryId = '';
  categoryName = '';
  description = '';
  selectedIcon = 'tags';
  loading = signal(true);
  saving = signal(false);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.categoryId = id;
    if (!id) {
      this.loading.set(false);
      this.notifier.error('Missing category.');
      this.router.navigateByUrl('/user/categories', { replaceUrl: true });
      return;
    }

    try {
      const [row, all] = await Promise.all([
        this.categoriesService.getCategory(id),
        this.categoriesService.getCategories().catch(() => []),
      ]);
      this.allCategories.set(all ?? []);
      if (!row) {
        this.notifier.error('Category not found.');
        this.router.navigateByUrl('/user/categories', { replaceUrl: true });
        return;
      }
      this.applyCategory(row);
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not load category.');
      this.router.navigateByUrl('/user/categories', { replaceUrl: true });
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

  /** Another category (not this one) already uses this icon. */
  isIconUnavailable(iconId: string): boolean {
    return this.allCategories().some(
      (c) => c.uid !== this.categoryId && (c.icon || '').trim() === iconId,
    );
  }

  isNameDuplicate(name: string): boolean {
    const key = name.trim().toLowerCase();
    if (!key) return false;
    return this.allCategories().some(
      (c) => c.uid !== this.categoryId && c.name.trim().toLowerCase() === key,
    );
  }

  pickIcon(iconId: string): void {
    if (this.isIconUnavailable(iconId) && this.selectedIcon !== iconId) return;
    this.selectedIcon = iconId;
  }

  onBack() {
    this.location.back();
  }

  async onSave(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const name = this.categoryName?.trim() ?? '';
    if (!name) {
      this.notifier.error('Enter a category name.');
      return;
    }
    if (!this.categoryId) return;
    if (this.isNameDuplicate(name)) {
      this.notifier.error('Another category already uses this name.');
      return;
    }
    if (this.isIconUnavailable(this.selectedIcon)) {
      this.notifier.error('That icon is already used by another category.');
      return;
    }

    this.saving.set(true);
    try {
      await this.categoriesService.updateCategory(this.categoryId, {
        name,
        description: (this.description?.trim() ?? '').slice(0, FORM_LIMITS.descriptionMax),
        icon: this.selectedIcon || 'tags',
      });
      await this.reportsService.patchCategoryNameInCurrentMonthReport(this.categoryId, name);
      this.router.navigateByUrl('/user/categories', { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not update category.');
    } finally {
      this.saving.set(false);
    }
  }
}
