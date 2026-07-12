import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Snackbar } from '../shared/components/snackbar/snackbar';
import { NetworkService } from '../core/offline/network.service';
import { SyncService } from '../core/offline/sync.service';
import { BrowserBackRedirectService } from '../core/navigation/browser-back-redirect.service';

@Component({
  selector: 'app-features',
  imports: [CommonModule, RouterOutlet, Snackbar],
  templateUrl: './features.html',
  styleUrl: './features.css',
  providers: [BrowserBackRedirectService],
})
export class Features {
  readonly networkService = inject(NetworkService);
  // Also initializes the effect-based sync on online events.
  readonly syncService = inject(SyncService);
  /** Scoped to this shell; registers `popstate` + route-driven back targets. */
  private readonly _browserBackRedirect = inject(BrowserBackRedirectService);

  /** Failed-sync banner state. */
  readonly failedBannerDismissed = signal(false);
  readonly failedListOpen = signal(false);
  readonly confirmingDiscard = signal(false);
  readonly failedActionBusy = signal(false);

  async retryAllFailed(): Promise<void> {
    this.failedActionBusy.set(true);
    try {
      await this.syncService.retryAllFailed();
    } finally {
      this.failedActionBusy.set(false);
      this.confirmingDiscard.set(false);
    }
  }

  async discardAllFailed(): Promise<void> {
    if (!this.confirmingDiscard()) {
      this.confirmingDiscard.set(true);
      return;
    }
    this.failedActionBusy.set(true);
    try {
      await this.syncService.discardAllFailed();
    } finally {
      this.failedActionBusy.set(false);
      this.confirmingDiscard.set(false);
    }
  }
}
