import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Icon } from '../icon/icon';

export interface SnackbarTab {
  name: string;
  path: string;
  icon: string;
  selected: boolean;
}

@Component({
  selector: 'app-snackbar',
  imports: [Icon],
  templateUrl: './snackbar.html',
  styleUrl: './snackbar.css',
})
export class Snackbar {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  routes = signal<{ name: string; path: string; icon: string; selected: boolean }[]>([
    {
      name: 'Home',
      path: '/user/dashboard',
      icon: 'home',
      selected: true,
    },
    {
      name: 'Transactions',
      path: '/user/transactions/list',
      icon: 'arrow-right-left',
      selected: false,
    },
    {
      name: '',
      path: '',
      icon: '',
      selected: false,
    },
    {
      name: 'Groups',
      path: '/user/groups',
      icon: 'user-group',
      selected: false,
    },
    {
      name: 'Settings',
      path: '/user/settings',
      icon: 'settings',
      selected: false,
    },
  ]);

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.syncSelection(this.router.url));

    this.syncSelection(this.router.url);
  }

  private syncSelection(rawUrl: string): void {
    const url = rawUrl.split('?')[0] ?? '';
    const home = url.includes('/dashboard');
    const transactions = url.includes('/transactions');
    const settings = url.includes('/settings');
    const groups = url.includes('/groups');

    this.routes.update((tabs) =>
      tabs.map((t) => {
        if (!t.path) return { ...t, selected: false };
        let selected = false;
        if (t.path === '/user/dashboard') selected = home;
        else if (t.path === '/user/transactions/list') selected = transactions;
        else if (t.path === '/user/settings') selected = settings;
        else if (t.path === '/user/groups') selected = groups;
        return { ...t, selected };
      }),
    );
  }

  onTabClick(path: string): void {
    if (!path?.trim()) return;
    void this.router.navigateByUrl(path);
  }

  openAddTransaction(event: Event): void {
    event.stopPropagation();
    void this.router.navigateByUrl('/user/transactions/add');
  }
}
