/**
 * Firestore trigger: when account `members` gains a pending invitee, notify them.
 * Callable: respondAccountInvite — accept or reject (updates members server-side).
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createNotification } from './notification-trigger';
import type { AccountMember } from './types';

function normalizeMembers(raw: unknown): AccountMember[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length && typeof raw[0] === 'string') {
    return (raw as string[]).map((memberId) => ({
      memberId,
      memberDisplayName: '',
      isJoined: false,
      isActive: false,
    }));
  }
  return (raw as AccountMember[]).map((m) => ({
    memberId: String(m.memberId ?? ''),
    memberDisplayName: String(m.memberDisplayName ?? ''),
    isJoined: Boolean(m.isJoined),
    isActive: Boolean(m.isActive),
  }));
}

function memberKey(m: AccountMember): string {
  return m.memberId;
}

async function notifyNewPendingInvites(
  accountId: string,
  after: Record<string, unknown>,
  prevMembers: AccountMember[],
): Promise<void> {
  const accountName = String(after['name'] ?? 'an account');
  const ownerId = String(after['ownerId'] ?? '');
  if (!ownerId) return;

  const prev = new Map(prevMembers.map((m) => [memberKey(m), m]));
  const next = normalizeMembers(after['members']);

  const ownerProfile = await getFirestore().doc(`users/${ownerId}`).get();
  const inviterName = String(ownerProfile.data()?.['displayName'] ?? 'Someone');

  for (const m of next) {
    if (!m.memberId || m.memberId === ownerId) continue;
    const was = prev.get(memberKey(m));
    if (m.isJoined || was) continue;

    await createNotification(m.memberId, {
      type: 'ACCOUNT_INVITE',
      title: 'Account invitation',
      body: `${inviterName} asked you to join account "${accountName}".`,
      senderId: ownerId,
      receiverId: m.memberId,
      accountId,
      entityType: 'account',
      entityId: accountId,
      actionData: {
        actions: ['ACCEPT', 'REJECT'],
        accountId,
        accountName,
        inviterName,
        deepLink: `/user/settings`,
      },
      category: 'account',
      subtitle: 'Shared account',
      source: 'social',
      priority: 'high',
    });
  }
}

export const onAccountCreated = onDocumentCreated('accounts/{accountId}', async (event) => {
  const after = event.data?.data();
  if (!after) return;
  const accountId = event.params['accountId'] as string;
  await notifyNewPendingInvites(accountId, after, []);
});

export const onAccountUpdated = onDocumentUpdated('accounts/{accountId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const accountId = event.params['accountId'] as string;
  await notifyNewPendingInvites(accountId, after, normalizeMembers(before['members']));
});

type RespondPayload = { accountId: string; accept: boolean };

export const respondAccountInvite = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = request.auth.uid;
  const { accountId, accept } = request.data as RespondPayload;
  if (!accountId || typeof accept !== 'boolean') {
    throw new HttpsError('invalid-argument', 'accountId and accept are required.');
  }

  const db = getFirestore();
  const ref = db.doc(`accounts/${accountId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Account not found.');
  }
  const data = snap.data()!;
  const ownerId = String(data['ownerId'] ?? '');
  const members = normalizeMembers(data['members']);
  const idx = members.findIndex((m) => m.memberId === uid);
  if (idx < 0) {
    throw new HttpsError('permission-denied', 'You are not invited to this account.');
  }

  if (accept) {
    members[idx] = {
      ...members[idx],
      isJoined: true,
      isActive: true,
    };
    await ref.update({
      members,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const inviteeProfile = await db.doc(`users/${uid}`).get();
    const inviteeName = String(inviteeProfile.data()?.['displayName'] ?? 'A member');

    await createNotification(ownerId, {
      type: 'ACCOUNT_INVITE_ACCEPTED',
      title: 'Invitation accepted',
      body: `${inviteeName} accepted your invite to join "${String(data['name'] ?? 'your account')}".`,
      senderId: uid,
      receiverId: ownerId,
      accountId,
      entityType: 'account',
      entityId: accountId,
      actionData: {
        deepLink: `/user/settings/accounts/${accountId}`,
        accountName: String(data['name'] ?? ''),
      },
      category: 'account',
      source: 'social',
      priority: 'normal',
    });
  } else {
    const inviteeProfile = await db.doc(`users/${uid}`).get();
    const inviteeName = String(inviteeProfile.data()?.['displayName'] ?? 'A member');

    members.splice(idx, 1);
    await ref.update({
      members,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await createNotification(ownerId, {
      type: 'ACCOUNT_INVITE_DECLINED',
      title: 'Invitation declined',
      body: `${inviteeName} declined the invite to join "${String(data['name'] ?? 'your account')}".`,
      senderId: uid,
      receiverId: ownerId,
      accountId,
      entityType: 'account',
      entityId: accountId,
      actionData: {
        deepLink: `/user/settings`,
      },
      category: 'account',
      source: 'social',
      priority: 'low',
    });
  }

  return { ok: true };
});
