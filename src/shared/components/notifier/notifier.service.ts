import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environment/environment';
import { NotifierSeverity } from './types';

export type NotificationSeverity =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'warning'
  | 'error'
  | 'success';

export interface NotificationItem {
  id: number;
  message: string;
  severity: NotificationSeverity;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class NotifierService {
  private nextId = 1;
  readonly notifications = signal<NotificationItem[]>([]);

  show(message: string, severity: NotifierSeverity = NotifierSeverity.PRIMARY) {
    const id = this.nextId++;
    const notification: NotificationItem = {
      id,
      message,
      severity,
      durationMs: environment.notifier.durationMs,
    };

    this.notifications.update((items) => [...items, notification]);

    window.setTimeout(() => this.dismiss(id), notification.durationMs);
  }

  success(message: string) {
    this.show(message, NotifierSeverity.SUCCESS);
  }

  error(message: string) {
    this.show(message, NotifierSeverity.ERROR);
  }

  dismiss(id: number) {
    this.notifications.update((items) => items.filter((item) => item.id !== id));
  }
}
