/**
 * deleteUserAccount — callable Cloud Function that permanently removes all
 * Firestore data, Storage files, and the Firebase Auth record for the
 * authenticated caller.
 *
 * The caller's uid is derived from request.auth — never accepted as a param.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const BATCH_SIZE = 500;

async function deleteQueryDocs(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
): Promise<number> {
  let deleted = 0;
  let snap = await query.limit(BATCH_SIZE).get();
  while (!snap.empty) {
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    deleted += snap.size;
    if (snap.size < BATCH_SIZE) break;
    snap = await query.limit(BATCH_SIZE).get();
  }
  return deleted;
}

async function deleteSubcollection(
  db: FirebaseFirestore.Firestore,
  parentPath: string,
  subcollectionName: string,
): Promise<void> {
  const query = db.collection(`${parentPath}/${subcollectionName}`);
  await deleteQueryDocs(db, query);
}

export const deleteUserAccount = onCall(
  { timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const uid = request.auth.uid;
    const db = getFirestore();

    console.log(`[deleteUserAccount] Starting deletion for uid=${uid}`);

    try {
      // ── 1. Collect owned account IDs before deleting them ──────────────
      const ownedAccountsSnap = await db
        .collection('accounts')
        .where('ownerId', '==', uid)
        .get();
      const ownedAccountIds = ownedAccountsSnap.docs.map((d) => d.id);

      // ── 2. Delete data linked via accountId ────────────────────────────
      for (const accountId of ownedAccountIds) {
        await deleteQueryDocs(
          db,
          db.collection('transactions').where('accountId', '==', accountId),
        );
        await deleteQueryDocs(
          db,
          db.collection('recurring-transactions').where('accountId', '==', accountId),
        );
        await deleteQueryDocs(
          db,
          db.collection('monthlyReports').where('accountId', '==', accountId),
        );
      }

      // ── 3. Delete direct-owned collections ─────────────────────────────
      await deleteQueryDocs(
        db,
        db.collection('accounts').where('ownerId', '==', uid),
      );
      await deleteQueryDocs(
        db,
        db.collection('budgets').where('ownerId', '==', uid),
      );
      await deleteQueryDocs(
        db,
        db.collection('budgetPlans').where('ownerId', '==', uid),
      );
      await deleteQueryDocs(
        db,
        db.collection('goals').where('ownerId', '==', uid),
      );
      await deleteQueryDocs(
        db,
        db.collection('categories').where('ownerId', '==', uid),
      );

      // ── 4. Delete feedback ─────────────────────────────────────────────
      await deleteQueryDocs(
        db,
        db.collection('feedback').where('userId', '==', uid),
      );

      // ── 5. Handle group membership ─────────────────────────────────────
      await handleGroupCleanup(db, uid);

      // ── 6. Remove from shared accounts (accounts user was invited to) ──
      await removeFromSharedAccounts(db, uid);

      // ── 7. Delete user profile subcollections ──────────────────────────
      await deleteSubcollection(db, `users/${uid}`, 'notifications');
      await deleteSubcollection(db, `users/${uid}`, 'devices');

      // ── 8. Delete user profile doc (triggers user-directory cleanup) ───
      await db.doc(`users/${uid}`).delete();

      // ── 9. Delete profile pictures from Storage ────────────────────────
      await deleteStorageFolder(`profile-pictures/${uid}/`);

      // ── 10. Delete Firebase Auth user — MUST be last ───────────────────
      await getAuth().deleteUser(uid);

      console.log(`[deleteUserAccount] Completed deletion for uid=${uid}`);
      return { ok: true };
    } catch (error) {
      console.error(`[deleteUserAccount] Error deleting uid=${uid}:`, error);
      // Still try to delete the auth user even if Firestore cleanup partially failed
      try {
        await getAuth().deleteUser(uid);
      } catch {
        /* auth user may already be deleted */
      }
      throw new HttpsError('internal', 'Account deletion encountered errors. Please contact support if you can still sign in.');
    }
  },
);

