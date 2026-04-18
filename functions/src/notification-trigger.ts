/**
 * Cloud Function: onNotificationCreate
 *
 * Triggers whenever a document is written to `users/{userId}/notifications/{notificationId}`.
 * Fetches the receiver's active device tokens, sends a push via FCM, and marks isPushSent = true.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { DeviceDocument, NotificationDocument } from './types';

const MAX_TOKENS_PER_BATCH = 500;

export const onNotificationCreate = onDocumentCreated(
  'users/{userId}/notifications/{notificationId}',
  async (event) => {
    const { userId, notificationId } = event.params;
    const snap = event.data;
    if (!snap) return;

    const notification = snap.data() as NotificationDocument;

    // Skip if push already sent (e.g. re-created due to admin ops)
    if (notification.isPushSent) return;

    const db = getFirestore();
    const messaging = getMessaging();

    // ── 1. Collect device tokens ────────────────────────────────────────────
    const devicesSnap = await db.collection(`users/${userId}/devices`).get();
    const tokens: string[] = devicesSnap.docs
      .map((d) => (d.data() as DeviceDocument).token)
      .filter(Boolean);

    if (tokens.length === 0) {
      await snap.ref.update({ isPushSent: false });
      return;
    }

    // ── 2. Build FCM payload ────────────────────────────────────────────────
    const deepLink = notification.actionData?.deepLink ?? '/user/notifications';
    const actions = notification.actionData?.actions ?? [];

    const fcmData: Record<string, string> = {
      notificationId,
      type: notification.type,
      deepLink,
      ...(actions.length > 0 ? { actions: JSON.stringify(actions) } : {}),
    };

    // ── 3. Send in batches (FCM multicast max 500) ──────────────────────────
    let allSucceeded = true;

    for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_BATCH) {
      const batch = tokens.slice(i, i + MAX_TOKENS_PER_BATCH);
      const message: MulticastMessage = {
        tokens: batch,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: fcmData,
        webpush: {
          fcmOptions: { link: deepLink },
        },
        android: {
          priority: 'high',
        },
      };

      try {
        const result = await messaging.sendEachForMulticast(message);

        // Remove stale / invalid tokens
        const staleTokenIds: string[] = [];
        result.responses.forEach((resp, idx) => {
          if (
            !resp.success &&
            (resp.error?.code === 'messaging/registration-token-not-registered' ||
              resp.error?.code === 'messaging/invalid-registration-token')
          ) {
            staleTokenIds.push(batch[idx]);
          }
        });

        if (staleTokenIds.length > 0) {
          const deviceDocs = devicesSnap.docs.filter((d) =>
            staleTokenIds.includes((d.data() as DeviceDocument).token),
          );
          await Promise.all(deviceDocs.map((d) => d.ref.delete()));
        }
      } catch {
        allSucceeded = false;
      }
    }

    // ── 4. Mark as sent ────────────────────────────────────────────────────
    await snap.ref.update({ isPushSent: allSucceeded });
  },
);

/**
 * Helper: Create a notification document inside `users/{userId}/notifications`.
 * Called by other functions (scheduled, etc.) to avoid duplicating write logic.
 */
export async function createNotification(
  userId: string,
  data: Omit<NotificationDocument, 'createdAt' | 'readAt' | 'isPushSent' | 'status'>,
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection(`users/${userId}/notifications`).doc();
  await ref.set({
    ...data,
    status: 'UNREAD',
    createdAt: FieldValue.serverTimestamp(),
    readAt: null,
    isPushSent: false,
  });
}
