import { Timestamp } from 'firebase/firestore';

export type AccountType = 'single-user' | 'multi-user';

/**
 * Membership state, the source of truth for a shared-account member:
 *   - `invited`  — asked to join, not yet accepted (still in `memberIds` so they can act).
 *   - `active`   — joined and participating (in `memberIds` AND `activeMemberIds`).
 *   - `inactive` — left / declined / removed by the owner. Kept as a record for the
 *      owner but EXCLUDED from `memberIds`, so they lose access to the account.
 */
export type MemberStatus = 'invited' | 'active' | 'inactive';

export interface AccountMember {
  memberId: string;
  memberDisplayName: string;
  /** Source of truth. Legacy docs without it infer status from the booleans below. */
  status: MemberStatus;
  /** @deprecated legacy mirrors of {@link status}, written in sync for old readers/rules. */
  isJoined: boolean;
  isActive: boolean;
}

/** Resolve a member's status, tolerating legacy docs that only had the booleans. */
export function memberStatusOf(m: {
  status?: unknown;
  isJoined?: unknown;
  isActive?: unknown;
}): MemberStatus {
  if (m.status === 'invited' || m.status === 'active' || m.status === 'inactive') return m.status;
  // Legacy docs (no `status`): `inactive` never existed, so any joined member had
  // access → treat as active. Never strip access purely from a boolean inference.
  return m.isJoined ? 'active' : 'invited';
}

/** Legacy boolean mirrors kept in sync with a status (only `active` is joined+active). */
export function memberFlagsForStatus(status: MemberStatus): { isJoined: boolean; isActive: boolean } {
  return status === 'active' ? { isJoined: true, isActive: true } : { isJoined: false, isActive: false };
}

/**
 * Account stored under `accounts/{id}` (document id may be the owner's uid for the first account, or an auto id for additional accounts).
 */
export interface AccountDocument {
  uid: string;
  name: string;
  balance: number;
  /** The starting balance entered when the account was first created. Never updated after creation. */
  initialBalance?: number;
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
  /**
   * Synthetic, local-only field: the uid of the device's current user, stamped on
   * every account row this user can see (owned or member). Backs the IndexedDB
   * `viewerUid` index so a single query returns the whole visible set. Never
   * written to Firestore. Mirrors {@link Group.viewerUid}.
   */
  viewerUid?: string;
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

// NOTE: `members` is intentionally excluded — membership is mutated only through the
// Admin-SDK callables (addAccountMember / removeAccountMember / respondAccountInvite),
// because the security rules freeze `memberIds`/`activeMemberIds` on client owner updates.
export type AccountUpdateInput = Partial<
  Pick<
    AccountDocument,
    'name' | 'balance' | 'currency' | 'isSelected' | 'isActive' | 'accountType'
  >
>;
