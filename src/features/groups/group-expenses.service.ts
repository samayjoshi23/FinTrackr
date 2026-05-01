import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import {
  GroupExpense,
  GroupExpenseCreateInput,
  GroupExpenseDocument,
  GroupExpenseUpdateInput,
} from '../../shared/models/group.model';

function toExpense(id: string, data: GroupExpenseDocument): GroupExpense {
  return {
    id,
    groupId: data.groupId,
    description: data.description,
    amount: data.amount,
    currency: data.currency,
    category: data.category,
    icon: data.icon,
    paidById: data.paidById,
    paidByName: data.paidByName,
    splits: data.splits ?? [],
    date: data.date,
    createdAt: data.createdAt ? (data.createdAt as unknown as { toDate(): Date }).toDate() : null,
    updatedAt: data.updatedAt ? (data.updatedAt as unknown as { toDate(): Date }).toDate() : null,
  };
}

@Injectable({ providedIn: 'root' })
export class GroupExpensesService {
  private readonly firestore = inject(Firestore);

  private expensesCol(groupId: string) {
    return collection(this.firestore, `groups/${groupId}/expenses`);
  }

  async addExpense(input: GroupExpenseCreateInput): Promise<GroupExpense> {
    const payload: Omit<GroupExpenseDocument, 'createdAt' | 'updatedAt'> & {
      createdAt: unknown;
      updatedAt: unknown;
    } = {
      groupId: input.groupId,
      description: input.description.trim(),
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      icon: input.icon,
      paidById: input.paidById,
      paidByName: input.paidByName,
      splits: input.splits,
      date: input.date,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(this.expensesCol(input.groupId), payload);
    return {
      id: ref.id,
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getExpenses(groupId: string): Promise<GroupExpense[]> {
    const snap = await getDocs(
      query(this.expensesCol(groupId), orderBy('date', 'desc'), orderBy('createdAt', 'desc')),
    );
    return snap.docs.map((d) => toExpense(d.id, d.data() as GroupExpenseDocument));
  }

  async updateExpense(groupId: string, expenseId: string, input: GroupExpenseUpdateInput): Promise<void> {
    await updateDoc(doc(this.firestore, `groups/${groupId}/expenses/${expenseId}`), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteExpense(groupId: string, expenseId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `groups/${groupId}/expenses/${expenseId}`));
  }
}
