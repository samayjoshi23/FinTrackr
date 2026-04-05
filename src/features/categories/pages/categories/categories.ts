import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { CategoriesService } from '../../../../services/categories.service';
import { Account } from '../../../../shared/models/account.model';
import { Category } from '../../types';

@Component({
  selector: 'app-categories',
  imports: [CommonModule, Icon],
  templateUrl: './categories.html',
  styleUrl: './categories.css',
})
export class Categories {
  private readonly router = inject(Router);
  private readonly categoriesService = inject(CategoriesService);

  categories = signal<Category[]>([]);

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    if (!account) return;
    const accountId = account.id ?? account.uid ?? '';
    const rows = await this.categoriesService.getCategories(accountId).catch(() => []);
    this.categories.set(rows ?? []);
  }

  onNew() {
    this.router.navigateByUrl('/user/categories/new');
  }

  onEdit(c: Category) {
    this.router.navigateByUrl(`/user/categories/edit/${c.uid}`);
  }
}
