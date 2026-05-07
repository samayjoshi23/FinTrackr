import { CommonModule } from '@angular/common';
import { Component, computed, input, model } from '@angular/core';
import { Modal } from '../../../../shared/components/modal/modal';
import { Icon } from '../../../../shared/components/icon/icon';
import { GroupSettlement } from '../../../../shared/models/group.model';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';

@Component({
  selector: 'app-settlement-detail-modal',
  imports: [CommonModule, Modal, Icon],
  templateUrl: './settlement-detail-modal.html',
})
export class SettlementDetailModal {
  open = model(false);
  settlement = input<GroupSettlement | null>(null);
  currentUserId = input.required<string>();

  readonly isOutgoing = computed(() => {
    const s = this.settlement();
    return s ? s.fromId === this.currentUserId() : false;
  });

  readonly directionLabel = computed(() => {
    const s = this.settlement();
    if (!s) return '';
    return s.fromId === this.currentUserId()
      ? `You paid ${s.toName}`
      : `${s.fromName} paid you`;
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

  close(): void {
    this.open.set(false);
  }
}
