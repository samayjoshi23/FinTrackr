/**
 * Shared-account membership.
 *
 * Firestore triggers notify a user when they're newly invited (or re-invited).
 * Callables perform every privileged membership mutation with the Admin SDK
 * (clients can't change `memberIds`/`activeMemberIds` under the security rules):
 *   - respondAccountInvite  — the invitee accepts, or declines/leaves (→ inactive).
 *   - addAccountMember      — owner invites / re-invites a member.
 *   - removeAccountMember   — owner sets a member inactive (or deletes the row).
 *   - resendAccountInvite   — owner re-sends the invite notification.
 *
 * Membership state is carried by an explicit `status` ('invited' | 'active' |
 * 'inactive'); the legacy `isJoined`/`isActive` booleans are written in sync.
 * `inactive` members are excluded from `memberIds`, so they lose account access
 * while their row is kept for the owner.
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createNotification } from './notification-trigger';
import type { AccountMember, MemberStatus } from './types';

function memberStatusOf(m: { status?: unknown; isJoined?: unknown; isActive?: unknown }): MemberStatus {
  if (m.status === 'invited' || m.status === 'active' || m.status === 'inactive') return m.status;
  // Legacy docs (no `status`): `inactive` never existed, so any joined member had
  // access → treat as active. Never strip access purely from a boolean inference.
  return m.isJoined ? 'active' : 'invited';
}

function memberFlagsForStatus(status: MemberStatus): { isJoined: boolean; isActive: boolean } {
  return status === 'active' ? { isJoined: true, isActive: true } : { isJoined: false, isActive: false };
}

/** Return a copy of `m` set to `status`, with the legacy booleans re-synced. */
function withStatus(m: AccountMember, status: MemberStatus): AccountMember {
  return { ...m, status, ...memberFlagsForStatus(status) };
}

function normalizeMembers(raw: unknown): AccountMember[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length && typeof raw[0] === 'string') {
    return (raw as string[]).map((memberId) => ({
      memberId,
      memberDisplayName: '',
      status: 'invited' as MemberStatus,
      isJoined: false,
      isActive: false,
    }));
  }
  return (raw as Record<string, unknown>[]).map((m) => {
    const isJoined = Boolean(m['isJoined']);
    const isActive = Boolean(m['isActive']);
    const status = memberStatusOf({ status: m['status'], isJoined, isActive });
    const flags = memberFlagsForStatus(status);
    return {
      memberId: String(m['memberId'] ?? ''),
      memberDisplayName: String(m['memberDisplayName'] ?? ''),
      status,
      isJoined: flags.isJoined,
      isActive: flags.isActive,
    };
  });
}

function memberKey(m: AccountMember): string {
  return m.memberId;
}

function deriveAccountMemberIndexes(members: AccountMember[]): {
  memberIds: string[];
  activeMemberIds: string[];
} {
  // `inactive` (left / declined / removed) → excluded from memberIds so they lose
  // access. `invited` stays so they can still accept.
  const memberIds = Array.from(
    new Set(
      members
        .filter((m) => memberStatusOf(m) !== 'inactive')
        .map((m) => m.memberId)
        .filter(Boolean),
    ),
  );
  const activeMemberIds = Array.from(
    new Set(
      members
        .filter((m) => memberStatusOf(m) === 'active')
        .map((m) => m.memberId)
        .filter(Boolean),
    ),
  );
  return { memberIds, activeMemberIds };
}

async function getDisplayName(uid: string, fallback: string): Promise<string> {
  if (!uid) return fallback;
  const snap = await getFirestore().doc(`users/${uid}`).get();
  const name = snap.data()?.['displayName'];
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
}

