import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Category } from '../../../categories/types';
import { CategoriesService } from '../../../../services/categories.service';
import { Account } from '../../../../shared/models/account.model';

type TypeFilter = 'all' | 'income' | 'expense';
type DateFilter = 'all' | 'today' | 'week' | 'month';

@Component({
  selector: 'app-transaction-list',
  imports: [CommonModule, Icon, FormsModule],
  templateUrl: './transaction-list.html',
  styleUrl: './transaction-list.css',
})
export class TransactionList {
  private readonly router = inject(Router);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);
  private readonly categoriesService = inject(CategoriesService);

  readonly typeFilters: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
  ];

  readonly dateFilters: { value: DateFilter; label: string }[] = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
  ];

  currency = signal<string>('INR');
  searchQuery = signal('');
  typeFilter = signal<TypeFilter>('all');
  dateFilter = signal<DateFilter>('all');
  categoryFilter = signal<string>('all');
  isFilterActive = signal(false);

  transactions = signal<TransactionRecord[]>([]);
  categories = signal<Category[]>([]);

  /** Category chips: "All" + unique categories from data + catalog */
  readonly categoryChipLabels = computed(() => {
    const names = new Set<string>();
    for (const c of this.categories()) {
      if (c.name?.trim()) names.add(c.name.trim());
    }
    for (const t of this.transactions()) {
      const c = t.category?.trim();
      if (c) names.add(c);
    }
    return ['All', ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  });

  readonly filteredTransactions = computed(() => {
    let list = this.transactions();
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const hay = [t.description, t.category, t.source, t.type]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const tf = this.typeFilter();
    if (tf !== 'all') {
      list = list.filter((t) => t.type === tf);
    }

    const cf = this.categoryFilter();
    if (cf !== 'all' && cf !== 'All') {
      list = list.filter((t) => t.category === cf);
    }

    const df = this.dateFilter();
    if (df !== 'all') {
      const now = new Date();
      const start = new Date(now);
      if (df === 'today') {
        start.setHours(0, 0, 0, 0);
      } else if (df === 'week') {
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1);
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
      } else if (df === 'month') {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
      }
      list = list.filter((t) => {
        const d = t.createdAt;
        if (!d) return false;
        return d >= start && d <= now;
      });
    }

    return list;
  });

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.currency.set(account?.currency ?? 'INR');

    try {
      const cats = await this.categoriesService.getCategories(account?.id ?? account?.uid ?? '');
      this.categories.set(cats ?? []);
    } catch {
      this.categories.set([]);
    }

    if (!account?.uid) {
      this.notifier.error('No account selected.');
      return;
    }

    try {
      const rows = await this.transactionsService.getTransactionsByAccount(account.uid);
      this.transactions.set(rows);
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load transactions.');
      this.transactions.set([]);
    }
  }

  onBack() {
    this.router.navigateByUrl('/user/dashboard');
  }

  clearSearch() {
    this.searchQuery.set('');
  }

  iconForRow(t: TransactionRecord): string {
    if (t.icon) return t.icon;
    const c = (t.category ?? '').toLowerCase();
    if (c.includes('food') || c.includes('dining')) return 'utensils';
    if (c.includes('transport') || c.includes('travel')) return 'car-side';
    if (c.includes('bill') || c.includes('electric')) return 'notes';
    if (c.includes('entertain') || c.includes('stream')) return 'entertainment';
    return 'wallet';
  }

  sourceLabel(t: TransactionRecord): string {
    const s = t.source?.trim();
    if (s) return s.toUpperCase();
    return (t.category ?? '').toUpperCase();
  }

  setTypeFilter(value: TypeFilter) {
    this.typeFilter.set(value);
  }

  setDateFilter(value: DateFilter) {
    this.dateFilter.set(value);
  }

  setCategoryChip(label: string) {
    this.categoryFilter.set(label === 'All' ? 'all' : label);
  }

  isTypeChipActive(value: TypeFilter): boolean {
    return this.typeFilter() === value;
  }

  isDateChipActive(value: DateFilter): boolean {
    return this.dateFilter() === value;
  }

  isCategoryChipActive(label: string): boolean {
    const current = this.categoryFilter();
    if (label === 'All') return current === 'all';
    return current === label;
  }

  setIsFilterActive(value: boolean) {
    this.isFilterActive.set(value);
    if (!value) {
      this.clearSearch();
    }
  }
}
