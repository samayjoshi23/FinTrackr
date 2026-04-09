import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';

export type NotificationPreviewType =
  | 'income'
  | 'expense'
  | 'budget'
  | 'bill'
  | 'group'
  | 'transaction';

export interface NotificationPreviewItem {
  id: string;
  type: NotificationPreviewType;
  title: string;
  message: string;
  /** ISO timestamp */
  at: string;
  read: boolean;
}

@Component({
  selector: 'app-notification-list',
  imports: [CommonModule, Icon],
  templateUrl: './notification-list.html',
  styleUrl: './notification-list.css',
})
export class NotificationList {
  private readonly router = inject(Router);

  /** Demo inbox; replace with Firestore/API later. */
  readonly items = signal<NotificationPreviewItem[]>([
    {
      id: '1',
      type: 'income',
      title: 'Salary received',
      message: 'Your employer deposited ₹85,000 to Primary.',
      at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      read: false,
    },
    {
      id: '2',
      type: 'budget',
      title: 'Budget alert',
      message: 'Food spending is at 82% of this month’s budget.',
      at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      read: false,
    },
    {
      id: '3',
      type: 'bill',
      title: 'Electric bill due',
      message: '₹2,400 due in 3 days.',
      at: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString(),
      read: false,
    },
    {
      id: '4',
      type: 'group',
      title: 'New group expense',
      message: 'Alex added “Dinner split” in Weekend trip.',
      at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      read: true,
    },
    {
      id: '5',
      type: 'expense',
      title: 'Large expense',
      message: 'A ₹18,500 charge was posted on Shopping.',
      at: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
      read: true,
    },
  ]);

  readonly unreadCount = computed(() => this.items().filter((n) => !n.read).length);

  onBack() {
    void this.router.navigateByUrl('/user/dashboard');
  }

  markAllRead() {
    this.items.update((list) => list.map((n) => ({ ...n, read: true })));
  }

  markRead(id: string) {
    this.items.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  iconFor(t: NotificationPreviewType): string {
    switch (t) {
      case 'income':
        return 'stock-up';
      case 'expense':
        return 'stock-down';
      case 'budget':
        return 'bullseye';
      case 'bill':
        return 'bell';
      case 'group':
        return 'user-group';
      default:
        return 'credit-card';
    }
  }

  toneClass(t: NotificationPreviewType): string {
    switch (t) {
      case 'income':
        return 'notif-tonic--income';
      case 'expense':
        return 'notif-tonic--expense';
      case 'budget':
      case 'bill':
        return 'notif-tonic--warn';
      case 'group':
        return 'notif-tonic--group';
      default:
        return 'notif-tonic--neutral';
    }
  }

  relativeTime(iso: string): string {
    const d = new Date(iso).getTime();
    const s = Math.floor((Date.now() - d) / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return `${days}d ago`;
  }
}
