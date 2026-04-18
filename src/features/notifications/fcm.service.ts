import { Injectable, inject } from '@angular/core';
import { Messaging, getToken, onMessage, MessagePayload } from '@angular/fire/messaging';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { environment } from '../../environment/environment';

const DEVICE_ID_KEY = 'fintrackr-device-id';

@Injectable({ providedIn: 'root' })
export class FcmService {
  private readonly messaging = inject(Messaging);
  private readonly firestore = inject(Firestore);
  private readonly notifier = inject(NotifierService);

  /**
   * Requests push notification permission, gets the FCM token,
   * registers the device under `users/{userId}/devices/{deviceId}`,
   * and listens for foreground messages.
   *
   * Call this after a successful login when the user is authenticated.
   */
  async initForUser(userId: string): Promise<void> {
    if (!('Notification' in window)) return;
    if (!environment.firebase.vapidKey) return;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const token = await getToken(this.messaging, {
        vapidKey: environment.firebase.vapidKey,
      });

      if (token) {
        await this.registerDeviceToken(userId, token);
        this.listenForeground();
      }
    } catch {
      // FCM is optional — silently skip if blocked or unsupported
    }
  }

  /** Stores the device token under `users/{userId}/devices/{deviceId}`. */
  private async registerDeviceToken(userId: string, token: string): Promise<void> {
    const deviceId = this.getOrCreateDeviceId();
    const deviceRef = doc(this.firestore, `users/${userId}/devices/${deviceId}`);
    await setDoc(
      deviceRef,
      {
        token,
        platform: 'web',
        lastActiveAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  /**
   * Shows an in-app toast when a push arrives while the app is in the foreground.
   * Background messages are handled by firebase-messaging-sw.js.
   */
  private listenForeground(): void {
    onMessage(this.messaging, (payload: MessagePayload) => {
      const title = payload.notification?.title ?? 'New notification';
      const body = payload.notification?.body ?? '';
      this.notifier.show(`${title}: ${body}`);
    });
  }

  private getOrCreateDeviceId(): string {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }
}
