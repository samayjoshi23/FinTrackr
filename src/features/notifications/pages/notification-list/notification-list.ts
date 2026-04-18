import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import {
  NotificationInboxService,
  NotificationPreviewType,
} from '../../notification-inbox.service';

export type { NotificationPreviewItem, NotificationPreviewType } from '../../notification-inbox.service';

@Component({
  selector: 'app-notification-list',
  imports: [CommonModule, Icon],
  templateUrl: './notification-list.html',
  styleUrl: './notification-list.css',
})
export class NotificationList {
  private readonly router = inject(Router);
  private readonly inbox = inject(NotificationInboxService);

  readonly items = this.inbox.inbox;
  readonly unreadCount = this.inbox.unreadCount;

  onBack() {
    void this.router.navigateByUrl('/user/dashboard');
  }

  markAllRead() {
    this.inbox.markAllRead();
  }

  markRead(id: string) {
    this.inbox.markRead(id);
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
