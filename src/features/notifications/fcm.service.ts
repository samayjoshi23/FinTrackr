import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { environment } from '../../environment/environment';

const DEVICE_ID_KEY = 'fintrackr-device-id';

@Injectable({ providedIn: 'root' })
export class FcmService {
  private readonly firestore = inject(Firestore);
  private readonly notifier = inject(NotifierService);

  /**
   * Requests push notification permission, gets the FCM token,
   * registers the device under `users/{userId}/devices/{deviceId}`,
   * and listens for foreground messages.
   *
   * The firebase/messaging module is loaded lazily on first call so it
   * never contributes to the initial bundle.
   */
  async initForUser(userId: string): Promise<void> {
    if (!('Notification' in window)) return;
    if (!environment.firebase.vapidKey) return;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Lazy-load the Messaging SDK — keeps it out of the initial chunk
      const { getMessaging, getToken, onMessage } = await import('firebase/messaging');
      const messaging = getMessaging();

      const token = await getToken(messaging, {
        vapidKey: environment.firebase.vapidKey,
      });

      if (token) {
        await this.registerDeviceToken(userId, token);
        onMessage(messaging, (payload) => {
          const title = payload.notification?.title ?? 'New notification';
          const body = payload.notification?.body ?? '';
          this.notifier.show(`${title}: ${body}`);
        });
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

  private getOrCreateDeviceId(): string {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }
}
