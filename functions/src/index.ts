/**
 * FinTrackr Cloud Functions entry point.
 *
 * Functions exported here:
 *   - onNotificationCreate   : Firestore trigger → send FCM push on new notification
 *   - scheduledDailyNotifications : Cron (daily 09:00 IST) → generate system notifications
 */

import { initializeApp } from 'firebase-admin/app';

// Initialize once at cold start
initializeApp();

export { onNotificationCreate } from './notification-trigger';
export { scheduledDailyNotifications } from './scheduled-notifications';
