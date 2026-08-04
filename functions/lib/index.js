"use strict";
/**
 * FinTrackr Cloud Functions entry point.
 *
 * Functions exported here:
 *   - onNotificationCreate   : Firestore trigger → send FCM push on new notification
 *   - scheduledDailyNotifications : Cron (daily 09:00 IST) → generate system notifications
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAccountCascade = exports.deleteUserAccount = exports.onUserProfileWrite = exports.notifyGroupExpense = exports.recordTransactionForUser = exports.recordGroupSettlement = exports.respondGroupInvite = exports.sendGroupInvite = exports.resendAccountInvite = exports.removeAccountMember = exports.addAccountMember = exports.respondAccountInvite = exports.onAccountUpdated = exports.onAccountCreated = exports.scheduledDailyNotifications = exports.onNotificationCreate = void 0;
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
Object.defineProperty(exports, "addAccountMember", { enumerable: true, get: function () { return account_invites_1.addAccountMember; } });
Object.defineProperty(exports, "removeAccountMember", { enumerable: true, get: function () { return account_invites_1.removeAccountMember; } });
Object.defineProperty(exports, "resendAccountInvite", { enumerable: true, get: function () { return account_invites_1.resendAccountInvite; } });
var group_invites_1 = require("./group-invites");
Object.defineProperty(exports, "sendGroupInvite", { enumerable: true, get: function () { return group_invites_1.sendGroupInvite; } });
Object.defineProperty(exports, "respondGroupInvite", { enumerable: true, get: function () { return group_invites_1.respondGroupInvite; } });
var group_transactions_1 = require("./group-transactions");
Object.defineProperty(exports, "recordGroupSettlement", { enumerable: true, get: function () { return group_transactions_1.recordGroupSettlement; } });
Object.defineProperty(exports, "recordTransactionForUser", { enumerable: true, get: function () { return group_transactions_1.recordTransactionForUser; } });
Object.defineProperty(exports, "notifyGroupExpense", { enumerable: true, get: function () { return group_transactions_1.notifyGroupExpense; } });
var user_directory_1 = require("./user-directory");
Object.defineProperty(exports, "onUserProfileWrite", { enumerable: true, get: function () { return user_directory_1.onUserProfileWrite; } });
var delete_user_account_1 = require("./delete-user-account");
Object.defineProperty(exports, "deleteUserAccount", { enumerable: true, get: function () { return delete_user_account_1.deleteUserAccount; } });
var delete_account_cascade_1 = require("./delete-account-cascade");
Object.defineProperty(exports, "deleteAccountCascade", { enumerable: true, get: function () { return delete_account_cascade_1.deleteAccountCascade; } });
//# sourceMappingURL=index.js.map