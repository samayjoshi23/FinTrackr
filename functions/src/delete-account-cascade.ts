/**
 * deleteAccountCascade — callable Cloud Function that permanently removes an
 * account owned by the caller **and** every doc that references its id, in one
 * transactional-ish sweep. Notifies each active member before deletion so the
 * push actually reaches them.
 *
 * Ordering is deliberate: notify → cascade child data → delete the account
 * doc last. Doing it in any other order leaves either orphaned data (nobody
 * can read/write it any more since rules check `canAccessAccount(accountId)`
 * which reads the now-missing account doc) or notifies members about an account
 * that no longer exists in Firestore.
 *
 * Auth: the caller must be the account's `ownerId`. Members cannot invoke this
 * (they can decline the invite / leave, but not delete).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { createNotification } from './notification-trigger';

const BATCH_SIZE = 500;

async function deleteQueryDocs(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
): Promise<number> {
  let deleted = 0;
  let snap = await query.limit(BATCH_SIZE).get();
  while (!snap.empty) {
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < BATCH_SIZE) break;
    snap = await query.limit(BATCH_SIZE).get();
  }
  return deleted;
}

interface DeleteAccountCascadePayload {
  accountId: string;
}

export const deleteAccountCascade = onCall(
  { timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const callerUid = request.auth.uid;
    const { accountId } = (request.data as DeleteAccountCascadePayload) ?? {};
    if (!accountId) {
      throw new HttpsError('invalid-argument', 'accountId is required.');
    }

    const db = getFirestore();

    // ── 1. Authorize + snapshot the account for the notification fan-out ────
    const accountRef = db.collection('accounts').doc(accountId);
    const accountSnap = await accountRef.get();
    if (!accountSnap.exists) {
      throw new HttpsError('not-found', 'Account not found.');
    }
    const accountData = accountSnap.data() ?? {};
    if (accountData['ownerId'] !== callerUid) {
      throw new HttpsError(
        'permission-denied',
        'Only the account owner can delete this account.',
      );
    }

    const accountName = String(accountData['name'] ?? 'an account');
    // Notify every active member EXCEPT the owner (they initiated the delete).
    const activeMemberIds: string[] = Array.isArray(accountData['activeMemberIds'])
      ? (accountData['activeMemberIds'] as string[])
      : [];
    const notifyTargets = Array.from(new Set(activeMemberIds)).filter(
      (uid) => uid && uid !== callerUid,
    );

    // ── 2. Notify members BEFORE any deletion — after the account doc is
    //       gone, `createNotification` still works (it writes under
    //       users/{uid}/notifications), but this ordering keeps the push
    //       meaningful ("account X was deleted") and gives the trigger the
    //       most complete state to work with.
    console.log(
      `[deleteAccountCascade] Notifying ${notifyTargets.length} member(s) about deletion of account ${accountId}`,
    );
    await Promise.allSettled(
      notifyTargets.map((uid) =>
        createNotification(uid, {
          type: 'ACCOUNT_DELETED',
          title: 'Account removed',
          body: `The account "${accountName}" you were a member of was deleted by its owner.`,
          senderId: callerUid,
          receiverId: uid,
          accountId: null,
          entityType: 'account',
          entityId: accountId,
          actionData: {
            deepLink: '/user/settings',
            accountName,
          },
          category: 'account',
          source: 'system',
          priority: 'normal',
        }),
      ),
    );

    // ── 3. Cascade delete all data scoped to this account. Order among these
    //       doesn't matter (they're independent collections) but they all
    //       must run before the account doc itself so rules still see the
    //       account when we clean up client caches later. Admin SDK bypasses
    //       rules — this ordering is for observability / debuggability only.
    console.log(`[deleteAccountCascade] Cascading child data for account ${accountId}`);
    const [
      transactionsDeleted,
      recurringDeleted,
      monthlyReportsDeleted,
      budgetsDeleted,
      goalsDeleted,
      categoriesDeleted,
    ] = await Promise.all([
      deleteQueryDocs(
        db,
        db.collection('transactions').where('accountId', '==', accountId),
      ),
      deleteQueryDocs(
        db,
        db.collection('recurring-transactions').where('accountId', '==', accountId),
      ),
      deleteQueryDocs(
        db,
        db.collection('monthlyReports').where('accountId', '==', accountId),
      ),
      deleteQueryDocs(db, db.collection('budgets').where('accountId', '==', accountId)),
      deleteQueryDocs(db, db.collection('goals').where('accountId', '==', accountId)),
      deleteQueryDocs(
        db,
        db.collection('categories').where('accountId', '==', accountId),
      ),
    ]);

    // The single per-account plan lives at budgetPlans/{accountId}. Delete
    // directly instead of a where-query (there is only ever one doc).
    await db.doc(`budgetPlans/${accountId}`).delete().catch(() => {
      /* not created yet — no-op */
    });

    // ── 4. Delete the account doc last ─────────────────────────────────────
    await accountRef.delete();

    console.log(
      `[deleteAccountCascade] Done. account=${accountId} counts=${JSON.stringify({
        transactions: transactionsDeleted,
        recurring: recurringDeleted,
        monthlyReports: monthlyReportsDeleted,
        budgets: budgetsDeleted,
        goals: goalsDeleted,
        categories: categoriesDeleted,
      })}`,
    );

    return {
      ok: true,
      notified: notifyTargets.length,
      deleted: {
        transactions: transactionsDeleted,
        recurring: recurringDeleted,
        monthlyReports: monthlyReportsDeleted,
        budgets: budgetsDeleted,
        goals: goalsDeleted,
        categories: categoriesDeleted,
      },
    };
  },
);
