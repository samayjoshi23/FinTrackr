import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  inject,
  input,
  model,
  OnChanges,
  output,
  signal,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { Modal } from '../../../../shared/components/modal/modal';
import { GroupExpensesService } from '../../group-expenses.service';
import { GroupCloudFunctionsService } from '../../group-cloud-functions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import {
  Group,
  GroupExpense,
  GroupMember,
  ExpenseSplit,
} from '../../../../shared/models/group.model';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';

type SplitMode = 'equal' | 'custom';

@Component({
  selector: 'app-add-expense-modal',
  imports: [CommonModule, FormsModule, Icon, Modal, DatePicker],
  templateUrl: './add-expense-modal.html',
  styleUrl: './add-expense-modal.css',
})
export class AddExpenseModal implements OnChanges {
  private readonly expensesService = inject(GroupExpensesService);
  private readonly groupCloudFunctions = inject(GroupCloudFunctionsService);
  private readonly notifier = inject(NotifierService);
  private readonly auth = inject(Auth);

  open = model(false);
  group = input.required<Group>();
  currentUserId = input.required<string>();
  members = input<GroupMember[]>([]);
  /** When set, modal operates in edit mode — form is prefilled and save calls updateExpense. */
  editExpense = input<GroupExpense | null>(null);

  expenseAdded = output<GroupExpense>();

  readonly isEditMode = computed(() => this.editExpense() !== null);
  readonly modalTitle = computed(() => (this.isEditMode() ? 'Edit Expense' : 'Add Expense'));

  formModel = {
    description: '',
    amount: '' as string | number,
    paidById: '',
    date: new Date().toISOString().split('T')[0],
  };

  splitMode = signal<SplitMode>('equal');
  saving = signal(false);
  customSplits = signal<{ memberId: string; memberName: string; amount: string }[]>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open()) {
      const edit = this.editExpense();
      if (edit) {
        this.prefillFromExpense(edit);
      } else {
        this.resetForm();
      }
    } else if ((changes['members'] || changes['currentUserId']) && !this.editExpense()) {
      this.resetForm();
    }
  }

  private prefillFromExpense(expense: GroupExpense): void {
    this.formModel.description = expense.description;
    this.formModel.amount = expense.amount;
    this.formModel.paidById = expense.paidById;
    this.formModel.date = expense.date;
    this.splitMode.set('custom');
    const all = this.allMembersForSplit();
    this.customSplits.set(
      all.map((m) => {
        const split = expense.splits.find((s) => s.memberId === m.memberId);
        return {
          memberId: m.memberId,
          memberName: m.memberDisplayName,
          amount: split ? String(split.amount) : '0',
        };
      }),
    );
  }

  private resetForm(): void {
    const uid = this.currentUserId();
    this.formModel.paidById = uid;
    this.formModel.description = '';
    this.formModel.amount = '';
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
    // Use real display name so it gets stored correctly in Firestore
    const realName =
      this.auth.currentUser?.displayName ??
      this.members().find((m) => m.memberId === uid)?.memberDisplayName ??
      'Me';
    const me: GroupMember = {
      memberId: uid,
      memberDisplayName: realName,
      isActive: true,
      joinedAt: null,
    };
    return [me, ...others];
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
    if (uid === this.currentUserId()) {
      return (
        this.auth.currentUser?.displayName ??
        this.members().find((m) => m.memberId === uid)?.memberDisplayName ??
        'Unknown'
      );
    }
    return this.members().find((m) => m.memberId === uid)?.memberDisplayName ?? 'Unknown';
  }

  close(): void {
    this.open.set(false);
  }

  async submit(): Promise<void> {
    const desc = this.formModel.description.trim();
    const amount = parseFloat(String(this.formModel.amount));
    if (!desc) {
      this.notifier.error('Enter a description.');
      return;
    }
    if (!amount || amount <= 0) {
      this.notifier.error('Enter a valid amount.');
      return;
    }
    if (!this.formModel.paidById) {
      this.notifier.error('Select who paid.');
      return;
    }
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
        this.notifier.error(
          `Split amounts must sum to ${amount}. Current total: ${total.toFixed(2)}`,
        );
        return;
      }
      splits = this.customSplits().map((c) => ({
        memberId: c.memberId,
        memberName: c.memberName,
        amount: parseFloat(c.amount) || 0,
        isPaid: c.memberId === this.formModel.paidById,
      }));
    }

    const paidByName =
      all.find((m) => m.memberId === this.formModel.paidById)?.memberDisplayName ?? '';

    this.saving.set(true);
    const editTarget = this.editExpense();
    try {
      if (editTarget) {
        await this.expensesService.updateExpense(this.group().id, editTarget.id, {
          description: desc,
          amount,
          paidById: this.formModel.paidById,
          paidByName,
          splits,
          date: this.formModel.date,
        });
        const updated: GroupExpense = {
          ...editTarget,
          description: desc,
          amount,
          paidById: this.formModel.paidById,
          paidByName,
          splits,
          date: this.formModel.date,
          updatedAt: new Date(),
        };
        this.notifier.success('Expense updated.');
        this.expenseAdded.emit(updated);
      } else {
        const gid = this.group().id;
        const otherMemberIds = this.members()
          .map((m) => m.memberId)
          .filter((id) => id !== this.currentUserId());
        const expenseInput = {
          groupId: gid,
          description: desc,
          amount,
          currency: this.group().currency,
          paidById: this.formModel.paidById,
          paidByName,
          splits,
          date: this.formModel.date,
        };
        const expense = await this.expensesService.addExpense(expenseInput, {
          postSyncCallablesBuilder: (expenseId) => [
            this.groupCloudFunctions.buildNotifyExpenseCallable(
              { ...expenseInput, id: expenseId, createdAt: null, updatedAt: null },
              paidByName,
              otherMemberIds,
            ),
          ],
          onSuccess: (_expenseId, savedExpense) => {
            this.groupCloudFunctions.invokeFireAndForget(
              'notifyGroupExpense',
              this.groupCloudFunctions.buildNotifyExpenseCallable(
                savedExpense,
                paidByName,
                otherMemberIds,
              ).payload,
            );
          },
        });
        this.notifier.success('Expense added.');
        this.expenseAdded.emit(expense);
        this.resetForm();
      }
    } catch (e) {
      console.error(e);
      this.notifier.error(editTarget ? 'Could not update expense.' : 'Could not add expense.');
    } finally {
      this.saving.set(false);
    }
  }
}
