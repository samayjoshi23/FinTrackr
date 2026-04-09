import { Injectable, signal } from '@angular/core';

export interface NotificationPreferences {
  expenseAlerts: boolean;
  budgetWarnings: boolean;
  billReminders: boolean;
  groupActivity: boolean;
  transactionUpdates: boolean;
}

const STORAGE_KEY = 'fintrackr-notification-prefs';

const DEFAULTS: NotificationPreferences = {
  expenseAlerts: true,
  budgetWarnings: true,
  billReminders: true,
  groupActivity: true,
  transactionUpdates: false,
};

function loadPrefs(): NotificationPreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<NotificationPreferences>;
    return { ...DEFAULTS, ...p };
  } catch {
    return { ...DEFAULTS };
  }
}

@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  readonly prefs = signal<NotificationPreferences>(loadPrefs());

  patch(update: Partial<NotificationPreferences>): void {
    const next = { ...this.prefs(), ...update };
    this.prefs.set(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }
}
