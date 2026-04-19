"use strict";
/**
 * Cloud Function: onNotificationCreate
 *
 * Triggers whenever a document is written to `users/{userId}/notifications/{notificationId}`.
 * Fetches the receiver's active device tokens, sends a push via FCM, and marks isPushSent = true.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onNotificationCreate = void 0;
exports.createNotification = createNotification;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const MAX_TOKENS_PER_BATCH = 500;
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
exports.onNotificationCreate = (0, firestore_1.onDocumentCreated)('users/{userId}/notifications/{notificationId}', async (event) => {
    const { userId, notificationId } = event.params;
    const snap = event.data;
    if (!snap)
        return;
    const notification = snap.data();
    if (notification.isPushSent)
        return;
    const db = (0, firestore_2.getFirestore)();
    const messaging = (0, messaging_1.getMessaging)();
    const devicesSnap = await db.collection(`users/${userId}/devices`).get();
    const tokens = devicesSnap.docs
        .map((d) => d.data().token)
        .filter(Boolean);
    if (tokens.length === 0) {
        await snap.ref.update({ isPushSent: false });
        return;
    }
    const deepLink = notification.actionData?.deepLink ?? '/user/notifications';
    const actions = notification.actionData?.actions ?? [];
    const expiresAt = notification.expiresAt;
    const expiresMs = expiresAt?.toMillis?.() ?? Date.now() + DEFAULT_EXPIRY_MS;
    const fcmData = {
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
        const message = {
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
            const staleTokenIds = [];
            result.responses.forEach((resp, idx) => {
                if (!resp.success &&
                    (resp.error?.code === 'messaging/registration-token-not-registered' ||
                        resp.error?.code === 'messaging/invalid-registration-token')) {
                    staleTokenIds.push(batch[idx]);
                }
            });
            if (staleTokenIds.length > 0) {
                const deviceDocs = devicesSnap.docs.filter((d) => staleTokenIds.includes(d.data().token));
                await Promise.all(deviceDocs.map((d) => d.ref.delete()));
            }
        }
        catch {
            allSucceeded = false;
        }
    }
    await snap.ref.update({ isPushSent: allSucceeded });
});
/**
 * Create a notification under `users/{userId}/notifications`.
 * Sets 7-day expiry unless `expiresAt` is passed.
 */
async function createNotification(userId, data) {
    const db = (0, firestore_2.getFirestore)();
    const ref = db.collection(`users/${userId}/notifications`).doc();
    const expiresAt = data.expiresAt ?? firestore_2.Timestamp.fromMillis(Date.now() + DEFAULT_EXPIRY_MS);
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
        createdAt: firestore_2.FieldValue.serverTimestamp(),
        readAt: null,
        isPushSent: false,
        expiresAt,
        priority: data.priority ?? 'normal',
        source: data.source ?? 'system',
        category: data.category ?? null,
        subtitle: data.subtitle ?? null,
    });
}
//# sourceMappingURL=notification-trigger.js.map