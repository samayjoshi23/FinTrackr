import { CommonModule } from '@angular/common';
import { Component, inject, input, model, OnChanges, output, signal, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from '../../../../shared/components/icon/icon';
import { Modal } from '../../../../shared/components/modal/modal';
import { GroupExpensesService } from '../../group-expenses.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Group, GroupExpense, GroupMember, ExpenseSplit } from '../../../../shared/models/group.model';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';

type SplitMode = 'equal' | 'custom';

const EXPENSE_CATEGORIES = [
  { name: 'Food', icon: 'utensils' },
  { name: 'Transport', icon: 'car-side' },
  { name: 'Bills', icon: 'notes' },
  { name: 'Entertainment', icon: 'entertainment' },
  { name: 'Shopping', icon: 'shopping-bag' },
  { name: 'Travel', icon: 'paper-airplane' },
  { name: 'Health', icon: 'medicine' },
  { name: 'Other', icon: 'wallet' },
];

@Component({
  selector: 'app-add-expense-modal',
  imports: [CommonModule, FormsModule, Icon, Modal],
  templateUrl: './add-expense-modal.html',
  styleUrl: './add-expense-modal.css',
})
export class AddExpenseModal implements OnChanges {
  private readonly expensesService = inject(GroupExpensesService);
  private readonly notifier = inject(NotifierService);

  open = model(false);
  group = input.required<Group>();
  currentUserId = input.required<string>();
  members = input<GroupMember[]>([]);

  expenseAdded = output<GroupExpense>();

  readonly categories = EXPENSE_CATEGORIES;

  formModel = {
    description: '',
    amount: '' as string | number,
    category: 'Other',
    categoryIcon: 'wallet',
    paidById: '',
    date: new Date().toISOString().split('T')[0],
  };

  splitMode = signal<SplitMode>('equal');
  saving = signal(false);
  customSplits = signal<{ memberId: string; memberName: string; amount: string }[]>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['members'] || changes['currentUserId']) {
      this.resetForm();
    }
  }

  private resetForm(): void {
    const uid = this.currentUserId();
    this.formModel.paidById = uid;
    this.formModel.description = '';
    this.formModel.amount = '';
    this.formModel.category = 'Other';
    this.formModel.categoryIcon = 'wallet';
    this.formModel.date = new Date().toISOString().split('T')[0];
    this.splitMode.set('equal');
    this.rebuildCustomSplits();
  }

  private rebuildCustomSplits(): void {
    const all = this.allMembersForSplit();
    this.customSplits.set(
      all.map((m) => ({ memberId: m.memberId, memberName: m.memberDisplayName, amount: '' })),
    );
  }

  allMembersForSplit(): GroupMember[] {
    const uid = this.currentUserId();
    const others = this.members().filter((m) => m.memberId !== uid);
    const me: GroupMember = {
      memberId: uid,
      memberDisplayName: 'You',
      isActive: true,
      joinedAt: null,
    };
    return [me, ...others];
  }

  selectCategory(name: string, icon: string): void {
    this.formModel.category = name;
    this.formModel.categoryIcon = icon;
  }

  onSplitModeChange(mode: SplitMode): void {
    this.splitMode.set(mode);
    if (mode === 'custom') {
      this.rebuildCustomSplits();
    }
  }

  totalCustomSplit(): number {
    return this.customSplits().reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  }

  isSplitMismatch(): boolean {
    const total = this.totalCustomSplit();
    const amount = parseFloat(String(this.formModel.amount));
    return Math.abs(total - amount) > 0.01;
  }

  initials(name: string): string {
    return memberInitials(name);
  }

  avatarClass(id: string): string {
    return memberAvatarClass(id);
  }

  paidByName(): string {
    const uid = this.formModel.paidById;
    if (uid === this.currentUserId()) return 'You';
    return this.members().find((m) => m.memberId === uid)?.memberDisplayName ?? 'Unknown';
  }

  close(): void {
    this.open.set(false);
  }

  async submit(): Promise<void> {
    const desc = this.formModel.description.trim();
    const amount = parseFloat(String(this.formModel.amount));
    if (!desc) { this.notifier.error('Enter a description.'); return; }
    if (!amount || amount <= 0) { this.notifier.error('Enter a valid amount.'); return; }
    if (!this.formModel.paidById) { this.notifier.error('Select who paid.'); return; }
    if (this.saving()) return;

    let splits: ExpenseSplit[];
    const all = this.allMembersForSplit();

    if (this.splitMode() === 'equal') {
      const share = parseFloat((amount / all.length).toFixed(2));
      splits = all.map((m, i) => ({
        memberId: m.memberId,
        memberName: m.memberDisplayName,
        amount: i === 0 ? parseFloat((amount - share * (all.length - 1)).toFixed(2)) : share,
        isPaid: m.memberId === this.formModel.paidById,
      }));
    } else {
      const total = this.totalCustomSplit();
      if (Math.abs(total - amount) > 0.01) {
        this.notifier.error(`Split amounts must sum to ${amount}. Current total: ${total.toFixed(2)}`);
        return;
      }
      splits = this.customSplits().map((c) => ({
        memberId: c.memberId,
        memberName: c.memberName,
        amount: parseFloat(c.amount) || 0,
        isPaid: c.memberId === this.formModel.paidById,
      }));
    }

    const paidByName = all.find((m) => m.memberId === this.formModel.paidById)?.memberDisplayName ?? '';

    this.saving.set(true);
    try {
      const expense = await this.expensesService.addExpense({
        groupId: this.group().id,
        description: desc,
        amount,
        currency: this.group().currency,
        category: this.formModel.category,
        icon: this.formModel.categoryIcon,
        paidById: this.formModel.paidById,
        paidByName,
        splits,
        date: this.formModel.date,
      });
      this.notifier.success('Expense added.');
      this.expenseAdded.emit(expense);
      this.resetForm();
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not add expense.');
    } finally {
      this.saving.set(false);
    }
  }
}
