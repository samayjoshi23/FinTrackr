import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';

export interface PrivacyPreferences {
  biometricLock: boolean;
  hideBalancesByDefault: boolean;
}

const STORAGE_KEY = 'fintrackr-privacy-prefs';

const DEFAULTS: PrivacyPreferences = {
  biometricLock: false,
  hideBalancesByDefault: false,
};

function loadPrivacy(): PrivacyPreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PrivacyPreferences>) };
  } catch {
    return { ...DEFAULTS };
  }
}

@Component({
  selector: 'app-privacy-security',
  imports: [CommonModule, Icon],
  templateUrl: './privacy-security.html',
  styleUrl: './privacy-security.css',
})
export class PrivacySecurity {
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);

  readonly prefs = signal<PrivacyPreferences>(loadPrivacy());

  /** Display strings for the security info card. */
  readonly lastLoginLabel = this.formatLastLogin();
  readonly deviceLabel = this.detectDevice();

  onBack() {
    void this.router.navigateByUrl('/user/settings');
  }

  private persist() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs()));
    }
  }

  onBiometricChange(checked: boolean) {
    this.prefs.update((p) => ({ ...p, biometricLock: checked }));
    this.persist();
  }

  onHideBalancesChange(checked: boolean) {
    this.prefs.update((p) => ({ ...p, hideBalancesByDefault: checked }));
    this.persist();
  }

  onChangePassword() {
    this.notifier.show('Password changes are not wired yet. Use Firebase reset from login.');
  }

  private formatLastLogin(): string {
    if (typeof localStorage === 'undefined') return 'Recently';
    const raw = localStorage.getItem('fintrackr-last-login-label');
    if (raw) return raw;
    const now = new Date();
    const t = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `Today, ${t}`;
  }

  private detectDevice(): string {
    if (typeof navigator === 'undefined') return 'This device';
    const ua = navigator.userAgent;
    const isMac = /Mac OS X/i.test(ua);
    const isChrome = /Chrome/i.test(ua) && !/Edge/i.test(ua);
    if (isChrome && isMac) return 'Chrome on macOS';
    if (/iPhone|iPad/i.test(ua)) return 'Safari on iOS';
    return 'Web browser';
  }
}
