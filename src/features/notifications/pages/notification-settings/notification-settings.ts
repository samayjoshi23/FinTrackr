import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import {
  NotificationPreferences,
  NotificationPreferencesService,
} from '../../notification-preferences.service';

type PrefKey = keyof NotificationPreferences;

interface NotifSettingRow {
  key: PrefKey;
  icon: string;
  title: string;
  description: string;
}

@Component({
  selector: 'app-notification-settings',
  imports: [Icon],
  templateUrl: './notification-settings.html',
  styleUrl: './notification-settings.css',
})
export class NotificationSettings {
  private readonly router = inject(Router);
  readonly notificationPrefs = inject(NotificationPreferencesService);

  readonly rows: NotifSettingRow[] = [
    {
      key: 'expenseAlerts',
      icon: 'stock-down',
      title: 'Goals and monthly review',
      description: 'When you reach a goal, and your month in review',
    },
    {
      key: 'budgetWarnings',
      icon: 'bullseye',
      title: 'Budget alerts',
      description: 'When a category reaches 80% and when it goes over',
    },
    {
      key: 'billReminders',
      icon: 'bell',
      title: 'Bills and recurring',
      description: 'When a bill is due, and when auto-pay records one',
    },
    {
      key: 'groupActivity',
      icon: 'user-group',
      title: 'Groups',
      description: 'Group invites, payment requests and settlements',
    },
    {
      key: 'transactionUpdates',
      icon: 'credit-card',
      title: 'Shared accounts',
      description: 'Invites, and members joining or leaving',
    },
  ];

  onBack() {
    void this.router.navigateByUrl('/user/settings');
  }

  setPref(key: PrefKey, value: boolean): void {
    void this.notificationPrefs.patch({ [key]: value } as Partial<NotificationPreferences>);
  }
}
