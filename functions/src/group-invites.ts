/**
 * Cloud Functions for group invitations.
 *
 * sendGroupInvite    — looks up the invitee by email, adds them as a pending
 *                      member, and sends a GROUP_INVITE notification.
 * respondGroupInvite — accepts or declines an invite; notifies the group creator.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createNotification } from './notification-trigger';

interface GroupMember {
  memberId: string;
  memberDisplayName: string;
  memberEmail?: string;
  isActive: boolean;
  joinedAt: Timestamp | null;
}

function normalizeMembers(raw: unknown): GroupMember[] {
  if (!Array.isArray(raw)) return [];
  return raw as GroupMember[];
}

function deriveGroupMemberIndexes(members: GroupMember[]): {
  memberIds: string[];
  activeMemberIds: string[];
} {
  const memberIds = Array.from(new Set(members.map((m) => m.memberId).filter(Boolean)));
  const activeMemberIds = Array.from(
    new Set(members.filter((m) => m.isActive).map((m) => m.memberId).filter(Boolean)),
  );
  return { memberIds, activeMemberIds };
}

// ─── sendGroupInvite ─────────────────────────────────────────────────────────

type SendPayload = { groupId: string; inviteeEmail: string };

export const sendGroupInvite = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = request.auth.uid;
  const { groupId, inviteeEmail } = request.data as SendPayload;

  if (!groupId || !inviteeEmail) {
    throw new HttpsError('invalid-argument', 'groupId and inviteeEmail are required.');
  }

  const db = getFirestore();

  // Look up the invitee
  const usersSnap = await db
    .collection('users')
    .where('email', '==', inviteeEmail.trim().toLowerCase())
    .limit(1)
    .get();

  if (usersSnap.empty) {
    throw new HttpsError('not-found', `No user found with email "${inviteeEmail}".`);
  }

  const inviteeDoc = usersSnap.docs[0];
  const inviteeId = inviteeDoc.id;
  const inviteeName = String(inviteeDoc.data()['displayName'] ?? inviteeEmail);

  if (inviteeId === uid) {
    throw new HttpsError('invalid-argument', "You can't invite yourself.");
  }

  // Load group
  const groupRef = db.doc(`groups/${groupId}`);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'Group not found.');
  }

  const groupData = groupSnap.data()!;
  if (groupData['creatorId'] !== uid) {
    throw new HttpsError('permission-denied', 'Only the group creator can invite members.');
  }

  const groupName = String(groupData['name'] ?? 'a group');
  const members = normalizeMembers(groupData['members']);

  // Skip if already a member
  if (members.some((m) => m.memberId === inviteeId)) {
    return { ok: true, skipped: true };
  }

  // Add as pending member
  const newMember: GroupMember = {
    memberId: inviteeId,
    memberDisplayName: inviteeName,
    memberEmail: inviteeEmail,
    isActive: false,
    joinedAt: null,
  };
  members.push(newMember);
  const { memberIds, activeMemberIds } = deriveGroupMemberIndexes(members);
  await groupRef.update({
    members,
    memberIds,
    activeMemberIds,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Load inviter profile
  const inviterDoc = await db.doc(`users/${uid}`).get();
  const inviterName = String(inviterDoc.data()?.['displayName'] ?? 'Someone');

  // Send GROUP_INVITE notification
  await createNotification(inviteeId, {
    type: 'GROUP_INVITE',
    title: 'Group invitation',
    body: `${inviterName} invited you to join "${groupName}".`,
    senderId: uid,
    receiverId: inviteeId,
    accountId: null,
    entityType: 'group',
    entityId: groupId,
    actionData: {
      actions: ['ACCEPT', 'REJECT'],
      groupId,
      groupName,
      inviterName,
      deepLink: `/user/groups/${groupId}`,
    },
    category: 'group',
    subtitle: 'Group invite',
    source: 'social',
    priority: 'high',
  });

  return { ok: true };
});

// ─── respondGroupInvite ───────────────────────────────────────────────────────

type RespondPayload = { groupId: string; accept: boolean };

export const respondGroupInvite = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = request.auth.uid;
  const { groupId, accept } = request.data as RespondPayload;

  if (!groupId || typeof accept !== 'boolean') {
    throw new HttpsError('invalid-argument', 'groupId and accept are required.');
  }

  const db = getFirestore();
  const groupRef = db.doc(`groups/${groupId}`);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'Group not found.');
  }

  const groupData = groupSnap.data()!;
  const groupName = String(groupData['name'] ?? 'the group');
  const creatorId = String(groupData['creatorId'] ?? '');
  let members = normalizeMembers(groupData['members']);

  const idx = members.findIndex((m) => m.memberId === uid);
  if (idx < 0) {
    throw new HttpsError('permission-denied', 'You are not invited to this group.');
  }

  const inviteeDoc = await db.doc(`users/${uid}`).get();
  const inviteeName = String(inviteeDoc.data()?.['displayName'] ?? 'A member');

  if (accept) {
    members[idx] = {
      ...members[idx],
      isActive: true,
      joinedAt: Timestamp.now(),
    };
    const { memberIds, activeMemberIds } = deriveGroupMemberIndexes(members);
    await groupRef.update({
      members,
      memberIds,
      activeMemberIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (creatorId) {
      await createNotification(creatorId, {
        type: 'ACCOUNT_INVITE_ACCEPTED', // reuse accepted type; use GROUP_INVITE_ACCEPTED when added
        title: 'Group invite accepted',
        body: `${inviteeName} joined "${groupName}".`,
        senderId: uid,
        receiverId: creatorId,
        accountId: null,
        entityType: 'group',
        entityId: groupId,
        actionData: {
          deepLink: `/user/groups/${groupId}`,
          groupId,
          groupName,
        },
        category: 'group',
        source: 'social',
        priority: 'normal',
      });
    }
  } else {
    members = members.filter((m) => m.memberId !== uid);
    const { memberIds, activeMemberIds } = deriveGroupMemberIndexes(members);
    await groupRef.update({
      members,
      memberIds,
      activeMemberIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (creatorId) {
      await createNotification(creatorId, {
        type: 'ACCOUNT_INVITE_DECLINED',
        title: 'Group invite declined',
        body: `${inviteeName} declined the invite to "${groupName}".`,
        senderId: uid,
        receiverId: creatorId,
        accountId: null,
        entityType: 'group',
        entityId: groupId,
        actionData: {
          deepLink: `/user/groups`,
          groupId,
          groupName,
        },
        category: 'group',
        source: 'social',
        priority: 'low',
      });
    }
  }

  return { ok: true };
});
