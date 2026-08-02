import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
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
  protected readonly title = signal('FinTrackr');

  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly swUpdate = inject(SwUpdate);
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

    this.wireServiceWorkerAutoUpdate();
  }

  /**
   * Silent auto-refresh when a new build lands. `SwUpdate.versionUpdates` fires
   * `VERSION_READY` once ngsw has finished downloading the new bundle in the
   * background. We activate + reload immediately — the user picks the change up
   * without any prompt. A 60s poll keeps long-open tabs current.
   *
   * `isEnabled` is false in dev mode (see `provideServiceWorker` in app.config.ts),
   * so this whole path is a no-op locally.
   */
  private wireServiceWorkerAutoUpdate(): void {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(async () => {
        try {
          await this.swUpdate.activateUpdate();
        } catch {
          /* activation can race the reload — non-fatal */
        }
        location.reload();
      });

    const pollHandle = window.setInterval(() => {
      void this.swUpdate.checkForUpdate().catch(() => {
        /* offline / network hiccup — try again next tick */
      });
    }, 60_000);
    this.destroyRef.onDestroy(() => window.clearInterval(pollHandle));
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
