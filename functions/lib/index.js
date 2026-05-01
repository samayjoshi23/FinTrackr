"use strict";
/**
 * FinTrackr Cloud Functions entry point.
 *
 * Functions exported here:
 *   - onNotificationCreate   : Firestore trigger → send FCM push on new notification
 *   - scheduledDailyNotifications : Cron (daily 09:00 IST) → generate system notifications
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondGroupInvite = exports.sendGroupInvite = exports.respondAccountInvite = exports.onAccountUpdated = exports.onAccountCreated = exports.scheduledDailyNotifications = exports.onNotificationCreate = void 0;
const app_1 = require("firebase-admin/app");
// Initialize once at cold start
(0, app_1.initializeApp)();
var notification_trigger_1 = require("./notification-trigger");
Object.defineProperty(exports, "onNotificationCreate", { enumerable: true, get: function () { return notification_trigger_1.onNotificationCreate; } });
var scheduled_notifications_1 = require("./scheduled-notifications");
Object.defineProperty(exports, "scheduledDailyNotifications", { enumerable: true, get: function () { return scheduled_notifications_1.scheduledDailyNotifications; } });
var account_invites_1 = require("./account-invites");
Object.defineProperty(exports, "onAccountCreated", { enumerable: true, get: function () { return account_invites_1.onAccountCreated; } });
Object.defineProperty(exports, "onAccountUpdated", { enumerable: true, get: function () { return account_invites_1.onAccountUpdated; } });
Object.defineProperty(exports, "respondAccountInvite", { enumerable: true, get: function () { return account_invites_1.respondAccountInvite; } });
var group_invites_1 = require("./group-invites");
Object.defineProperty(exports, "sendGroupInvite", { enumerable: true, get: function () { return group_invites_1.sendGroupInvite; } });
Object.defineProperty(exports, "respondGroupInvite", { enumerable: true, get: function () { return group_invites_1.respondGroupInvite; } });
//# sourceMappingURL=index.js.map