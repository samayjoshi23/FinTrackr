import { Component, inject } from '@angular/core';
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
  // SyncService is injected to initialize it (triggers effect-based sync on online event)
  private readonly syncService = inject(SyncService);
  /** Scoped to this shell; registers `popstate` + route-driven back targets. */
  private readonly _browserBackRedirect = inject(BrowserBackRedirectService);
}
