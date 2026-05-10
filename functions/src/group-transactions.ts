/**
 * Cloud Functions for group expense and settlement transaction management.
 *
 * recordGroupSettlement — records an income transaction for the creditor when a debtor settles,
 *                         updates the creditor's monthly report, and notifies them.
 * recordTransactionForUser — generic callable to create a transaction under any user's account
 *                            via Admin SDK (bypasses client-side auth restrictions).
 * notifyGroupExpense    — notifies group members when a new expense is added.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createNotification } from './notification-trigger';
import { recomputeMonthlyReportForAccount } from './monthly-report-sync';

const TRANSACTIONS_COLLECTION = 'transactions';

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getAccountForUser(db: FirebaseFirestore.Firestore, userId: string): Promise<{
  id: string;
  currency: string;
} | null> {
  const snap = await db
    .collection('accounts')
    .where('uid', '==', userId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, currency: String(d.data()['currency'] ?? 'INR') };
}

async function createTransactionForUser(
  db: FirebaseFirestore.Firestore,
  payload: {
    accountId: string;
    amount: number;
    description: string;
    category: string;
    type: 'income' | 'expense';
    source: string;
    paidBy: string;
    linkedObject?: {
      type: string;
      id: string;
      recordId: string;
    };
    date: string;
  },
): Promise<string> {
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
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection(TRANSACTIONS_COLLECTION).add(doc);
  return ref.id;
}

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── recordGroupSettlement ────────────────────────────────────────────────────

interface RecordGroupSettlementPayload {
  groupId: string;
  settlementId: string;
  creditorId: string;
  debtorId: string;
  debtorName: string;
  amount: number;
  description: string;
  category: string;
  source: string;
  currency: string;
}

/**
 * Called by the debtor's client after creating a settlement record.
 * 1. Finds the creditor's account.
 * 2. Creates an income transaction for the creditor.
 * 3. Updates the creditor's balance.
 * 4. Recomputes the creditor's monthly report.
 * 5. Sends a SETTLEMENT_DONE notification to the creditor.
 */
export const recordGroupSettlement = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const data = request.data as RecordGroupSettlementPayload;
  const { groupId, settlementId, creditorId, debtorId, debtorName, amount, description, category, source } = data;

  if (!groupId || !settlementId || !creditorId || !debtorId || !amount) {
    throw new HttpsError('invalid-argument', 'Missing required fields.');
  }

  const db = getFirestore();

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
      balance: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    });

  // Recompute creditor's monthly report
  const currentMonth = todayDateString().slice(0, 7); // 'YYYY-MM'
  await recomputeMonthlyReportForAccount(creditorAccountId, creditorId, currentMonth).catch((e) =>
    console.error('report recompute failed', e),
  );

  // Notify creditor
  await notifySettlement(creditorId, debtorName, amount, description, groupId);

  return { ok: true };
});

async function notifySettlement(
  creditorId: string,
  debtorName: string,
  amount: number,
  description: string,
  groupId: string,
): Promise<void> {
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);

  await createNotification(creditorId, {
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

// ─── recordTransactionForUser ─────────────────────────────────────────────────

interface RecordTransactionPayload {
  targetUid: string;
  accountId?: string;
  amount: number;
  description: string;
  category: string;
  type: 'income' | 'expense';
  source: string;
  paidBy: string;
  linkedObject?: {
    type: string;
    id: string;
    recordId: string;
  };
  updateReport?: boolean;
}

/**
 * Generic callable: creates a transaction under any user's account using Admin SDK.
 * Used for cross-user writes (e.g. creditor settling on behalf of debtor — Case 2).
 *
 * Only callable by authenticated users; caller must pass their own UID as `paidBy`.
 */
export const recordTransactionForUser = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const data = request.data as RecordTransactionPayload;
  const { targetUid, amount, description, category, type, source, paidBy, linkedObject, updateReport } = data;

  if (!targetUid || !amount || !type) {
    throw new HttpsError('invalid-argument', 'targetUid, amount, and type are required.');
  }

  const db = getFirestore();

  // Resolve account: prefer provided accountId, else find primary for targetUid
  let accountId = data.accountId ?? '';
  if (!accountId) {
    const acct = await getAccountForUser(db, targetUid);
    if (!acct) {
      throw new HttpsError('not-found', `No account found for user ${targetUid}.`);
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
      balance: FieldValue.increment(balanceDelta),
      updatedAt: FieldValue.serverTimestamp(),
    });

  // Optionally recompute monthly report
  if (updateReport) {
    const currentMonth = todayDateString().slice(0, 7);
    await recomputeMonthlyReportForAccount(accountId, targetUid, currentMonth).catch((e) =>
      console.error('report recompute failed', e),
    );
  }

  return { ok: true };
});

// ─── notifyGroupExpense ───────────────────────────────────────────────────────

interface NotifyGroupExpensePayload {
  groupId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByName: string;
  memberIds: string[];
}

/**
 * Sends a notification to all group members (except the payer) about a new expense.
 */
export const notifyGroupExpense = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const data = request.data as NotifyGroupExpensePayload;
  const { groupId, expenseId, description, amount, paidByName, memberIds } = data;

  if (!groupId || !memberIds?.length) {
    return { ok: true, skipped: true };
  }

  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);

  await Promise.allSettled(
    memberIds.map((uid) =>
      createNotification(uid, {
        type: 'PAYMENT_REQUEST',
        title: 'New group expense',
        body: `${paidByName} added "${description}" for ${formatted}.`,
        senderId: request.auth!.uid,
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
      }),
    ),
  );

  return { ok: true };
});
