import { Injectable, inject, signal } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';

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

function loadFromLocalStorage(): NotificationPreferences {
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
  private readonly firestore = inject(Firestore);
  private userId: string | null = null;

  readonly prefs = signal<NotificationPreferences>(loadFromLocalStorage());

  async init(userId: string): Promise<void> {
    this.userId = userId;
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const snap = await getDoc(userRef);
      const remote = snap.data()?.['notificationPreferences'] as Partial<NotificationPreferences> | undefined;
      if (remote) {
        const merged = { ...DEFAULTS, ...remote };
        this.prefs.set(merged);
        this.persistLocal(merged);
      }
    } catch {
      // Offline — keep localStorage values
    }
  }

  async patch(update: Partial<NotificationPreferences>): Promise<void> {
    const next = { ...this.prefs(), ...update };
    this.prefs.set(next);
    this.persistLocal(next);

    if (this.userId) {
      try {
        const userRef = doc(this.firestore, `users/${this.userId}`);
        await setDoc(userRef, { notificationPreferences: next }, { merge: true });
      } catch {
        // Offline — Firestore SDK will retry when back online
      }
    }
  }

  teardown(): void {
    this.userId = null;
    this.prefs.set({ ...DEFAULTS });
  }

  private persistLocal(prefs: NotificationPreferences): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  }
}
