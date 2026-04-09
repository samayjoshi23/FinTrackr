import { CommonModule } from '@angular/common';
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
  imports: [CommonModule, Icon],
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
      title: 'Expense alerts',
      description: 'Notify when a large expense is detected',
    },
    {
      key: 'budgetWarnings',
      icon: 'bullseye',
      title: 'Budget warnings',
      description: 'Alert when budget exceeds 80%',
    },
    {
      key: 'billReminders',
      icon: 'bell',
      title: 'Bill reminders',
      description: 'Remind before recurring payments are due',
    },
    {
      key: 'groupActivity',
      icon: 'user-group',
      title: 'Group activity',
      description: 'New expenses or settlements in groups',
    },
    {
      key: 'transactionUpdates',
      icon: 'credit-card',
      title: 'Transaction updates',
      description: 'Notify for every transaction',
    },
  ];

  onBack() {
    void this.router.navigateByUrl('/user/settings');
  }

  setPref(key: PrefKey, value: boolean): void {
    this.notificationPrefs.patch({ [key]: value } as Partial<NotificationPreferences>);
  }
}
