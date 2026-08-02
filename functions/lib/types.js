"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATION_TYPE_TO_PREF_KEY = exports.NOTIFICATION_PREF_DEFAULTS = void 0;
exports.NOTIFICATION_PREF_DEFAULTS = {
    expenseAlerts: true,
    budgetWarnings: true,
    billReminders: true,
    groupActivity: true,
    transactionUpdates: false,
};
exports.NOTIFICATION_TYPE_TO_PREF_KEY = {
    BUDGET_WARNING: 'budgetWarnings',
    BUDGET_EXCEEDED: 'budgetWarnings',
    RECURRING_DUE: 'billReminders',
    RECURRING_AUTOPAID: 'billReminders',
    GROUP_INVITE: 'groupActivity',
    PAYMENT_REQUEST: 'groupActivity',
    SETTLEMENT_DONE: 'groupActivity',
    GOAL_ACHIEVED: 'expenseAlerts',
    MONTH_END_SUMMARY: 'expenseAlerts',
    ACCOUNT_INVITE: 'transactionUpdates',
    ACCOUNT_INVITE_ACCEPTED: 'transactionUpdates',
    ACCOUNT_INVITE_DECLINED: 'transactionUpdates',
    ACCOUNT_DELETED: 'transactionUpdates',
};
//# sourceMappingURL=types.js.map