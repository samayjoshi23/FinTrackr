import { Injectable, signal } from '@angular/core';

const PRIVACY_KEY = 'fintrackr-privacy-prefs';
const UNLOCK_SESSION_KEY = 'fintrackr-biometric-unlocked';

@Injectable({ providedIn: 'root' })
export class BiometricLockService {
  /** True while the biometric lock overlay should be visible. */
  readonly locked = signal(false);

  /** True if the platform supports user-verifying authenticators. */
  private platformAvailable = false;

  constructor() {
    void this.initPlatformCheck();
  }

  private async initPlatformCheck(): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof (window.PublicKeyCredential as { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> })
        .isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      this.platformAvailable = await (
        window.PublicKeyCredential as {
          isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
        }
      ).isUserVerifyingPlatformAuthenticatorAvailable();
    }
  }

  isBiometricEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(PRIVACY_KEY);
      if (!raw) return false;
      const prefs = JSON.parse(raw) as { biometricLock?: boolean };
      return prefs.biometricLock === true;
    } catch {
      return false;
    }
  }

  /** Call on app startup; shows lock screen if biometric is enabled and not yet unlocked. */
  checkStartupLock(): void {
    if (!this.isBiometricEnabled()) return;

    // Already unlocked in this session (e.g. page reload within same tab)
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(UNLOCK_SESSION_KEY) === '1') {
      return;
    }

    this.locked.set(true);
  }

  /** Attempt biometric verification. Returns true if successful. */
  async requestBiometric(): Promise<boolean> {
    if (!this.platformAvailable) {
      // Fallback: platform authenticator unavailable — unlock without biometric
      // (User should be informed that biometric is not available on this device)
      return true;
    }

    try {
      // Use platform authenticator via WebAuthn (user verification)
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'required',
          rpId: window.location.hostname,
          allowCredentials: [],
        },
      } as CredentialRequestOptions);

      return credential !== null;
    } catch {
      // User cancelled or error
      return false;
    }
  }

  /** Mark the app as unlocked for this session. */
  unlock(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(UNLOCK_SESSION_KEY, '1');
    }
    this.locked.set(false);
  }
}