async function handleGroupCleanup(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<void> {
  // Find all groups where user is creator
  const creatorSnap = await db
    .collection('groups')
    .where('creatorId', '==', uid)
    .get();

  // Find all groups where user is a member (but not necessarily creator)
  const memberSnap = await db
    .collection('groups')
    .where('memberIds', 'array-contains', uid)
    .get();

  // Deduplicate by doc id
  const groupMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const d of creatorSnap.docs) groupMap.set(d.id, d);
  for (const d of memberSnap.docs) groupMap.set(d.id, d);

  for (const [groupId, snap] of groupMap) {
    const data = snap.data();
    const creatorId = data['creatorId'] as string;
    const members: Array<Record<string, unknown>> = Array.isArray(data['members']) ? data['members'] : [];
    const memberIds: string[] = Array.isArray(data['memberIds']) ? data['memberIds'] : [];
    const activeMemberIds: string[] = Array.isArray(data['activeMemberIds']) ? data['activeMemberIds'] : [];

    const otherActiveMembers = activeMemberIds.filter((id) => id !== uid);
    const otherMembers = members.filter((m) => m['memberId'] !== uid);
    const isCreator = creatorId === uid;
    const isSoleMember = otherMembers.length === 0;

    if (isCreator && isSoleMember) {
      // Delete entire group + subcollections
      await deleteSubcollection(db, `groups/${groupId}`, 'expenses');
      await deleteSubcollection(db, `groups/${groupId}`, 'settlements');
      await db.doc(`groups/${groupId}`).delete();
    } else {
      // Remove user from membership arrays, promote creator if needed
      const updates: Record<string, unknown> = {
        members: otherMembers,
        memberIds: memberIds.filter((id) => id !== uid),
        activeMemberIds: otherActiveMembers,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (isCreator && otherActiveMembers.length > 0) {
        updates['creatorId'] = otherActiveMembers[0];
      }

      await db.doc(`groups/${groupId}`).update(updates);

      // Anonymize user references in expenses and settlements
      await anonymizeGroupExpenses(db, groupId, uid);
      await anonymizeGroupSettlements(db, groupId, uid);
    }
  }
}

async function anonymizeGroupExpenses(
  db: FirebaseFirestore.Firestore,
  groupId: string,
  uid: string,
): Promise<void> {
  const expensesSnap = await db
    .collection(`groups/${groupId}/expenses`)
    .get();

  for (const expenseDoc of expensesSnap.docs) {
    const data = expenseDoc.data();
    const updates: Record<string, unknown> = {};
    let needsUpdate = false;

    if (data['paidById'] === uid) {
      updates['paidByName'] = 'Deleted User';
      needsUpdate = true;
    }

    const paidByIds: string[] = Array.isArray(data['paidByIds']) ? data['paidByIds'] : [];
    const paidByNames: string[] = Array.isArray(data['paidByNames']) ? data['paidByNames'] : [];
    if (paidByIds.includes(uid)) {
      const idx = paidByIds.indexOf(uid);
      if (idx >= 0 && idx < paidByNames.length) {
        paidByNames[idx] = 'Deleted User';
        updates['paidByNames'] = paidByNames;
        needsUpdate = true;
      }
    }

    const splits: Array<Record<string, unknown>> = Array.isArray(data['splits']) ? data['splits'] : [];
    let splitsChanged = false;
    for (const split of splits) {
      if (split['memberId'] === uid) {
        split['memberName'] = 'Deleted User';
        splitsChanged = true;
      }
    }
    if (splitsChanged) {
      updates['splits'] = splits;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await expenseDoc.ref.update(updates);
    }
  }
}

async function anonymizeGroupSettlements(
  db: FirebaseFirestore.Firestore,
  groupId: string,
  uid: string,
): Promise<void> {
  const settlementsSnap = await db
    .collection(`groups/${groupId}/settlements`)
    .get();

  for (const settlementDoc of settlementsSnap.docs) {
    const data = settlementDoc.data();
    const updates: Record<string, unknown> = {};
    let needsUpdate = false;

    if (data['fromId'] === uid) {
      updates['fromName'] = 'Deleted User';
      needsUpdate = true;
    }
    if (data['toId'] === uid) {
      updates['toName'] = 'Deleted User';
      needsUpdate = true;
    }

    if (needsUpdate) {
      await settlementDoc.ref.update(updates);
    }
  }
}

async function removeFromSharedAccounts(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<void> {
  const sharedSnap = await db
    .collection('accounts')
    .where('memberIds', 'array-contains', uid)
    .get();

  for (const accountDoc of sharedSnap.docs) {
    // Skip accounts we own (already deleted above)
    if (accountDoc.data()['ownerId'] === uid) continue;

    const members: Array<Record<string, unknown>> = Array.isArray(accountDoc.data()['members'])
      ? accountDoc.data()['members']
      : [];

    await accountDoc.ref.update({
      members: members.filter((m) => m['memberId'] !== uid),
      memberIds: FieldValue.arrayRemove(uid),
      activeMemberIds: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function deleteStorageFolder(prefix: string): Promise<void> {
  try {
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix });
    if (files.length > 0) {
      await Promise.all(files.map((file) => file.delete().catch(() => {})));
    }
  } catch {
    console.warn(`[deleteUserAccount] Storage cleanup skipped for prefix=${prefix}`);
  }
}
