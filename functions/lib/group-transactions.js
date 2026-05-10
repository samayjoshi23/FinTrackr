"use strict";
/**
 * Cloud Functions for group expense and settlement transaction management.
 *
 * recordGroupSettlement — records an income transaction for the creditor when a debtor settles,
 *                         updates the creditor's monthly report, and notifies them.
 * recordTransactionForUser — generic callable to create a transaction under any user's account
 *                            via Admin SDK (bypasses client-side auth restrictions).
 * notifyGroupExpense    — notifies group members when a new expense is added.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyGroupExpense = exports.recordTransactionForUser = exports.recordGroupSettlement = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const notification_trigger_1 = require("./notification-trigger");
const monthly_report_sync_1 = require("./monthly-report-sync");
const TRANSACTIONS_COLLECTION = 'transactions';
// ─── Shared helpers ───────────────────────────────────────────────────────────
async function getAccountForUser(db, userId) {
    const snap = await db
        .collection('accounts')
        .where('uid', '==', userId)
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    const d = snap.docs[0];
    return { id: d.id, currency: String(d.data()['currency'] ?? 'INR') };
}
async function createTransactionForUser(db, payload) {
    const doc = {
        accountId: payload.accountId,
        amount: payload.amount,
        description: payload.description,
        category: payload.category,
        type: payload.type,
        source: payload.source,
        paidBy: payload.paidBy,
        icon: null,
        date: payload.date,
        linkedObject: payload.linkedObject ?? null,
        isRecurring: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection(TRANSACTIONS_COLLECTION).add(doc);
    return ref.id;
}
function todayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
/**
 * Called by the debtor's client after creating a settlement record.
 * 1. Finds the creditor's account.
 * 2. Creates an income transaction for the creditor.
 * 3. Updates the creditor's balance.
 * 4. Recomputes the creditor's monthly report.
 * 5. Sends a SETTLEMENT_DONE notification to the creditor.
 */
exports.recordGroupSettlement = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const data = request.data;
    const { groupId, settlementId, creditorId, debtorId, debtorName, amount, description, category, source } = data;
    if (!groupId || !settlementId || !creditorId || !debtorId || !amount) {
        throw new https_1.HttpsError('invalid-argument', 'Missing required fields.');
    }
    const db = (0, firestore_1.getFirestore)();
    // Find the creditor's primary account
    const accountSnap = await db
        .collection('accounts')
        .where('uid', '==', creditorId)
        .limit(1)
        .get();
    if (accountSnap.empty) {
        // Creditor has no account yet — skip but still notify
        await notifySettlement(creditorId, debtorName, amount, description, groupId);
        return { ok: true, skippedTransaction: true };
    }
    const creditorAccountDoc = accountSnap.docs[0];
    const creditorAccountId = creditorAccountDoc.id;
    const linkedObject = {
        type: 'group-settlement',
        id: groupId,
        recordId: settlementId,
    };
    // Create income transaction for creditor
    await createTransactionForUser(db, {
        accountId: creditorAccountId,
        amount,
        description: description || `Settlement from ${debtorName}`,
        category: category || 'Other',
        type: 'income',
        source: source || 'UPI',
        paidBy: debtorId,
        linkedObject,
        date: todayDateString(),
    });
    // Update creditor's account balance (+amount for income)
    await db
        .collection('accounts')
        .doc(creditorAccountId)
        .update({
        balance: firestore_1.FieldValue.increment(amount),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // Recompute creditor's monthly report
    const currentMonth = todayDateString().slice(0, 7); // 'YYYY-MM'
    await (0, monthly_report_sync_1.recomputeMonthlyReportForAccount)(creditorAccountId, creditorId, currentMonth).catch((e) => console.error('report recompute failed', e));
    // Notify creditor
    await notifySettlement(creditorId, debtorName, amount, description, groupId);
    return { ok: true };
});
async function notifySettlement(creditorId, debtorName, amount, description, groupId) {
    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
    }).format(amount);
    await (0, notification_trigger_1.createNotification)(creditorId, {
        type: 'SETTLEMENT_DONE',
        title: 'Settlement received',
        body: `${debtorName} settled ${formatted}${description ? ` for "${description}"` : ''}.`,
        senderId: null,
        receiverId: creditorId,
        accountId: null,
        entityType: 'group',
        entityId: groupId,
        actionData: {
            deepLink: `/user/groups/${groupId}`,
            groupId,
            amount,
        },
        category: 'group',
        source: 'social',
        priority: 'high',
    });
}
/**
 * Generic callable: creates a transaction under any user's account using Admin SDK.
 * Used for cross-user writes (e.g. creditor settling on behalf of debtor — Case 2).
 *
 * Only callable by authenticated users; caller must pass their own UID as `paidBy`.
 */
exports.recordTransactionForUser = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const data = request.data;
    const { targetUid, amount, description, category, type, source, paidBy, linkedObject, updateReport } = data;
    if (!targetUid || !amount || !type) {
        throw new https_1.HttpsError('invalid-argument', 'targetUid, amount, and type are required.');
    }
    const db = (0, firestore_1.getFirestore)();
    // Resolve account: prefer provided accountId, else find primary for targetUid
    let accountId = data.accountId ?? '';
    if (!accountId) {
        const acct = await getAccountForUser(db, targetUid);
        if (!acct) {
            throw new https_1.HttpsError('not-found', `No account found for user ${targetUid}.`);
        }
        accountId = acct.id;
    }
    await createTransactionForUser(db, {
        accountId,
        amount,
        description,
        category,
        type,
        source,
        paidBy,
        linkedObject,
        date: todayDateString(),
    });
    // Update balance
    const balanceDelta = type === 'income' ? amount : -amount;
    await db
        .collection('accounts')
        .doc(accountId)
        .update({
        balance: firestore_1.FieldValue.increment(balanceDelta),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // Optionally recompute monthly report
    if (updateReport) {
        const currentMonth = todayDateString().slice(0, 7);
        await (0, monthly_report_sync_1.recomputeMonthlyReportForAccount)(accountId, targetUid, currentMonth).catch((e) => console.error('report recompute failed', e));
    }
    return { ok: true };
});
/**
 * Sends a notification to all group members (except the payer) about a new expense.
 */
exports.notifyGroupExpense = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const data = request.data;
    const { groupId, expenseId, description, amount, paidByName, memberIds } = data;
    if (!groupId || !memberIds?.length) {
        return { ok: true, skipped: true };
    }
    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
    }).format(amount);
    await Promise.allSettled(memberIds.map((uid) => (0, notification_trigger_1.createNotification)(uid, {
        type: 'PAYMENT_REQUEST',
        title: 'New group expense',
        body: `${paidByName} added "${description}" for ${formatted}.`,
        senderId: request.auth.uid,
        receiverId: uid,
        accountId: null,
        entityType: 'group-expense',
        entityId: expenseId,
        actionData: {
            deepLink: `/user/groups/${groupId}`,
            groupId,
            amount,
        },
        category: 'group',
        source: 'social',
        priority: 'normal',
    })));
    return { ok: true };
});
//# sourceMappingURL=group-transactions.js.map