/** Fire the ACCOUNT_INVITE notification to one member. */
async function sendAccountInvite(
  ownerId: string,
  memberId: string,
  accountId: string,
  accountName: string,
  inviterName: string,
): Promise<void> {
  await createNotification(memberId, {
    type: 'ACCOUNT_INVITE',
    title: 'Account invitation',
    body: `${inviterName} asked you to join account "${accountName}".`,
    senderId: ownerId,
    receiverId: memberId,
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

/**
 * Notify members who transitioned INTO `invited` (newly added, or re-invited from
 * inactive). Members that were already `invited`/`active` before are skipped, so
 * unrelated account writes (a balance change, etc.) never re-spam invites.
 */
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

  const inviterName = await getDisplayName(ownerId, 'Someone');

  for (const m of next) {
    if (!m.memberId || m.memberId === ownerId) continue;
    if (memberStatusOf(m) !== 'invited') continue;
    const was = prev.get(memberKey(m));
    const wasStatus = was ? memberStatusOf(was) : null;
    if (wasStatus === 'invited' || wasStatus === 'active') continue; // not a fresh invite
    await sendAccountInvite(ownerId, m.memberId, accountId, accountName, inviterName);
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

/** Load an account for a membership mutation; asserts the caller is the owner. */
async function loadOwnedAccount(
  accountId: string,
  callerUid: string,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
  ownerId: string;
  accountName: string;
  members: AccountMember[];
}> {
  if (!accountId) {
    throw new HttpsError('invalid-argument', 'accountId is required.');
  }
  const db = getFirestore();
  const ref = db.doc(`accounts/${accountId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Account not found.');
  }
  const data = snap.data()!;
  const ownerId = String(data['ownerId'] ?? '');
  if (ownerId !== callerUid) {
    throw new HttpsError('permission-denied', 'Only the account owner can manage members.');
  }
  return {
    ref,
    data,
    ownerId,
    accountName: String(data['name'] ?? 'your account'),
    members: normalizeMembers(data['members']),
  };
}

/** Apply a member-array mutation to `accounts/{id}` atomically. */
function commitMembersTx(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  members: AccountMember[],
): void {
  const index = deriveAccountMemberIndexes(members);
  tx.update(ref, {
    members,
    memberIds: index.memberIds,
    activeMemberIds: index.activeMemberIds,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

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

  // Read-modify-write in a transaction so this can't clobber a concurrent owner
  // add/remove (or vice versa) on the same members array.
  const db = getFirestore();
  const ref = db.doc(`accounts/${accountId}`);
  const ctx = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Account not found.');
    const data = snap.data()!;
    const members = normalizeMembers(data['members']);
    const idx = members.findIndex((m) => m.memberId === uid);
    if (idx < 0) throw new HttpsError('permission-denied', 'You are not invited to this account.');
    members[idx] = withStatus(members[idx], accept ? 'active' : 'inactive');
    commitMembersTx(tx, ref, members);
    return { ownerId: String(data['ownerId'] ?? ''), accountName: String(data['name'] ?? 'your account') };
  });

  const inviteeName = await getDisplayName(uid, 'A member');
  if (accept) {
    await createNotification(ctx.ownerId, {
      type: 'ACCOUNT_INVITE_ACCEPTED',
      title: 'Invitation accepted',
      body: `${inviteeName} accepted your invite to join "${ctx.accountName}".`,
      senderId: uid,
      receiverId: ctx.ownerId,
      accountId,
      entityType: 'account',
      entityId: accountId,
      actionData: { deepLink: `/user/settings/accounts/${accountId}`, accountName: ctx.accountName },
      category: 'account',
      source: 'social',
      priority: 'normal',
    });
  } else {
    await createNotification(ctx.ownerId, {
      type: 'ACCOUNT_INVITE_DECLINED',
      title: 'Invitation declined',
      body: `${inviteeName} declined the invite to join "${ctx.accountName}".`,
      senderId: uid,
      receiverId: ctx.ownerId,
      accountId,
      entityType: 'account',
      entityId: accountId,
      actionData: { deepLink: `/user/settings` },
      category: 'account',
      source: 'social',
      priority: 'low',
    });
  }

  return { ok: true };
});

type AddMemberPayload = { accountId: string; memberId: string; memberDisplayName?: string };

export const addAccountMember = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const callerUid = request.auth.uid;
  const { accountId, memberId, memberDisplayName } = request.data as AddMemberPayload;
  if (!accountId || !memberId) {
    throw new HttpsError('invalid-argument', 'accountId and memberId are required.');
  }

  const db = getFirestore();
  const ref = db.doc(`accounts/${accountId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Account not found.');
    const data = snap.data()!;
    const ownerId = String(data['ownerId'] ?? '');
    if (ownerId !== callerUid) {
      throw new HttpsError('permission-denied', 'Only the account owner can manage members.');
    }
    if (memberId === ownerId) {
      throw new HttpsError('invalid-argument', 'The owner is already on the account.');
    }
    const members = normalizeMembers(data['members']);
    const idx = members.findIndex((m) => m.memberId === memberId);
    if (idx >= 0) {
      if (memberStatusOf(members[idx]) === 'active') {
        throw new HttpsError('already-exists', 'That user is already an active member.');
      }
      // Re-invite a previously inactive/invited member.
      members[idx] = withStatus(
        { ...members[idx], memberDisplayName: (memberDisplayName ?? members[idx].memberDisplayName) || '' },
        'invited',
      );
    } else {
      members.push({
        memberId,
        memberDisplayName: (memberDisplayName ?? '').trim(),
        status: 'invited',
        isJoined: false,
        isActive: false,
      });
    }
    commitMembersTx(tx, ref, members);
  });
  // The onAccountUpdated trigger fires ACCOUNT_INVITE for the transition-into-invited.
  return { ok: true };
});

type RemoveMemberPayload = { accountId: string; memberId: string; permanent?: boolean };

export const removeAccountMember = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const callerUid = request.auth.uid;
  const { accountId, memberId, permanent } = request.data as RemoveMemberPayload;
  if (!accountId || !memberId) {
    throw new HttpsError('invalid-argument', 'accountId and memberId are required.');
  }

  const db = getFirestore();
  const ref = db.doc(`accounts/${accountId}`);
  const ctx = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Account not found.');
    const data = snap.data()!;
    const ownerId = String(data['ownerId'] ?? '');
    if (ownerId !== callerUid) {
      throw new HttpsError('permission-denied', 'Only the account owner can manage members.');
    }
    const members = normalizeMembers(data['members']);
    const idx = members.findIndex((m) => m.memberId === memberId);
    if (idx < 0) throw new HttpsError('not-found', 'That user is not a member of this account.');
    const wasActive = memberStatusOf(members[idx]) === 'active';
    if (permanent === true) {
      members.splice(idx, 1);
    } else {
      members[idx] = withStatus(members[idx], 'inactive');
    }
    commitMembersTx(tx, ref, members);
    return { ownerId, accountName: String(data['name'] ?? 'your account'), wasActive };
  });

  // Only tell an actual (active) member they were removed. Canceling a still-pending
  // invite, or purging an already-inactive record, is silent — a "you were removed"
  // push to someone who never joined would just be confusing.
  if (ctx.wasActive) {
    await createNotification(memberId, {
      type: 'ACCOUNT_MEMBER_REMOVED',
      title: 'Removed from account',
      body: `You were removed from the shared account "${ctx.accountName}".`,
      senderId: ctx.ownerId,
      receiverId: memberId,
      accountId: null,
      entityType: 'account',
      entityId: accountId,
      actionData: { deepLink: `/user/settings`, accountName: ctx.accountName },
      category: 'account',
      source: 'social',
      priority: 'normal',
    });
  }

  return { ok: true };
});

type ResendInvitePayload = { accountId: string; memberId: string };

export const resendAccountInvite = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const callerUid = request.auth.uid;
  const { accountId, memberId } = request.data as ResendInvitePayload;
  if (!memberId) {
    throw new HttpsError('invalid-argument', 'memberId is required.');
  }

  const { ownerId, accountName, members } = await loadOwnedAccount(accountId, callerUid);
  const member = members.find((m) => m.memberId === memberId);
  if (!member) {
    throw new HttpsError('not-found', 'That user is not a member of this account.');
  }
  if (memberStatusOf(member) !== 'invited') {
    throw new HttpsError('failed-precondition', 'This member has no pending invite to resend.');
  }

  const inviterName = await getDisplayName(ownerId, 'Someone');
  await sendAccountInvite(ownerId, memberId, accountId, accountName, inviterName);
  return { ok: true };
});
