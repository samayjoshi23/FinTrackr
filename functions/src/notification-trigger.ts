/**
 * Cloud Function: onNotificationCreate
 *
 * Triggers whenever a document is written to `users/{userId}/notifications/{notificationId}`.
 * Fetches the receiver's active device tokens, sends a push via FCM, and marks isPushSent = true.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { DeviceDocument, NotificationDocument } from './types';

const MAX_TOKENS_PER_BATCH = 500;
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export const onNotificationCreate = onDocumentCreated(
  'users/{userId}/notifications/{notificationId}',
  async (event) => {
    const { userId, notificationId } = event.params;
    const snap = event.data;
    if (!snap) return;

    const notification = snap.data() as NotificationDocument;

    if (notification.isPushSent) return;

    const db = getFirestore();
    const messaging = getMessaging();

    const devicesSnap = await db.collection(`users/${userId}/devices`).get();
    const tokens: string[] = devicesSnap.docs
      .map((d) => (d.data() as DeviceDocument).token)
      .filter(Boolean);

    if (tokens.length === 0) {
      await snap.ref.update({ isPushSent: false });
      return;
    }

    const deepLink = notification.actionData?.deepLink ?? '/user/notifications';
    const actions = notification.actionData?.actions ?? [];
    const expiresAt = notification.expiresAt as Timestamp | undefined;
    const expiresMs = expiresAt?.toMillis?.() ?? Date.now() + DEFAULT_EXPIRY_MS;

    const fcmData: Record<string, string> = {
      notificationId,
      type: notification.type,
      deepLink,
      priority: notification.priority ?? 'normal',
      source: notification.source ?? 'system',
      ...(notification.category ? { category: notification.category } : {}),
      ...(notification.subtitle ? { subtitle: notification.subtitle } : {}),
      expiresAtMs: String(expiresMs),
      ...(actions.length > 0 ? { actions: JSON.stringify(actions) } : {}),
      ...(notification.actionData?.recurringId
        ? { recurringId: notification.actionData.recurringId }
        : {}),
      ...(notification.actionData?.accountId
        ? { actionAccountId: notification.actionData.accountId }
        : {}),
    };

    let allSucceeded = true;

    for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_BATCH) {
      const batch = tokens.slice(i, i + MAX_TOKENS_PER_BATCH);
      const message: MulticastMessage = {
        tokens: batch,
        notification: {
          title: notification.title,
          body: notification.subtitle ? `${notification.body}\n${notification.subtitle}` : notification.body,
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

        const staleTokenIds: string[] = [];
        result.responses.forEach((resp, idx) => {
          if (
            !resp.success &&
            (resp.error?.code === 'messaging/registration-token-not-registered' ||
              resp.error?.code === 'messaging/invalid-registration-token')
          ) {
            staleTokenIds.push(batch[idx]!);
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

    await snap.ref.update({ isPushSent: allSucceeded });
  },
);

/**
 * Create a notification under `users/{userId}/notifications`.
 * Sets 7-day expiry unless `expiresAt` is passed.
 */
export async function createNotification(
  userId: string,
  data: Omit<NotificationDocument, 'createdAt' | 'readAt' | 'isPushSent' | 'status' | 'expiresAt'> &
    Partial<Pick<NotificationDocument, 'expiresAt'>>,
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection(`users/${userId}/notifications`).doc();
  const expiresAt = data.expiresAt ?? Timestamp.fromMillis(Date.now() + DEFAULT_EXPIRY_MS);

  await ref.set({
    type: data.type,
    title: data.title,
    body: data.body,
    senderId: data.senderId ?? null,
    receiverId: data.receiverId,
    accountId: data.accountId ?? null,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    actionData: data.actionData ?? {},
    status: 'UNREAD',
    createdAt: FieldValue.serverTimestamp(),
    readAt: null,
    isPushSent: false,
    expiresAt,
    priority: data.priority ?? 'normal',
    source: data.source ?? 'system',
    category: data.category ?? null,
    subtitle: data.subtitle ?? null,
  });
}
