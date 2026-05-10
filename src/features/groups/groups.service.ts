import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
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
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';

const COLLECTION = 'groups';

function deriveGroupMemberIndexes(members: GroupMember[]): {
  memberIds: string[];
  activeMemberIds: string[];
} {
  const memberIds = Array.from(new Set(members.map((m) => m.memberId).filter(Boolean)));
  const activeMemberIds = Array.from(
    new Set(
      members
        .filter((m) => m.isActive)
        .map((m) => m.memberId)
        .filter(Boolean),
    ),
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
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly idbCache = inject(IndexedDbCacheService);

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated.');
    return uid;
  }

  private withViewer(group: Group, uid: string): Group {
    return { ...group, viewerUid: uid };
  }

  /** Firestore-only read (no IndexedDB). */
  private async getGroupDirect(groupId: string): Promise<Group | null> {
    const snap = await getDoc(doc(this.firestore, COLLECTION, groupId));
    if (!snap.exists()) return null;
    return toGroup(snap.id, snap.data() as GroupDocument);
  }

  private async fetchMyGroupsFromFirestore(): Promise<Group[]> {
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
      groups.push(this.withViewer(toGroup(snap.id, snap.data() as GroupDocument), uid));
    }
    return groups.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  }

  async createGroup(input: GroupCreateInput): Promise<Group> {
    const uid = this.requireUid();
    const indexes = deriveGroupMemberIndexes(input.members);
    const payload: Record<string, unknown> = {
      name: input.name.trim(),
      currency: input.currency,
      creatorId: uid,
      members: input.members,
      memberIds: indexes.memberIds,
      activeMemberIds: indexes.activeMemberIds,
    };
    if (input.icon?.trim()) {
      payload['icon'] = input.icon.trim();
    }

    return this.offlineCrud.create<Group>(
      'groups',
      'id',
      async (assignedId: string) => {
        const ref = doc(this.firestore, COLLECTION, assignedId);
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const row = await this.getGroupDirect(assignedId);
        if (!row) {
          throw new Error('Failed to read group after creation.');
        }
        return this.withViewer(row, uid);
      },
      payload,
    );
  }

  /** Sync worker: create on server after offline create was queued. */
  async applyPendingGroupCreate(docId: string, data: GroupCreateInput): Promise<void> {
    const uid = this.requireUid();
    const indexes = deriveGroupMemberIndexes(data.members);
    const ref = doc(this.firestore, COLLECTION, docId);
    await setDoc(ref, {
      name: data.name.trim(),
      currency: data.currency,
      creatorId: uid,
      members: data.members,
      memberIds: indexes.memberIds,
      activeMemberIds: indexes.activeMemberIds,
      ...(data.icon?.trim() ? { icon: data.icon.trim() } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const row = await this.getGroupDirect(docId);
    if (!row) throw new Error('Failed to read group after pending create sync.');
    await this.idbCache.put('groups', { ...row, viewerUid: uid, _pendingSync: false });
  }

  async getGroup(groupId: string): Promise<Group | null> {
    const uid = this.requireUid();
    return this.offlineCrud.fetchOne<Group>(
      'groups',
      groupId,
      async () => {
        const row = await this.getGroupDirect(groupId);
        return row ? this.withViewer(row, uid) : null;
      },
    );
  }

  /**
   * Returns all groups where the current user is listed as a member
   * (either active or pending invite). Cache-first with background Firestore revalidation.
   */
  async getMyGroups(): Promise<Group[]> {
    const uid = this.requireUid();
    return this.offlineCrud.fetchAll<Group>(
      'groups',
      () => this.fetchMyGroupsFromFirestore(),
      { indexName: 'viewerUid', value: uid },
    );
  }

  async updateGroup(groupId: string, input: GroupUpdateInput): Promise<void> {
    const uid = this.requireUid();
    const cached = await this.offlineCrud.fetchOne<Group>(
      'groups',
      groupId,
      async () => {
        const row = await this.getGroupDirect(groupId);
        return row ? this.withViewer(row, uid) : null;
      },
    );

    if (!cached) {
      throw new Error('Group not found.');
    }

    const patchRecord: Record<string, unknown> = {};
    if (input.name !== undefined) patchRecord['name'] = input.name.trim();
    if (input.icon !== undefined) patchRecord['icon'] = input.icon?.trim() ?? null;
    if (input.currency !== undefined) patchRecord['currency'] = input.currency;
    if (input.members !== undefined) {
      patchRecord['members'] = input.members;
      const idx = deriveGroupMemberIndexes(input.members as GroupMember[]);
      patchRecord['memberIds'] = idx.memberIds;
      patchRecord['activeMemberIds'] = idx.activeMemberIds;
    }

    await this.offlineCrud.update<Group>(
      'groups',
      groupId,
      async () => {
        const ref = doc(this.firestore, COLLECTION, groupId);
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          throw new Error('Group not found.');
        }
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
        };
        if (input.name !== undefined) updates['name'] = input.name.trim();
        if (input.icon !== undefined) updates['icon'] = input.icon?.trim() ?? null;
        if (input.currency !== undefined) updates['currency'] = input.currency;
        if (input.members !== undefined) {
          const members = input.members as GroupMember[];
          updates['members'] = members;
          Object.assign(updates, deriveGroupMemberIndexes(members));
        }
        await updateDoc(ref, updates);
      },
      patchRecord,
      cached as unknown as Record<string, unknown>,
    );
  }

  /** Sync worker: apply queued patch to Firestore and refresh IndexedDB row. */
  async applyPendingGroupUpdate(docId: string, patch: Record<string, unknown>): Promise<void> {
    const uid = this.requireUid();
    const ref = doc(this.firestore, COLLECTION, docId);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      throw new Error('Group not found.');
    }
    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch['name'] !== undefined) updates['name'] = String(patch['name']).trim();
    if (patch['icon'] !== undefined) updates['icon'] = patch['icon'];
    if (patch['currency'] !== undefined) updates['currency'] = patch['currency'];
    if (patch['members'] !== undefined) {
      const members = patch['members'] as GroupMember[];
      updates['members'] = members;
      Object.assign(updates, deriveGroupMemberIndexes(members));
    }
    await updateDoc(ref, updates);
    const row = await this.getGroupDirect(docId);
    if (!row) throw new Error('Failed to read group after sync.');
    await this.idbCache.put('groups', { ...row, viewerUid: uid, _pendingSync: false });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.offlineCrud.remove('groups', groupId, async () => {
      await deleteDoc(doc(this.firestore, COLLECTION, groupId));
    });
  }

  /** Sync worker: delete on server after offline delete was queued. */
  async applyPendingGroupDelete(docId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, COLLECTION, docId));
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
