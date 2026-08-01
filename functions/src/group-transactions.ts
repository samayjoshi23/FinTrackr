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

// Guard limits for amount validation — reject clearly-invalid numbers early
// so a compromised client can't submit NaN, Infinity, or absurd values.
const MAX_AMOUNT = 1e9;
const AMOUNT_TOLERANCE = 0.01;

// ─── Authorization helpers ────────────────────────────────────────────────────

/**
 * Read a group doc and confirm both `callerUid` and `otherUid` are members
 * (creator counts as a member). Throws `permission-denied` if not.
 * Returns the group data on success.
 */
async function requireGroupMembership(
  db: FirebaseFirestore.Firestore,
  groupId: string,
  callerUid: string,
  otherUid: string,
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await db.collection('groups').doc(groupId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Group ${groupId} not found.`);
  }
  const data = snap.data() ?? {};
  const active: string[] = Array.isArray(data['activeMemberIds']) ? data['activeMemberIds'] : [];
  const creator = data['creatorId'] as string | undefined;
  const isMember = (uid: string) => uid === creator || active.includes(uid);
  if (!isMember(callerUid)) {
    throw new HttpsError('permission-denied', 'Caller is not a member of this group.');
  }
  if (!isMember(otherUid)) {
    throw new HttpsError('permission-denied', 'Target user is not a member of this group.');
  }
  return data;
}

function requireFiniteAmount(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
    throw new HttpsError('invalid-argument', 'Amount must be a positive finite number.');
  }
  return n;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getAccountForUser(db: FirebaseFirestore.Firestore, userId: string): Promise<{
  id: string;
  currency: string;
} | null> {
  // The account doc stores the owner as `ownerId`; `uid` is the doc's own id,
  // so querying by uid never matches and silently drops the write.
  const snap = await db
    .collection('accounts')
    .where('ownerId', '==', userId)
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
  const callerUid = request.auth.uid;

  const data = request.data as RecordGroupSettlementPayload;
  const { groupId, settlementId, creditorId, debtorId, debtorName, description, category, source } = data;

  if (!groupId || !settlementId || !creditorId || !debtorId) {
    throw new HttpsError('invalid-argument', 'Missing required fields.');
  }
  const amount = requireFiniteAmount(data.amount);

  const db = getFirestore();

  // ─── Authorization ──────────────────────────────────────────────────────
  // 1. Caller must be the debtor (they are settling their own debt).
  if (callerUid !== debtorId) {
    throw new HttpsError('permission-denied', 'Only the debtor can record this settlement.');
  }
  // 2. Both parties must be active members of the group.
  await requireGroupMembership(db, groupId, callerUid, creditorId);
  // 3. The settlement record must exist under the group with matching parties
  //    and amount — prevents forging arbitrary transfers.
  const settlementSnap = await db
    .collection('groups').doc(groupId)
    .collection('settlements').doc(settlementId)
    .get();
  if (!settlementSnap.exists) {
    throw new HttpsError('not-found', 'Settlement record not found.');
  }
  const settlement = settlementSnap.data() ?? {};
  if (
    settlement['fromId'] !== debtorId ||
    settlement['toId'] !== creditorId ||
    Math.abs(Number(settlement['amount'] ?? 0) - amount) > AMOUNT_TOLERANCE
  ) {
    throw new HttpsError('invalid-argument', 'Settlement payload does not match the stored record.');
  }

  // Find the creditor's primary account (owner is stored as `ownerId`).
  const accountSnap = await db
    .collection('accounts')
    .where('ownerId', '==', creditorId)
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

  // Create income transaction for creditor — `paidBy` is the debtor
  // (authoritative: we already verified callerUid === debtorId above).
  await createTransactionForUser(db, {
    accountId: creditorAccountId,
    amount,
    description: description || `Settlement from ${debtorName}`,
    category: category || 'Other',
    type: 'income',
    source: source || 'UPI',
    paidBy: callerUid,
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
 * Cross-user transaction write via Admin SDK.
 *
 * Used ONLY when a group flow needs to post a transaction into another user's
 * account (e.g. the group creator settling on behalf of a member — Case 2 of
 * the settlement flow). Same-user writes must go direct to Firestore under
 * that user's rules.
 *
 * Guards:
 *   1. Caller must be authenticated.
 *   2. Payload MUST reference a real group entity via `linkedObject`
 *      (`group-expense` or `group-settlement`). No orphaned cross-user writes.
 *   3. Caller AND target must both be active members of the referenced group.
 *   4. The linked source doc must exist and its stored amount must match the
 *      call's amount (within a rounding tolerance).
 *   5. `paidBy` is derived from the auth token — client-supplied values are
 *      ignored so audit attribution can never be forged.
 */
export const recordTransactionForUser = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const callerUid = request.auth.uid;

  const data = request.data as RecordTransactionPayload;
  const { targetUid, description, category, type, source, linkedObject, updateReport } = data;

  if (!targetUid || !type) {
    throw new HttpsError('invalid-argument', 'targetUid and type are required.');
  }
  if (type !== 'income' && type !== 'expense') {
    throw new HttpsError('invalid-argument', "type must be 'income' or 'expense'.");
  }
  const amount = requireFiniteAmount(data.amount);

  // ─── Authorization ──────────────────────────────────────────────────────
  // Every legitimate cross-user write ties back to a group expense or
  // settlement; require the linkedObject up front so the call has an
  // authoritative source doc we can re-read and verify against.
  if (
    !linkedObject ||
    (linkedObject.type !== 'group-expense' && linkedObject.type !== 'group-settlement') ||
    !linkedObject.id ||
    !linkedObject.recordId
  ) {
    throw new HttpsError(
      'invalid-argument',
      'linkedObject must reference a group-expense or group-settlement.',
    );
  }

  const db = getFirestore();
  const groupId = linkedObject.id;

  // Caller and target must both be members of the referenced group.
  await requireGroupMembership(db, groupId, callerUid, targetUid);

  // Verify the source doc exists and its amount matches — prevents a caller
  // picking any real record id and inflating the transaction amount.
  const sourceRef =
    linkedObject.type === 'group-expense'
      ? db.collection('groups').doc(groupId).collection('expenses').doc(linkedObject.recordId)
      : db.collection('groups').doc(groupId).collection('settlements').doc(linkedObject.recordId);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) {
    throw new HttpsError('not-found', 'Linked record not found under this group.');
  }
  if (Math.abs(Number(sourceSnap.data()?.['amount'] ?? 0) - amount) > AMOUNT_TOLERANCE) {
    throw new HttpsError('invalid-argument', 'Amount does not match the linked record.');
  }

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
    // paidBy is always the authenticated caller — never trust the client.
    paidBy: callerUid,
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
  /** @deprecated — no longer trusted; recipients are derived server-side. */
  memberIds?: string[];
}

/**
 * Sends a notification to all group members (except the caller) about a new
 * expense. `memberIds` from the payload is IGNORED — recipients come from the
 * group doc server-side, so a caller cannot spam arbitrary uids with push
 * notifications.
 */
export const notifyGroupExpense = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const callerUid = request.auth.uid;

  const data = request.data as NotifyGroupExpensePayload;
  const { groupId, expenseId, description, amount, paidByName } = data;

  if (!groupId) {
    return { ok: true, skipped: true };
  }

  const db = getFirestore();

  // Recipients: active members of the group, minus the caller.
  const groupSnap = await db.collection('groups').doc(groupId).get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'Group not found.');
  }
  const groupData = groupSnap.data() ?? {};
  const active: string[] = Array.isArray(groupData['activeMemberIds'])
    ? groupData['activeMemberIds']
    : [];
  const creator = groupData['creatorId'] as string | undefined;
  // Caller must be a member to notify the group at all.
  if (callerUid !== creator && !active.includes(callerUid)) {
    throw new HttpsError('permission-denied', 'Caller is not a member of this group.');
  }
  const recipients = Array.from(new Set([...active, ...(creator ? [creator] : [])])).filter(
    (uid) => uid && uid !== callerUid,
  );
  if (recipients.length === 0) {
    return { ok: true, skipped: true };
  }

  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);

  await Promise.allSettled(
    recipients.map((uid) =>
      createNotification(uid, {
        type: 'PAYMENT_REQUEST',
        title: 'New group expense',
        body: `${paidByName} added "${description}" for ${formatted}.`,
        senderId: callerUid,
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
