import { Timestamp } from 'firebase/firestore';

export type AccountType = 'single-user' | 'multi-user';

export interface AccountMember {
  memberId: string;
  memberDisplayName: string;
  isJoined: boolean;
  isActive: boolean;
}

/**
 * Account stored under `accounts/{id}` (document id may be the owner's uid for the first account, or an auto id for additional accounts).
 */
export interface AccountDocument {
  uid: string;
  name: string;
  balance: number;
  currency: string;
  isSelected?: boolean;
  isActive?: boolean;
  /** @deprecated legacy shape used string[] of user ids; prefer {@link AccountMember} objects. */
  members?: AccountMember[] | string[];
  ownerId?: string;
  /** Defaults to `single-user` when absent (legacy documents). */
  accountType?: AccountType;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** Client-friendly shape (with doc id) */
export interface Account extends Omit<AccountDocument, 'createdAt' | 'updatedAt' | 'members'> {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  date?: string; // 'YYYY-MM-DD'
  members?: AccountMember[];
  _pendingSync?: boolean;
}

export interface AccountCreateInput {
  name: string;
  balance: number | string;
  currency: string;
  isSelected: boolean;
  isActive: boolean;
  members: AccountMember[];
  ownerId: string;
  accountType?: AccountType;
}

export type AccountUpdateInput = Partial<
  Pick<
    AccountDocument,
    | 'name'
    | 'balance'
    | 'currency'
    | 'isSelected'
    | 'isActive'
    | 'members'
    | 'accountType'
  >
>;
