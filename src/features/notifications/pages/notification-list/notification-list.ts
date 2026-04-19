import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { NotificationService } from '../../notification.service';
import { AccountsService } from '../../../../services/accounts.service';
import { Account } from '../../../../shared/models/account.model';
import { AppNotification, NotificationAction, NotificationType } from '../../../../shared/models/notification.model';
import { AccountInviteService } from '../../../accounts/account-invite.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';

@Component({
  selector: 'app-notification-list',
  imports: [CommonModule, Icon],
  templateUrl: './notification-list.html',
  styleUrl: './notification-list.css',
})
export class NotificationList implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  readonly notifService = inject(NotificationService);
  private readonly accountsService = inject(AccountsService);
  private readonly accountInvite = inject(AccountInviteService);
  private readonly notifier = inject(NotifierService);

  readonly accounts = signal<Account[]>([]);
  readonly userId = signal<string>('');

  async ngOnInit(): Promise<void> {
    const uid = this.auth.currentUser?.uid ?? '';
    this.userId.set(uid);

    await this.notifService.init(uid);

    const accs = await this.accountsService.getAccounts();
    this.accounts.set(accs);
  }

  // ─── Computed helpers (delegate to service signals) ───────────────────────

  get items() { return this.notifService.filteredNotifications; }
  get unreadCount() { return this.notifService.unreadCount; }
  get loading() { return this.notifService.loading; }
  get hasMore() { return this.notifService.hasMore; }
  get activeFilter() { return this.notifService.activeFilter; }

  // ─── Actions ──────────────────────────────────────────────────────────────

  onBack(): void {
    void this.router.navigateByUrl('/user/dashboard');
  }

  markAllRead(): void {
    void this.notifService.markAllAsRead();
  }

  setFilter(filter: 'all' | string): void {
    this.notifService.setFilter(filter);
  }

  loadMore(): void {
    this.notifService.loadMore();
  }

  onNotificationClick(n: AppNotification): void {
    if (n.status === 'UNREAD') {
      void this.notifService.markAsRead(n.id);
    }
    const deepLink = n.actionData?.deepLink;
    if (deepLink) {
      void this.router.navigateByUrl(deepLink);
    }
  }

  onAction(event: Event, n: AppNotification, action: NotificationAction): void {
    event.stopPropagation();
    void this.notifService.markAsActionTaken(n.id);

    switch (action) {
      case 'PAY': {
        const link = n.actionData?.deepLink;
        if (link) void this.router.navigateByUrl(link);
        break;
      }
      case 'MARK_PAID': {
        const link = n.actionData?.deepLink;
        if (link) void this.router.navigateByUrl(link);
        break;
      }
      case 'ACCEPT':
      case 'REJECT': {
        if (n.type !== 'ACCOUNT_INVITE') break;
        const accountId = n.accountId ?? n.actionData?.accountId ?? n.entityId;
        if (!accountId) {
          this.notifier.error('Missing account for this invite.');
          break;
        }
        void this.accountInvite
          .respond(accountId, action === 'ACCEPT')
          .then(() => this.notifier.success(action === 'ACCEPT' ? 'You joined the account.' : 'Invite declined.'))
          .catch((e) => {
            console.error(e);
            this.notifier.error(e instanceof Error ? e.message : 'Could not update the invite.');
          });
        break;
      }
      case 'REMIND':
        break;
    }
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────

  iconFor(type: NotificationType): string {
    switch (type) {
      case 'PAYMENT_SENT':
      case 'PAYMENT_REQUEST':
      case 'PAYMENT_REMINDER':
      case 'SETTLEMENT_DONE':
        return 'credit-card';
      case 'GROUP_INVITE':
      case 'ACCOUNT_INVITE':
        return 'user-group';
      case 'RECURRING_DUE':
      case 'RECURRING_AUTOPAID':
        return 'arrow-refresh';
      case 'BUDGET_EXCEEDED':
      case 'BUDGET_WARNING':
        return 'bullseye';
      case 'GOAL_ACHIEVED':
        return 'stock-up';
      case 'MONTH_END_SUMMARY':
        return 'bar-graph';
      case 'ACCOUNT_INVITE_ACCEPTED':
      case 'ACCOUNT_INVITE_DECLINED':
        return 'user-group';
      default:
        return 'bell';
    }
  }

  toneClass(type: NotificationType): string {
    switch (type) {
      case 'PAYMENT_SENT':
      case 'GOAL_ACHIEVED':
      case 'SETTLEMENT_DONE':
        return 'notif-tonic--income';
      case 'BUDGET_EXCEEDED':
      case 'PAYMENT_REQUEST':
      case 'PAYMENT_REMINDER':
        return 'notif-tonic--expense';
      case 'BUDGET_WARNING':
      case 'RECURRING_DUE':
        return 'notif-tonic--warn';
      case 'GROUP_INVITE':
      case 'ACCOUNT_INVITE':
      case 'ACCOUNT_INVITE_ACCEPTED':
      case 'ACCOUNT_INVITE_DECLINED':
        return 'notif-tonic--group';
      case 'MONTH_END_SUMMARY':
        return 'notif-tonic--income';
      default:
        return 'notif-tonic--neutral';
    }
  }

  actionLabel(action: NotificationAction): string {
    switch (action) {
      case 'ACCEPT': return 'Accept';
      case 'REJECT': return 'Decline';
      case 'PAY':    return 'Pay';
      case 'REMIND': return 'Remind';
      case 'MARK_PAID': return 'Mark paid';
    }
  }

  actionTone(action: NotificationAction): string {
    switch (action) {
      case 'ACCEPT': return 'action-btn--accept';
      case 'PAY': return 'action-btn--accept';
      case 'MARK_PAID': return 'action-btn--accept';
      case 'REJECT': return 'action-btn--reject';
      case 'REMIND': return 'action-btn--neutral';
    }
  }

  accountName(accountId: string | null): string {
    if (!accountId) return '';
    return this.accounts().find((a) => a.id === accountId)?.name ?? '';
  }

  relativeTime(date: Date | null): string {
    if (!date) return '';
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}
