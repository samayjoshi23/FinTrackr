import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { TransactionRecord } from '../../../../shared/models/transaction.model';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Category } from '../../../categories/types';
import { CategoriesService } from '../../../../services/categories.service';
import { Account } from '../../../../shared/models/account.model';
import { TypeFilter, DateFilter, typeFilterOptions, dateFilterOptions } from '../../types';
import { TransactionDetailModal } from '../../../../shared/components/transaction-detail-modal/transaction-detail-modal';

@Component({
  selector: 'app-transaction-list',
  imports: [CommonModule, Icon, FormsModule, TransactionDetailModal],
  templateUrl: './transaction-list.html',
  styleUrl: './transaction-list.css',
})
export class TransactionList {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);
  private readonly categoriesService = inject(CategoriesService);

  private readonly pageSize = 25;
  private searchDebounceHandle?: ReturnType<typeof setTimeout>;

  readonly typeFilters = typeFilterOptions;
  readonly dateFilters = dateFilterOptions;

  currency = signal<string>('INR');
  searchQuery = signal('');
  typeFilter = signal<TypeFilter>('all');
  dateFilter = signal<DateFilter>('all');
  categoryFilter = signal<string>('all');
  isFilterActive = signal(false);

  displayedTransactions = signal<TransactionRecord[]>([]);
  totalFiltered = signal(0);
  hasMore = signal(false);
  loading = signal(true);
  loadingMore = signal(false);

  categories = signal<Category[]>([]);

  txDetailOpen = model(false);
  selectedTransaction = signal<TransactionRecord | null>(null);

  constructor() {
    effect(() => {
      if (!this.txDetailOpen()) this.selectedTransaction.set(null);
    });
  }

  /** Category chips from the catalog only (no full transaction scan). */
  readonly categoryChipLabels = computed(() => {
    const names = this.categories()
      .map((c) => c.name?.trim())
      .filter((n): n is string => !!n);
    return ['All', ...Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))];
  });

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.currency.set(account?.currency ?? 'INR');

    this.applyQueryParams();

    try {
      const cats = await this.categoriesService.getCategories();
      this.categories.set(cats ?? []);
    } catch {
      this.categories.set([]);
    }

    if (!(account?.uid ?? account?.id)) {
      this.loading.set(false);
      this.notifier.error('No account selected.');
      return;
    }

    await this.reloadFromFilters();
  }

  /** Deep links from dashboard: ?type=income|expense&date=month&category=all&advanced=1 */
  private applyQueryParams(): void {
    const q = this.route.snapshot.queryParamMap;
    const type = q.get('type');
    if (type === 'income' || type === 'expense' || type === 'all') {
      this.typeFilter.set(type);
    }
    const date = q.get('date');
    if (date === 'today' || date === 'week' || date === 'month' || date === 'all') {
      this.dateFilter.set(date);
    }
    const category = q.get('category');
    if (category === 'all') {
      this.categoryFilter.set('all');
    } else if (category?.trim()) {
      this.categoryFilter.set(category.trim());
    }
    const advanced = q.get('advanced');
    if (advanced === '1' || advanced === 'true' || advanced === 'yes') {
      this.isFilterActive.set(true);
    }
  }

  onBack() {
    this.router.navigateByUrl('/user/dashboard');
  }

  onSearchQueryChange(value: string) {
    this.searchQuery.set(value);
    clearTimeout(this.searchDebounceHandle);
    this.searchDebounceHandle = setTimeout(() => void this.reloadFromFilters(), 300);
  }

  async reloadFromFilters() {
    this.loading.set(true);
    try {
      const r = await this.transactionsService.getTransactionsPage(
        {
          search: this.searchQuery().trim() || undefined,
          type: this.typeFilter(),
          category: this.categoryFilter(),
          datePreset: this.dateFilter(),
        },
        0,
        this.pageSize,
      );
      this.displayedTransactions.set(r.items);
      this.totalFiltered.set(r.total);
      this.hasMore.set(r.hasMore);
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load transactions.');
      this.displayedTransactions.set([]);
      this.totalFiltered.set(0);
      this.hasMore.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore() {
    if (!this.hasMore() || this.loadingMore() || this.loading()) return;
    this.loadingMore.set(true);
    try {
      const offset = this.displayedTransactions().length;
      const r = await this.transactionsService.getTransactionsPage(
        {
          search: this.searchQuery().trim() || undefined,
          type: this.typeFilter(),
          category: this.categoryFilter(),
          datePreset: this.dateFilter(),
        },
        offset,
        this.pageSize,
      );
      this.displayedTransactions.update((rows) => [...rows, ...r.items]);
      this.totalFiltered.set(r.total);
      this.hasMore.set(r.hasMore);
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load more transactions.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  clearSearch() {
    this.searchQuery.set('');
    void this.reloadFromFilters();
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
    void this.reloadFromFilters();
  }

  setDateFilter(value: DateFilter) {
    this.dateFilter.set(value);
    void this.reloadFromFilters();
  }

  setCategoryChip(label: string) {
    this.categoryFilter.set(label === 'All' ? 'all' : label);
    void this.reloadFromFilters();
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

  openTransactionDetail(t: TransactionRecord): void {
    this.selectedTransaction.set(t);
    this.txDetailOpen.set(true);
  }
}
