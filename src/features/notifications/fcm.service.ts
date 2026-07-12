import { Injectable, inject } from '@angular/core';
import { Firestore, doc, deleteDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { environment } from '../../environment/environment';

const DEVICE_ID_KEY = 'fintrackr-device-id';

@Injectable({ providedIn: 'root' })
export class FcmService {
  private readonly firestore = inject(Firestore);
  private readonly notifier = inject(NotifierService);

  /** In-flight messaging module, kept so teardown can call `deleteToken`. */
  private messagingLoader:
    | Promise<typeof import('firebase/messaging') | null>
    | null = null;

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
      const mod = await this.loadMessaging();
      if (!mod) return;
      const { getMessaging, getToken, onMessage } = mod;
      const messaging = getMessaging();

      // Register the FCM service worker on its own dedicated sub-scope so it never
      // competes with the Angular service worker (ngsw-worker.js) for scope '/'.
      // If FCM took over '/', it would evict ngsw from control and break offline
      // navigation (it caches nothing), causing "This site can't be reached".
      let swRegistration: ServiceWorkerRegistration | undefined;
      if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
          scope: '/firebase-cloud-messaging-push-scope',
        });
      }

      const token = await getToken(messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: swRegistration,
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

  /**
   * Logout teardown: delete the FCM token and its `users/{uid}/devices/{deviceId}`
   * doc BEFORE `signOut()` so the outgoing session still has permission to
   * write. Without this, the previous user's device continued to receive
   * pushes intended for them even after another user signed in on the same
   * browser (both share the same origin-scoped FCM token).
   */
  async teardown(userId: string | null): Promise<void> {
    const deviceId =
      typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_ID_KEY) : null;

    // Try to delete the client-side FCM token first — best-effort, ignore errors
    // (module may never have loaded on this session).
    try {
      const mod = await this.loadMessaging();
      if (mod) {
        const { getMessaging, deleteToken } = mod;
        await deleteToken(getMessaging()).catch(() => {});
      }
    } catch {
      /* messaging not available — nothing to delete */
    }

    // Then remove the device doc so `onNotificationCreate` stops targeting it.
    if (userId && deviceId) {
      try {
        await deleteDoc(doc(this.firestore, `users/${userId}/devices/${deviceId}`));
      } catch {
        /* offline or rules changed mid-flight — non-fatal */
      }
    }

    // Reset the loader so a subsequent user's `initForUser` starts fresh.
    this.messagingLoader = null;
  }

  /** Cached lazy import of firebase/messaging (or null if the module can't load). */
  private loadMessaging(): Promise<typeof import('firebase/messaging') | null> {
    this.messagingLoader ??= import('firebase/messaging').catch(() => null);
    return this.messagingLoader;
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
