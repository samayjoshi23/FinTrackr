import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { GroupsService } from '../../groups.service';
import { GroupExpensesService } from '../../group-expenses.service';
import { GroupSettlementsService } from '../../group-settlements.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { computeBalances, memberAvatarClass, memberInitials } from '../../group-balance.utils';
import { computeExpenseRemaining } from '../../group-settlement-allocation.utils';
import {
  Group,
  GroupExpense,
  GroupMember,
  GroupSettlement,
  MemberBalance,
} from '../../../../shared/models/group.model';
import { AddExpenseModal } from '../../components/add-expense-modal/add-expense-modal';
import { SettleUpModal } from '../../components/settle-up-modal/settle-up-modal';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { ExpenseDetailModal } from '../../components/expense-detail-modal/expense-detail-modal';
import { SettlementDetailModal } from '../../components/settlement-detail-modal/settlement-detail-modal';

// Sentinel to mark names that should not be stored in the name map
const PLACEHOLDER_YOU = 'You';

@Component({
  selector: 'app-group-detail',
  imports: [
    CommonModule,
    Icon,
    AddExpenseModal,
    SettleUpModal,
    ExpenseDetailModal,
    SettlementDetailModal,
    ConfirmPrompt,
  ],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.css',
})
export class GroupDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  private readonly groupsService = inject(GroupsService);
  private readonly expensesService = inject(GroupExpensesService);
  private readonly settlementsService = inject(GroupSettlementsService);
  private readonly notifier = inject(NotifierService);

  loading = signal(true);
  group = signal<Group | null>(null);
  expenses = signal<GroupExpense[]>([]);
  settlements = signal<GroupSettlement[]>([]);
  currentUserId = signal('');

  addExpenseOpen = signal(false);
  settleUpOpen = signal(false);
  activeTab = signal<'expenses' | 'balances'>('expenses');

  /** Pre-selected member id and pre-filled amount when opening settle-up from a balance card. */
  settleUpTargetMemberId = signal('');
  settleUpInitialAmount = signal('');
  /** Member list passed to the settle-up modal; single-element when opened from a balance card. */
  settleUpMembers = signal<GroupMember[]>([]);

  /** Expense detail modal */
  selectedExpense = signal<GroupExpense | null>(null);
  expenseDetailOpen = signal(false);

  /** Expense being edited (null = add mode) */
  editingExpense = signal<GroupExpense | null>(null);

  /** Delete confirm */
  deletePromptOpen = signal(false);
  expenseToDelete = signal<GroupExpense | null>(null);

  /** Settlement detail modal */
  selectedSettlement = signal<GroupSettlement | null>(null);
  settlementDetailOpen = signal(false);

  /**
   * Builds a name map from stored expense / settlement records so we can
   * display real names even for members (e.g. the creator) who were never
   * written into group.members.  We skip the sentinel value 'You' that old
   * data may have stored.
   */
  readonly memberNamesFromData = computed<Map<string, string>>(() => {
    const nameMap = new Map<string, string>();
    for (const expense of this.expenses()) {
      if (expense.paidById && expense.paidByName && expense.paidByName !== PLACEHOLDER_YOU) {
        nameMap.set(expense.paidById, expense.paidByName);
      }
      for (const split of expense.splits) {
        if (split.memberId && split.memberName && split.memberName !== PLACEHOLDER_YOU) {
          nameMap.set(split.memberId, split.memberName);
        }
      }
    }
    for (const s of this.settlements()) {
      if (s.fromId && s.fromName && s.fromName !== PLACEHOLDER_YOU) {
        nameMap.set(s.fromId, s.fromName);
      }
      if (s.toId && s.toName && s.toName !== PLACEHOLDER_YOU) {
        nameMap.set(s.toId, s.toName);
      }
    }
    return nameMap;
  });

  /**
   * Canonical member list that always includes:
   * - every active member from group.members
   * - the group creator (even if not in group.members)
   * - the current user (even if not in group.members)
   * Names are resolved from stored data when not available in group.members.
   */
  readonly resolvedMemberList = computed<GroupMember[]>(() => {
    const g = this.group();
    if (!g) return [];
    const uid = this.currentUserId();
    const nameMap = this.memberNamesFromData();

    const list: GroupMember[] = [...g.members.filter((m) => m.isActive)];

    const ensureMember = (memberId: string, fallbackName: string) => {
      if (!list.some((m) => m.memberId === memberId)) {
        list.push({ memberId, memberDisplayName: fallbackName, isActive: true, joinedAt: null });
      }
    };

    // Ensure creator is present
    if (g.creatorId) {
      const creatorName =
        g.creatorId === uid
          ? (this.auth.currentUser?.displayName ?? nameMap.get(g.creatorId) ?? 'Unknown')
          : (nameMap.get(g.creatorId) ?? 'Unknown');
      ensureMember(g.creatorId, creatorName);
    }

    // Ensure current user is present
    ensureMember(uid, this.auth.currentUser?.displayName ?? 'Me');

    return list;
  });

  readonly balances = computed<MemberBalance[]>(() => {
    const g = this.group();
    if (!g) return [];
    return computeBalances(
      this.expenses(),
      this.settlements(),
      this.resolvedMemberList(),
      this.currentUserId(),
    );
  });

  readonly owingBalances = computed(() => this.balances().filter((b) => b.netAmount < -0.005));
  readonly owedBalances = computed(() => this.balances().filter((b) => b.netAmount > 0.005));
  readonly settledBalances = computed(() =>
    this.balances().filter((b) => Math.abs(b.netAmount) <= 0.005),
  );

  /** All members for the settle-up modal — everyone except the current user. */
  readonly activeMembersExcludingMe = computed<GroupMember[]>(() => {
    const uid = this.currentUserId();
    return this.resolvedMemberList().filter((m) => m.memberId !== uid);
  });

  /** All members for the avatar strip — current user first. */
  readonly allActiveMembers = computed<GroupMember[]>(() => {
    const uid = this.currentUserId();
    const members = this.resolvedMemberList();
    const me = members.find((m) => m.memberId === uid);
    const others = members.filter((m) => m.memberId !== uid);
    return me ? [me, ...others] : others;
  });

  async ngOnInit(): Promise<void> {
    const groupId = this.route.snapshot.paramMap.get('id') ?? '';
    const uid = this.auth.currentUser?.uid ?? '';
    this.currentUserId.set(uid);

    try {
      const [group, expenses, settlements] = await Promise.all([
        this.groupsService.getGroup(groupId),
        this.expensesService.getExpenses(groupId),
        this.settlementsService.getSettlements(groupId),
      ]);
      this.group.set(group);
      this.expenses.set(expenses);
      this.settlements.set(settlements);
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load group.');
    } finally {
      this.loading.set(false);
    }
  }

  goBack(): void {
    void this.router.navigateByUrl('/user/groups');
  }

  /** Opens the settle-up modal pre-selected to the given balance member (single-recipient mode). */
  openSettleUpForMember(b: MemberBalance): void {
    const member = this.resolvedMemberList().find((m) => m.memberId === b.memberId);
    this.settleUpMembers.set(member ? [member] : this.activeMembersExcludingMe());
    this.settleUpTargetMemberId.set(b.memberId);
    this.settleUpInitialAmount.set(Math.abs(b.netAmount).toFixed(2));
    this.settleUpOpen.set(true);
  }

  openExpenseDetail(expense: GroupExpense): void {
    this.selectedExpense.set(expense);
    this.expenseDetailOpen.set(true);
  }

  openSettlementDetail(settlement: GroupSettlement): void {
    this.selectedSettlement.set(settlement);
    this.settlementDetailOpen.set(true);
  }

  openEditExpense(expense: GroupExpense): void {
    this.editingExpense.set(expense);
    this.expenseDetailOpen.set(false);
    this.addExpenseOpen.set(true);
  }

  requestDeleteExpense(expense: GroupExpense): void {
    this.expenseToDelete.set(expense);
    this.expenseDetailOpen.set(false);
    this.deletePromptOpen.set(true);
  }

  async confirmDeleteExpense(agreed: boolean): Promise<void> {
    if (!agreed) return;
    const expense = this.expenseToDelete();
    if (!expense) return;
    const g = this.group();
    if (!g) return;
    try {
      await this.expensesService.deleteExpense(g.id, expense.id);
      this.expenses.update((list) => list.filter((e) => e.id !== expense.id));
      this.expenseToDelete.set(null);
      this.notifier.success('Expense removed.');
    } catch {
      this.notifier.error('Could not delete expense.');
    }
  }

  /**
   * Returns the display name for whoever paid an expense.
   * Falls back to the resolved member list so the creator's real name shows
   * even when old data stored 'You' as paidByName.
   */
  getPaidByName(expense: GroupExpense): string {
    const member = this.resolvedMemberList().find((m) => m.memberId === expense.paidById);
    if (member) return member.memberDisplayName;
    // last-resort: stored name (may be 'You' for old records)
    return expense.paidByName;
  }

  initials(name: string): string {
    return memberInitials(name);
  }

  avatarClass(id: string): string {
    return memberAvatarClass(id);
  }

  formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount));
  }

  async onExpenseAdded(expense: GroupExpense): Promise<void> {
    const editing = this.editingExpense();
    if (editing) {
      // Replace the edited expense in the list
      this.expenses.update((list) => list.map((e) => (e.id === expense.id ? expense : e)));
      this.editingExpense.set(null);
    } else {
      this.expenses.update((list) => [expense, ...list]);
    }
    this.addExpenseOpen.set(false);
  }

  async onSettlementAdded(settlement: GroupSettlement): Promise<void> {
    this.settlements.update((list) => [settlement, ...list]);
    this.settleUpOpen.set(false);
    this.notifier.success('Settlement recorded.');
  }

  expenseSplitLabel(expense: GroupExpense): string {
    const uid = this.currentUserId();
    const expenses = this.expenses();
    const settlements = this.settlements();

    if (expense.paidById === uid) {
      // Sum remaining from all other members to me for this expense
      const remaining = expense.splits
        .filter((s) => s.memberId !== uid)
        .reduce((sum, s) => {
          const slices = computeExpenseRemaining(expenses, settlements, s.memberId, uid);
          const slice = slices.find((sl) => sl.expenseId === expense.id);
          return sum + (slice?.remaining ?? s.amount);
        }, 0);
      if (remaining <= 0.005) return '';
      return `you lent ${this.formatCurrency(remaining, expense.currency)}`;
    }

    // Someone else paid — check what I still owe them
    const slices = computeExpenseRemaining(expenses, settlements, uid, expense.paidById);
    const slice = slices.find((sl) => sl.expenseId === expense.id);
    if (!slice || slice.remaining <= 0.005) return '';
    return `you owe ${this.formatCurrency(slice.remaining, expense.currency)}`;
  }
}
