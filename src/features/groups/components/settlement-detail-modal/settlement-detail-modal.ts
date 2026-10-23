import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, model } from '@angular/core';
import { Modal } from '../../../../shared/components/modal/modal';
import { Icon } from '../../../../shared/components/icon/icon';
import { GroupSettlement } from '../../../../shared/models/group.model';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';
import { PrivacyPreferencesService } from '../../../../core/services/privacy-preferences.service';
import { formatMoney } from '../../../../shared/utils/format-money';

@Component({
  selector: 'app-settlement-detail-modal',
  imports: [CommonModule, Modal, Icon],
  templateUrl: './settlement-detail-modal.html',
})
export class SettlementDetailModal {
  private readonly privacyPrefs = inject(PrivacyPreferencesService);
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
    if (this.privacyPrefs.hideBalances()) return '••••';
    return formatMoney(amount, currency);
  }

  close(): void {
    this.open.set(false);
  }
}
