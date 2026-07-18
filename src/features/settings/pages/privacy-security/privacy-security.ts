import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { Modal } from '../../../../shared/components/modal/modal';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { AccountDeletionService } from '../../../../services/account-deletion.service';
import { PrivacyPreferencesService } from '../../../../core/services/privacy-preferences.service';

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
  imports: [CommonModule, FormsModule, Icon, ConfirmPrompt, Modal],
  templateUrl: './privacy-security.html',
  styleUrl: './privacy-security.css',
})
export class PrivacySecurity {
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);
  private readonly deletionService = inject(AccountDeletionService);
  private readonly privacyPrefs = inject(PrivacyPreferencesService);

  readonly prefs = signal<PrivacyPreferences>(loadPrivacy());

  readonly lastLoginLabel = this.formatLastLogin();
  readonly deviceLabel = this.detectDevice();

  readonly showDeleteConfirm = signal(false);
  readonly showReauthDialog = signal(false);
  readonly isDeletingAccount = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly reauthPassword = signal('');
  readonly authProvider = this.deletionService.getAuthProvider();

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
    this.privacyPrefs.setHideBalances(checked);
  }

  onChangePassword() {
    void this.router.navigateByUrl('/reset-password');
  }

  onDeleteAccountClick() {
    this.showDeleteConfirm.set(true);
  }

  onDeleteConfirmed(confirmed: boolean) {
    this.showDeleteConfirm.set(false);
    if (confirmed) {
      this.deleteError.set(null);
      this.reauthPassword.set('');
      this.showReauthDialog.set(true);
    }
  }

  async onReauthAndDelete() {
    this.isDeletingAccount.set(true);
    this.deleteError.set(null);

    try {
      await this.deletionService.reauthenticate(
        this.authProvider === 'password' ? this.reauthPassword() : undefined,
      );
      await this.deletionService.deleteAccount();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      if (message.includes('wrong-password') || message.includes('invalid-credential')) {
        this.deleteError.set('Incorrect password. Please try again.');
      } else if (message.includes('popup-closed-by-user')) {
        this.deleteError.set('Google sign-in was cancelled.');
      } else if (message.includes('too-many-requests')) {
        this.deleteError.set('Too many attempts. Please wait and try again.');
      } else {
        this.deleteError.set(message);
      }
      this.isDeletingAccount.set(false);
    }
  }

  onReauthCancel() {
    this.showReauthDialog.set(false);
    this.deleteError.set(null);
    this.reauthPassword.set('');
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
