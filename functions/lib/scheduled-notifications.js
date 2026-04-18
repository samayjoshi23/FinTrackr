"use strict";
/**
 * Cloud Function: scheduledDailyNotifications
 *
 * Runs daily at 09:00 India time.  For every user it:
 *   1. Finds recurring transactions due within the next 3 days → RECURRING_DUE
 *   2. Checks budgets: 80 % warning → BUDGET_WARNING, ≥ 100 % → BUDGET_EXCEEDED
 *   3. Checks goals: currentAmount >= targetAmount → GOAL_ACHIEVED
 *
 * Idempotency: a "cron-{date}-{type}-{entityId}" marker is written under
 * `users/{uid}/cron-markers/{markerId}` before creating the notification.
 * If the marker already exists the notification is skipped, preventing
 * duplicates when the function runs more than once on the same day.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledDailyNotifications = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const notification_trigger_1 = require("./notification-trigger");
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
exports.scheduledDailyNotifications = (0, scheduler_1.onSchedule)({
    schedule: '0 9 * * *',
    timeZone: 'Asia/Kolkata',
    timeoutSeconds: 300,
    memory: '256MiB',
}, async () => {
    const db = (0, firestore_1.getFirestore)();
    const today = new Date();
    const dateKey = today.toISOString().slice(0, 10); // YYYY-MM-DD
    // ── Fetch all users ──────────────────────────────────────────────────────
    const usersSnap = await db.collection('users').get();
    await Promise.allSettled(usersSnap.docs.map((userDoc) => processUser(db, userDoc.id, today, dateKey)));
});
async function processUser(db, userId, today, dateKey) {
    await Promise.allSettled([
        checkRecurring(db, userId, today, dateKey),
        checkBudgets(db, userId, today, dateKey),
        checkGoals(db, userId, dateKey),
    ]);
}
// ── 1. Recurring transactions due in the next 3 days ────────────────────────
async function checkRecurring(db, userId, today, dateKey) {
    const cutoff = new firestore_1.Timestamp(Math.floor((today.getTime() + THREE_DAYS_MS) / 1000), 0);
    // Query all accounts owned by this user
    const accountsSnap = await db.collection('accounts').where('ownerId', '==', userId).get();
    for (const accountDoc of accountsSnap.docs) {
        const accountId = accountDoc.id;
        const accountName = accountDoc.data()['name'] ?? 'your account';
        const recurringSnap = await db
            .collection('recurring-transactions')
            .where('uid', '==', userId)
            .where('accountId', '==', accountId)
            .where('isActive', '==', true)
            .where('nextPaymentDate', '<=', cutoff)
            .get();
        for (const rdoc of recurringSnap.docs) {
            const rec = rdoc.data();
            const markerId = `${dateKey}-RECURRING_DUE-${rdoc.id}`;
            if (await markerExists(db, userId, markerId))
                continue;
            await setMarker(db, userId, markerId);
            const dueDate = rec.nextPaymentDate.toDate();
            const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const dueLabel = daysUntil <= 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
            await (0, notification_trigger_1.createNotification)(userId, {
                type: 'RECURRING_DUE',
                title: 'Recurring payment due',
                body: `${rec.description} (${formatAmount(rec.amount)}) is due ${dueLabel} from ${accountName}.`,
                senderId: null,
                receiverId: userId,
                accountId,
                entityType: 'transaction',
                entityId: rdoc.id,
                actionData: {
                    amount: rec.amount,
                    deepLink: `/user/recurring/view/${rdoc.id}`,
                    actions: rec.isAutoPay ? [] : ['PAY', 'REMIND'],
                },
            });
        }
    }
}
// ── 2. Budget usage checks ───────────────────────────────────────────────────
async function checkBudgets(db, userId, today, dateKey) {
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const budgetsSnap = await db
        .collection('budgets')
        .where('ownerId', '==', userId)
        .where('month', '==', currentMonth)
        .get();
    for (const bdoc of budgetsSnap.docs) {
        const budget = bdoc.data();
        if (!budget.amount || budget.amount <= 0)
            continue;
        // Sum transactions for this account / category / month
        const spent = await sumTransactions(db, budget.accountId, budget.category, currentMonth);
        const usageRatio = spent / budget.amount;
        let notifType = null;
        let markerSuffix = '';
        if (usageRatio >= 1.0) {
            notifType = 'BUDGET_EXCEEDED';
            markerSuffix = 'exceeded';
        }
        else if (usageRatio >= 0.8) {
            notifType = 'BUDGET_WARNING';
            markerSuffix = 'warning';
        }
        if (!notifType)
            continue;
        const markerId = `${dateKey}-${markerSuffix}-${bdoc.id}`;
        if (await markerExists(db, userId, markerId))
            continue;
        await setMarker(db, userId, markerId);
        const percent = Math.round(usageRatio * 100);
        const isExceeded = notifType === 'BUDGET_EXCEEDED';
        await (0, notification_trigger_1.createNotification)(userId, {
            type: notifType,
            title: isExceeded ? `Budget exceeded: ${budget.category}` : `Budget warning: ${budget.category}`,
            body: isExceeded
                ? `You have spent ${formatAmount(spent)} — ${percent - 100}% over your ${formatAmount(budget.amount)} ${budget.category} budget.`
                : `You have used ${percent}% of your ${formatAmount(budget.amount)} ${budget.category} budget.`,
            senderId: null,
            receiverId: userId,
            accountId: budget.accountId,
            entityType: 'account',
            entityId: bdoc.id,
            actionData: {
                deepLink: `/user/budgets`,
            },
        });
    }
}
async function sumTransactions(db, accountId, category, month) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);
    const snap = await db
        .collection('transactions')
        .where('accountId', '==', accountId)
        .where('category', '==', category)
        .where('type', '==', 'expense')
        .where('createdAt', '>=', firestore_1.Timestamp.fromDate(start))
        .where('createdAt', '<', firestore_1.Timestamp.fromDate(end))
        .get();
    return snap.docs.reduce((sum, d) => sum + (d.data()['amount'] ?? 0), 0);
}
// ── 3. Goal achievement ──────────────────────────────────────────────────────
async function checkGoals(db, userId, dateKey) {
    const goalsSnap = await db
        .collection('goals')
        .where('ownerId', '==', userId)
        .get();
    for (const gdoc of goalsSnap.docs) {
        const goal = gdoc.data();
        if (!goal.targetAmount || goal.currentAmount < goal.targetAmount)
            continue;
        if (goal.isCompleted)
            continue; // already notified in a prior run
        const markerId = `${dateKey}-GOAL_ACHIEVED-${gdoc.id}`;
        if (await markerExists(db, userId, markerId))
            continue;
        await setMarker(db, userId, markerId);
        await (0, notification_trigger_1.createNotification)(userId, {
            type: 'GOAL_ACHIEVED',
            title: 'Goal achieved!',
            body: `You've reached your goal "${goal.name}" of ${formatAmount(goal.targetAmount)}. Congratulations!`,
            senderId: null,
            receiverId: userId,
            accountId: goal.accountId ?? null,
            entityType: 'goal',
            entityId: gdoc.id,
            actionData: {
                amount: goal.targetAmount,
                deepLink: `/user/goals`,
            },
        });
        // Mark goal as completed so we don't re-notify next day
        await gdoc.ref.update({ isCompleted: true });
    }
}
// ── Idempotency helpers ──────────────────────────────────────────────────────
async function markerExists(db, userId, markerId) {
    const snap = await db.doc(`users/${userId}/cron-markers/${markerId}`).get();
    return snap.exists;
}
async function setMarker(db, userId, markerId) {
    await db
        .doc(`users/${userId}/cron-markers/${markerId}`)
        .set({ createdAt: firestore_1.FieldValue.serverTimestamp() });
}
// ── Formatting ───────────────────────────────────────────────────────────────
function formatAmount(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(amount);
}
//# sourceMappingURL=scheduled-notifications.js.map