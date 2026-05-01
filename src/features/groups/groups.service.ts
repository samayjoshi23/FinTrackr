import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import {
  Group,
  GroupCreateInput,
  GroupDocument,
  GroupMember,
  GroupUpdateInput,
} from '../../shared/models/group.model';

const COLLECTION = 'groups';

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

function toGroup(id: string, data: GroupDocument): Group {
  return {
    id,
    name: data.name,
    icon: data.icon,
    currency: data.currency,
    creatorId: data.creatorId,
    members: (data.members ?? []).map((m) => ({
      ...m,
      joinedAt: m.joinedAt ? (m.joinedAt as unknown as { toDate(): Date }).toDate() : null,
    })) as GroupMember[],
    createdAt: data.createdAt ? (data.createdAt as unknown as { toDate(): Date }).toDate() : null,
    updatedAt: data.updatedAt ? (data.updatedAt as unknown as { toDate(): Date }).toDate() : null,
  };
}

@Injectable({ providedIn: 'root' })
export class GroupsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated.');
    return uid;
  }

  async createGroup(input: GroupCreateInput): Promise<Group> {
    const uid = this.requireUid();
    const payload: Omit<GroupDocument, 'createdAt' | 'updatedAt' | 'icon'> & {
      icon?: string;
      createdAt: unknown;
      updatedAt: unknown;
      memberIds: string[];
      activeMemberIds: string[];
    } = {
      name: input.name.trim(),
      currency: input.currency,
      creatorId: uid,
      members: input.members,
      ...deriveGroupMemberIndexes(input.members),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const icon = input.icon?.trim();
    if (icon) {
      payload.icon = icon;
    }
    const ref = await addDoc(collection(this.firestore, COLLECTION), payload);
    return this.getGroup(ref.id) as Promise<Group>;
  }

  async getGroup(groupId: string): Promise<Group | null> {
    const snap = await getDoc(doc(this.firestore, COLLECTION, groupId));
    if (!snap.exists()) return null;
    return toGroup(snap.id, snap.data() as GroupDocument);
  }

  /**
   * Returns all groups where the current user is listed as a member
   * (either active or pending invite).
   */
  async getMyGroups(): Promise<Group[]> {
    const uid = this.requireUid();
    const col = collection(this.firestore, COLLECTION);
    const [asCreator, asMember] = await Promise.all([
      getDocs(query(col, where('creatorId', '==', uid))),
      getDocs(query(col, where('memberIds', 'array-contains', uid))),
    ]);

    const seen = new Set<string>();
    const groups: Group[] = [];
    for (const snap of [...asCreator.docs, ...asMember.docs]) {
      if (seen.has(snap.id)) continue;
      seen.add(snap.id);
      groups.push(toGroup(snap.id, snap.data() as GroupDocument));
    }
    return groups.sort(
      (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    );
  }

  async updateGroup(groupId: string, input: GroupUpdateInput): Promise<void> {
    const updates: Record<string, unknown> = {
      ...input,
      updatedAt: serverTimestamp(),
    };
    if (input.members) {
      const { memberIds, activeMemberIds } = deriveGroupMemberIndexes(input.members as GroupMember[]);
      updates['memberIds'] = memberIds;
      updates['activeMemberIds'] = activeMemberIds;
    }
    await updateDoc(doc(this.firestore, COLLECTION, groupId), updates);
  }

  async deleteGroup(groupId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, COLLECTION, groupId));
  }

  /** Adds a pending (isActive: false) member to an existing group. */
  async addPendingMember(groupId: string, member: GroupMember): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('Group not found.');
    const members = group.members.filter((m) => m.memberId !== member.memberId);
    members.push(member);
    await this.updateGroup(groupId, { members: members as unknown as GroupMember[] });
  }

  /** Activates or removes a pending member (used by respondGroupInvite). */
  async respondMembership(groupId: string, memberId: string, accept: boolean): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('Group not found.');
    let members = group.members as GroupMember[];
    if (accept) {
      members = members.map((m) =>
        m.memberId === memberId ? { ...m, isActive: true, joinedAt: null } : m,
      );
    } else {
      members = members.filter((m) => m.memberId !== memberId);
    }
    await this.updateGroup(groupId, { members: members as unknown as GroupMember[] });
  }
}
