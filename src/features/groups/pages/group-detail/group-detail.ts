import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, TemplateRef, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { GroupsService } from '../../groups.service';
import { GroupExpensesService } from '../../group-expenses.service';
import { GroupSettlementsService } from '../../group-settlements.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { computeBalances, memberAvatarClass, memberInitials } from '../../group-balance.utils';
import {
  Group,
  GroupExpense,
  GroupMember,
  GroupSettlement,
  MemberBalance,
} from '../../../../shared/models/group.model';
import { AddExpenseModal } from '../../components/add-expense-modal/add-expense-modal';
import { SettleUpModal } from '../../components/settle-up-modal/settle-up-modal';

@Component({
  selector: 'app-group-detail',
  imports: [CommonModule, Icon, AddExpenseModal, SettleUpModal],
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

  readonly addExpenseBodyTpl = viewChild<TemplateRef<unknown>>('addExpenseBody');
  readonly settleUpBodyTpl = viewChild<TemplateRef<unknown>>('settleUpBody');

  loading = signal(true);
  group = signal<Group | null>(null);
  expenses = signal<GroupExpense[]>([]);
  settlements = signal<GroupSettlement[]>([]);
  currentUserId = signal('');

  addExpenseOpen = signal(false);
  settleUpOpen = signal(false);
  activeTab = signal<'expenses' | 'balances'>('expenses');

  readonly balances = computed<MemberBalance[]>(() => {
    const g = this.group();
    if (!g) return [];
    return computeBalances(this.expenses(), this.settlements(), g.members, this.currentUserId());
  });

  readonly activeMembersExcludingMe = computed<GroupMember[]>(() => {
    const g = this.group();
    if (!g) return [];
    const uid = this.currentUserId();
    return g.members.filter((m) => m.isActive && m.memberId !== uid);
  });

  readonly allActiveMembers = computed<GroupMember[]>(() => {
    const g = this.group();
    if (!g) return [];
    const uid = this.currentUserId();

    const me: GroupMember = {
      memberId: uid,
      memberDisplayName: this.auth.currentUser?.displayName ?? 'Me',
      isActive: true,
      joinedAt: null,
    };
    const others = g.members.filter((m) => m.isActive);
    const meAlreadyInList = others.some((m) => m.memberId === uid);
    const creator = g.creatorId === uid;
    if (!meAlreadyInList && (creator || true)) {
      return [me, ...others];
    }
    return others;
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
    this.expenses.update((list) => [expense, ...list]);
    this.addExpenseOpen.set(false);
  }

  async onSettlementAdded(settlement: GroupSettlement): Promise<void> {
    this.settlements.update((list) => [settlement, ...list]);
    this.settleUpOpen.set(false);
    this.notifier.success('Settlement recorded.');
  }

  async deleteExpense(expense: GroupExpense, event: Event): Promise<void> {
    event.stopPropagation();
    const g = this.group();
    if (!g) return;
    try {
      await this.expensesService.deleteExpense(g.id, expense.id);
      this.expenses.update((list) => list.filter((e) => e.id !== expense.id));
      this.notifier.success('Expense removed.');
    } catch {
      this.notifier.error('Could not delete expense.');
    }
  }

  expenseSplitLabel(expense: GroupExpense): string {
    const uid = this.currentUserId();
    const mySplit = expense.splits.find((s) => s.memberId === uid);
    if (!mySplit) return '';
    if (expense.paidById === uid) {
      const othersTotal = expense.splits
        .filter((s) => s.memberId !== uid)
        .reduce((sum, s) => sum + s.amount, 0);
      return `you lent ${this.formatCurrency(othersTotal, expense.currency)}`;
    }
    return `you owe ${this.formatCurrency(mySplit.amount, expense.currency)}`;
  }
}
