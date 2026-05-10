import { GroupExpense, GroupSettlement } from '../../shared/models/group.model';

/** The remaining amount one debtor still owes a creditor for a specific expense. */
export interface ExpenseRemainingSlice {
  expenseId: string;
  /** Debtor's original split amount for this expense. */
  splitAmount: number;
  /** Amount still outstanding after FIFO-consuming settlements. */
  remaining: number;
}

/**
 * FIFO-allocates all settlements made by `debtorId` to `creditorId` against
 * the expense splits owed, oldest expense first.
 *
 * This is a display-only computation — nothing is stored per split.
 */
export function computeExpenseRemaining(
  expenses: GroupExpense[],
  settlements: GroupSettlement[],
  debtorId: string,
  creditorId: string,
): ExpenseRemainingSlice[] {
  // Build slices: expenses where creditor is one of the payers and debtor had a non-zero split
  const slices: (ExpenseRemainingSlice & { sortKey: string })[] = [];
  for (const expense of expenses) {
    const payerIds: string[] = expense.paidByIds?.length
      ? expense.paidByIds
      : [expense.paidById];
    if (!payerIds.includes(creditorId)) continue;
    const split = expense.splits.find((s) => s.memberId === debtorId);
    if (!split || split.amount <= 0) continue;
    // For multi-payer, the debtor owes creditorId only their proportional share
    const debtorOwesCreditor =
      payerIds.length > 1 ? split.amount / payerIds.length : split.amount;
    if (debtorOwesCreditor <= 0) continue;
    // date is YYYY-MM-DD, so lexicographic sort = chronological
    slices.push({
      expenseId: expense.id,
      splitAmount: debtorOwesCreditor,
      remaining: debtorOwesCreditor,
      sortKey: `${expense.date ?? ''}|${expense.id ?? ''}`,
    });
  }
  slices.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // Gather settlement pool (debtor → creditor), oldest first
  const pool = settlements
    .filter((s) => s.fromId === debtorId && s.toId === creditorId)
    .sort((a, b) => {
      const d = a.settledAt.getTime() - b.settledAt.getTime();
      return d !== 0 ? d : a.id.localeCompare(b.id);
    })
    .reduce((sum, s) => sum + s.amount, 0);

  // FIFO: consume pool against slices
  let remaining = pool;
  for (const slice of slices) {
    const consumed = Math.min(remaining, slice.remaining);
    slice.remaining = Math.max(0, slice.remaining - consumed);
    remaining -= consumed;
    if (remaining <= 0.005) break;
  }

  return slices.map(({ expenseId, splitAmount, remaining: r }) => ({
    expenseId,
    splitAmount,
    remaining: r,
  }));
}

/** Per-member split status for a single expense — used in expense detail views. */
export interface MemberSplitStatus {
  memberId: string;
  memberName: string;
  splitAmount: number;
  remaining: number;
  settled: boolean;
}

/**
 * Returns a status entry for every non-payer member in the expense's splits,
 * showing how much they still owe the payer after FIFO settlement allocation.
 */
export function computeExpenseMemberStatuses(
  expense: GroupExpense,
  allExpenses: GroupExpense[],
  settlements: GroupSettlement[],
): MemberSplitStatus[] {
  const payerIds: string[] = expense.paidByIds?.length
    ? expense.paidByIds
    : [expense.paidById];

  return expense.splits
    .filter((split) => !payerIds.includes(split.memberId))
    .map((split) => {
      // For multi-payer, total remaining across all creditors for this split
      const totalRemaining = payerIds.reduce((sum, creditorId) => {
        const slices = computeExpenseRemaining(allExpenses, settlements, split.memberId, creditorId);
        const slice = slices.find((s) => s.expenseId === expense.id);
        return sum + (slice?.remaining ?? split.amount / payerIds.length);
      }, 0);
      return {
        memberId: split.memberId,
        memberName: split.memberName,
        splitAmount: split.amount,
        remaining: totalRemaining,
        settled: totalRemaining <= 0.005,
      };
    });
}
