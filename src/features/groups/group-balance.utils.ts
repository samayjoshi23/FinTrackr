import { GroupExpense, GroupSettlement, GroupMember, MemberBalance } from '../../shared/models/group.model';

/**
 * Computes each member's net balance relative to `currentUserId`.
 *
 * Algorithm:
 * - For each expense where the current user is the payer: every other member
 *   owes the current user their split amount (positive).
 * - For each expense where another member paid: the current user owes that
 *   member their own split amount (negative entry for that payer).
 * - Settlements reduce/cancel those debts.
 *
 * Returns one entry per member (excluding the current user).
 */
export function computeBalances(
  expenses: GroupExpense[],
  settlements: GroupSettlement[],
  members: GroupMember[],
  currentUserId: string,
): MemberBalance[] {
  // net[memberId] = amount that member owes current user (positive) or
  //                current user owes that member (negative)
  const net = new Map<string, number>();

  for (const m of members) {
    if (m.memberId !== currentUserId) {
      net.set(m.memberId, 0);
    }
  }

  for (const expense of expenses) {
    if (expense.paidById === currentUserId) {
      // Current user paid — others owe us their share
      for (const split of expense.splits) {
        if (split.memberId === currentUserId) continue;
        net.set(split.memberId, (net.get(split.memberId) ?? 0) + split.amount);
      }
    } else {
      // Someone else paid — current user owes the payer their own split
      const mySplit = expense.splits.find((s) => s.memberId === currentUserId);
      if (mySplit && mySplit.amount > 0) {
        net.set(expense.paidById, (net.get(expense.paidById) ?? 0) - mySplit.amount);
      }
    }
  }

  for (const s of settlements) {
    if (s.fromId === currentUserId) {
      // Current user settled with toId — reduces what they owe
      net.set(s.toId, (net.get(s.toId) ?? 0) + s.amount);
    } else if (s.toId === currentUserId) {
      // Someone paid the current user back — reduces what they owe us
      net.set(s.fromId, (net.get(s.fromId) ?? 0) - s.amount);
    }
  }

  const memberMap = new Map(members.map((m) => [m.memberId, m.memberDisplayName]));

  return Array.from(net.entries())
    .filter(([memberId]) => memberId !== currentUserId)
    .map(([memberId, netAmount]) => ({
      memberId,
      memberName: memberMap.get(memberId) ?? memberId,
      netAmount,
    }));
}

/**
 * Total net balance for the current user across all members.
 * Positive = you are owed money overall; negative = you owe money overall.
 */
export function totalNetBalance(balances: MemberBalance[]): number {
  return balances.reduce((sum, b) => sum + b.netAmount, 0);
}

/** Returns the 2-character initials for an avatar. */
export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Assigns a repeatable avatar colour class based on a member id. */
export function memberAvatarClass(memberId: string): string {
  const classes = ['button-violet', 'button-blue', 'button-amber', 'button-orange', 'button-red'];
  const idx = [...memberId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % classes.length;
  return classes[idx];
}
