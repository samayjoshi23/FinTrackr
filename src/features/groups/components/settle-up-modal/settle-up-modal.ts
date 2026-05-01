import { CommonModule } from '@angular/common';
import { Component, inject, input, model, OnChanges, output, signal, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from '../../../../shared/components/icon/icon';
import { Modal } from '../../../../shared/components/modal/modal';
import { GroupSettlementsService } from '../../group-settlements.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Group, GroupMember, GroupSettlement } from '../../../../shared/models/group.model';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';

@Component({
  selector: 'app-settle-up-modal',
  imports: [CommonModule, FormsModule, Icon, Modal],
  templateUrl: './settle-up-modal.html',
  styleUrl: './settle-up-modal.css',
})
export class SettleUpModal implements OnChanges {
  private readonly settlementsService = inject(GroupSettlementsService);
  private readonly notifier = inject(NotifierService);

  open = model(false);
  group = input.required<Group>();
  currentUserId = input.required<string>();
  currentUserName = input<string>('Me');
  members = input<GroupMember[]>([]);

  settlementAdded = output<GroupSettlement>();

  selectedMemberId = signal('');
  amount = signal<string>('');
  note = signal('');
  saving = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['members']) {
      const first = this.members()[0];
      this.selectedMemberId.set(first?.memberId ?? '');
      this.amount.set('');
      this.note.set('');
    }
  }

  selectMember(id: string): void {
    this.selectedMemberId.set(id);
  }

  initials(name: string): string {
    return memberInitials(name);
  }

  avatarClass(id: string): string {
    return memberAvatarClass(id);
  }

  close(): void {
    this.open.set(false);
  }

  async submit(): Promise<void> {
    const amt = parseFloat(this.amount());
    const toId = this.selectedMemberId();
    if (!toId) { this.notifier.error('Select a member.'); return; }
    if (!amt || amt <= 0) { this.notifier.error('Enter a valid amount.'); return; }
    if (this.saving()) return;

    const toMember = this.members().find((m) => m.memberId === toId);
    if (!toMember) return;

    this.saving.set(true);
    try {
      const settlement = await this.settlementsService.addSettlement({
        groupId: this.group().id,
        fromId: this.currentUserId(),
        fromName: this.currentUserName(),
        toId,
        toName: toMember.memberDisplayName,
        amount: amt,
        currency: this.group().currency,
        note: this.note().trim(),
      });
      this.amount.set('');
      this.note.set('');
      this.settlementAdded.emit(settlement);
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not record settlement.');
    } finally {
      this.saving.set(false);
    }
  }
}
