/** Transaction stored under `transactions/{id}` */

export interface TransactionRecord {
  id: string;
  ownerId: string;
  accountId: string;
  amount: number;
  description: string;
  category: string;
  type: string;
  status: string;
  source?: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface TransactionCreateInput {
  accountId: string;
  amount: number | string;
  description: string;
  category: string;
  type: string;
  status?: string;
  source?: string;
}

export type TransactionUpdateInput = Partial<
  Pick<
    TransactionRecord,
    'accountId' | 'amount' | 'description' | 'category' | 'type' | 'status' | 'source'
  >
>;
