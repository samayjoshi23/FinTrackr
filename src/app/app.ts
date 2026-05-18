import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { filter } from 'rxjs/operators';
import { Notifier } from '../shared/components/notifier/pages/notifier';
import { AuthService } from '../services/auth.service';
import { BiometricLockService } from '../core/services/biometric-lock.service';
import { Icon } from '../shared/components/icon/icon';
import {
  documentBootLoaderMessage,
  shouldShowDocumentBootLoader,
} from '../core/utils/document-navigation';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Notifier, CommonModule, Icon],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('LogMyMudra');

  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly biometricLock = inject(BiometricLockService);

  unlocking = signal(false);
  unlockFailed = signal(false);

  /**
   * In-app boot overlay (same visuals as `index.html`). Only for cold document load or refresh;
   * see {@link shouldShowDocumentBootLoader}. Hidden once routing leaves the `/` entry shell.
   */
  protected readonly shellLoaderVisible = signal(shouldShowDocumentBootLoader());
  protected readonly shellLoaderMessage = signal(documentBootLoaderMessage());

  constructor() {
    if (this.shellLoaderVisible()) {
      const hideLoaderTimeout = window.setTimeout(() => {
        this.shellLoaderVisible.set(false);
      }, 15_000);
      this.destroyRef.onDestroy(() => window.clearTimeout(hideLoaderTimeout));
    }

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        const path = (e.urlAfterRedirects.split('?')[0] ?? '').trim();
        // `''` / `/` is only the placeholder before `appEntryGuard` sends users to real routes.
        if (this.shellLoaderVisible() && path !== '' && path !== '/') {
          this.shellLoaderVisible.set(false);
        }

        if (path !== '/login' && path !== '/register') return;
        const u = this.auth.currentUser;
        if (!u) return;
        void this.authService.getPostAuthHomePath(u.uid).then((home) => {
          void this.router.navigateByUrl(home, { replaceUrl: true });
        });
      });

    // Check biometric lock on startup
    this.biometricLock.checkStartupLock();
    if (this.biometricLock.locked()) {
      void this.triggerBiometric();
    }
  }

  async triggerBiometric(): Promise<void> {
    this.unlocking.set(true);
    this.unlockFailed.set(false);
    try {
      const ok = await this.biometricLock.requestBiometric();
      if (ok) {
        this.biometricLock.unlock();
      } else {
        this.unlockFailed.set(true);
      }
    } catch {
      this.unlockFailed.set(true);
    } finally {
      this.unlocking.set(false);
    }
  }
}
