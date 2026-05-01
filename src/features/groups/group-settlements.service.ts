import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  Firestore,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from '@angular/fire/firestore';
import {
  GroupSettlement,
  GroupSettlementCreateInput,
  GroupSettlementDocument,
} from '../../shared/models/group.model';

function toSettlement(id: string, data: GroupSettlementDocument): GroupSettlement {
  return {
    id,
    groupId: data.groupId,
    fromId: data.fromId,
    fromName: data.fromName,
    toId: data.toId,
    toName: data.toName,
    amount: data.amount,
    currency: data.currency,
    note: data.note,
    settledAt: data.settledAt ? (data.settledAt as unknown as { toDate(): Date }).toDate() : new Date(),
    createdAt: data.createdAt ? (data.createdAt as unknown as { toDate(): Date }).toDate() : null,
  };
}

@Injectable({ providedIn: 'root' })
export class GroupSettlementsService {
  private readonly firestore = inject(Firestore);

  private settlementsCol(groupId: string) {
    return collection(this.firestore, `groups/${groupId}/settlements`);
  }

  async addSettlement(input: GroupSettlementCreateInput): Promise<GroupSettlement> {
    const payload: Omit<GroupSettlementDocument, 'settledAt' | 'createdAt'> & {
      settledAt: unknown;
      createdAt: unknown;
    } = {
      groupId: input.groupId,
      fromId: input.fromId,
      fromName: input.fromName,
      toId: input.toId,
      toName: input.toName,
      amount: input.amount,
      currency: input.currency,
      note: input.note ?? '',
      settledAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(this.settlementsCol(input.groupId), payload);
    return {
      id: ref.id,
      ...input,
      note: input.note ?? '',
      settledAt: new Date(),
      createdAt: new Date(),
    };
  }

  async getSettlements(groupId: string): Promise<GroupSettlement[]> {
    const snap = await getDocs(
      query(this.settlementsCol(groupId), orderBy('settledAt', 'desc')),
    );
    return snap.docs.map((d) => toSettlement(d.id, d.data() as GroupSettlementDocument));
  }
}
