import { Timestamp } from 'firebase/firestore';

/**
 * Account stored as a single doc under `accounts/{uid}`.
 * (Matches your onboarding flow which creates an initial account once.)
 */
export interface AccountDocument {
  uid: string;
  name: string;
  balance: number;
  currency: string;
  isSelected?: boolean;
  isActive?: boolean;
  members?: string[];
  ownerId?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** Client-friendly shape (with doc id) */
export interface Account extends Omit<AccountDocument, 'createdAt' | 'updatedAt'> {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AccountCreateInput {
  name: string;
  balance: number | string;
  currency: string;
  isSelected: boolean;
  isActive: boolean;
  members: string[];
  ownerId: string;
}

export type AccountUpdateInput = Partial<
  Pick<AccountDocument, 'name' | 'balance' | 'currency' | 'isSelected' | 'isActive' | 'members'>
>;
