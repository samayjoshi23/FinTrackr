import { Component, inject, signal } from '@angular/core';
import { Icon } from '../icon/icon';
import { Router } from '@angular/router';

@Component({
  selector: 'app-snackbar',
  imports: [Icon],
  templateUrl: './snackbar.html',
  styleUrl: './snackbar.css',
})
export class Snackbar {
  readonly router = inject(Router);

  routes = signal<{ name: string; path: string; icon: string; selected: boolean }[]>([
    {
      name: 'Home',
      path: '/user/dashboard',
      icon: 'home',
      selected: true,
    },
    {
      name: 'Transactions',
      path: '/user/transactions',
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

  onChangeRoute(route: string) {
    this.routes.update((routes) => routes.map((r) => ({ ...r, selected: r.path === route })));
    this.router.navigateByUrl(route);
  }
}
