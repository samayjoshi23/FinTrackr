import { CommonModule } from '@angular/common';
import { Component, computed, input, model, output } from '@angular/core';
import { Modal } from '../../../../shared/components/modal/modal';
import { Icon } from '../../../../shared/components/icon/icon';
import { GroupExpense, GroupSettlement } from '../../../../shared/models/group.model';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';
import {
  computeExpenseMemberStatuses,
  MemberSplitStatus,
} from '../../group-settlement-allocation.utils';

@Component({
  selector: 'app-expense-detail-modal',
  imports: [CommonModule, Modal, Icon],
  templateUrl: './expense-detail-modal.html',
})
export class ExpenseDetailModal {
  open = model(false);
  expense = input<GroupExpense | null>(null);
  allExpenses = input<GroupExpense[]>([]);
  settlements = input<GroupSettlement[]>([]);
  currentUserId = input.required<string>();

  editRequested = output<GroupExpense>();
  deleteRequested = output<GroupExpense>();

  readonly isPayer = computed(() => {
    const e = this.expense();
    return e ? e.paidById === this.currentUserId() : false;
  });

  readonly memberStatuses = computed<MemberSplitStatus[]>(() => {
    const e = this.expense();
    if (!e) return [];
    return computeExpenseMemberStatuses(e, this.allExpenses(), this.settlements());
  });

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
    }).format(amount);
  }

  onEdit(): void {
    const e = this.expense();
    if (e) this.editRequested.emit(e);
  }

  onDelete(): void {
    const e = this.expense();
    if (e) this.deleteRequested.emit(e);
  }

  payerSplitAmount(expense: GroupExpense): number {
    return expense.splits.find((s) => s.memberId === expense.paidById)?.amount ?? 0;
  }

  close(): void {
    this.open.set(false);
  }
}
