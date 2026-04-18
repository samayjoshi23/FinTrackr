import { computed, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'fintrackr-notification-inbox-v1';

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

function seedInbox(): NotificationPreviewItem[] {
  return [
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
  ];
}

@Injectable({ providedIn: 'root' })
export class NotificationInboxService {
  private readonly items = signal<NotificationPreviewItem[]>(this.loadInitial());

  constructor() {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(STORAGE_KEY)) {
      this.persist();
    }
  }

  /** Same inbox used by notification list and dashboard badge. */
  readonly inbox = this.items.asReadonly();

  readonly unreadCount = computed(() => this.items().filter((n) => !n.read).length);

  readonly hasUnread = computed(() => this.unreadCount() > 0);

  markAllRead(): void {
    this.items.update((list) => list.map((n) => ({ ...n, read: true })));
    this.persist();
  }

  markRead(id: string): void {
    this.items.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    this.persist();
  }

  /** Replace inbox (e.g. after remote sync). */
  setItems(next: NotificationPreviewItem[]): void {
    this.items.set(next);
    this.persist();
  }

  private loadInitial(): NotificationPreviewItem[] {
    if (typeof localStorage === 'undefined') return seedInbox();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw?.trim()) return seedInbox();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) return seedInbox();
      return parsed as NotificationPreviewItem[];
    } catch {
      return seedInbox();
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items()));
    } catch {
      /* ignore quota / private mode */
    }
  }
}
