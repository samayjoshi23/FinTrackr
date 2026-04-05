import { Injectable, inject, signal, NgZone } from '@angular/core';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { NotifierSeverity } from '../../shared/components/notifier/types';

@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly notifier = inject(NotifierService);
  private readonly zone = inject(NgZone);

  readonly isOnline = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  readonly pendingSyncCount = signal<number>(0);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.zone.run(() => {
          this.isOnline.set(true);
          this.notifier.success('You are back online.');
        });
      });

      window.addEventListener('offline', () => {
        this.zone.run(() => {
          this.isOnline.set(false);
          this.notifier.show(
            'You are offline. Changes will sync when connected.',
            NotifierSeverity.WARNING
          );
        });
      });
    }
  }
}
