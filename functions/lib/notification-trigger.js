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
exports.onNotificationCreate = (0, firestore_1.onDocumentCreated)('users/{userId}/notifications/{notificationId}', async (event) => {
    const { userId, notificationId } = event.params;
    const snap = event.data;
    if (!snap)
        return;
    const notification = snap.data();
    // Skip if push already sent (e.g. re-created due to admin ops)
    if (notification.isPushSent)
        return;
    const db = (0, firestore_2.getFirestore)();
    const messaging = (0, messaging_1.getMessaging)();
    // ── 1. Collect device tokens ────────────────────────────────────────────
    const devicesSnap = await db.collection(`users/${userId}/devices`).get();
    const tokens = devicesSnap.docs
        .map((d) => d.data().token)
        .filter(Boolean);
    if (tokens.length === 0) {
        await snap.ref.update({ isPushSent: false });
        return;
    }
    // ── 2. Build FCM payload ────────────────────────────────────────────────
    const deepLink = notification.actionData?.deepLink ?? '/user/notifications';
    const actions = notification.actionData?.actions ?? [];
    const fcmData = {
        notificationId,
        type: notification.type,
        deepLink,
        ...(actions.length > 0 ? { actions: JSON.stringify(actions) } : {}),
    };
    // ── 3. Send in batches (FCM multicast max 500) ──────────────────────────
    let allSucceeded = true;
    for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_BATCH) {
        const batch = tokens.slice(i, i + MAX_TOKENS_PER_BATCH);
        const message = {
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
    // ── 4. Mark as sent ────────────────────────────────────────────────────
    await snap.ref.update({ isPushSent: allSucceeded });
});
/**
 * Helper: Create a notification document inside `users/{userId}/notifications`.
 * Called by other functions (scheduled, etc.) to avoid duplicating write logic.
 */
async function createNotification(userId, data) {
    const db = (0, firestore_2.getFirestore)();
    const ref = db.collection(`users/${userId}/notifications`).doc();
    await ref.set({
        ...data,
        status: 'UNREAD',
        createdAt: firestore_2.FieldValue.serverTimestamp(),
        readAt: null,
        isPushSent: false,
    });
}
//# sourceMappingURL=notification-trigger.js.map