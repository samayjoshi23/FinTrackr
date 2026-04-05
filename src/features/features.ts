import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Snackbar } from '../shared/components/snackbar/snackbar';
import { NetworkService } from '../core/offline/network.service';
import { SyncService } from '../core/offline/sync.service';

@Component({
  selector: 'app-features',
  imports: [CommonModule, RouterOutlet, Snackbar],
  templateUrl: './features.html',
  styleUrl: './features.css',
})
export class Features {
  readonly networkService = inject(NetworkService);
  // SyncService is injected to initialize it (triggers effect-based sync on online event)
  private readonly syncService = inject(SyncService);
}
