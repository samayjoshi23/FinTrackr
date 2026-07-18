import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'fintrackr-privacy-prefs';

@Injectable({ providedIn: 'root' })
export class PrivacyPreferencesService {
  readonly hideBalances = signal(false);

  constructor() {
    this.hydrate();
  }

  setHideBalances(value: boolean): void {
    this.hideBalances.set(value);
    this.persist();
  }

  private hydrate(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as { hideBalancesByDefault?: boolean };
      this.hideBalances.set(prefs.hideBalancesByDefault === true);
    } catch {
      // ignore
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      existing['hideBalancesByDefault'] = this.hideBalances();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch {
      // ignore
    }
  }
}
