import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Icon } from '../../../../shared/components/icon/icon';
import { UsersSearchFilterPipe } from '../../../../shared/pipes/users-search-filter.pipe';
import { GroupsService } from '../../groups.service';
import { GroupExpensesService } from '../../group-expenses.service';
import { GroupSettlementsService } from '../../group-settlements.service';
import { GroupInviteService } from '../../group-invite.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { UsersLookupService, UserLookupHit } from '../../../../services/users-lookup.service';
import {
  computeBalances,
  memberAvatarClass,
  memberInitials,
  totalNetBalance,
} from '../../group-balance.utils';
import { Group } from '../../../../shared/models/group.model';

interface GroupListItem {
  group: Group;
  netBalance: number;
  memberCount: number;
}

@Component({
  selector: 'app-groups-list',
  imports: [CommonModule, FormsModule, Icon, UsersSearchFilterPipe],
  templateUrl: './groups-list.html',
  styleUrl: './groups-list.css',
})
export class GroupsList implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly groupsService = inject(GroupsService);
  private readonly expensesService = inject(GroupExpensesService);
  private readonly settlementsService = inject(GroupSettlementsService);
  private readonly inviteService = inject(GroupInviteService);
  private readonly notifier = inject(NotifierService);
  readonly usersLookup = inject(UsersLookupService);

  loading = signal(true);
  groupItems = signal<GroupListItem[]>([]);
  currentUserId = signal('');

  createExpanded = signal(false);
  newGroupName = '';
  memberSearchQuery = '';
  invitedMembers = signal<UserLookupHit[]>([]);
  creating = signal(false);

  private ownerUid = '';

  readonly memberSearchExcludeUids = computed(() => [
    this.currentUserId(),
    ...this.invitedMembers().map((m) => m.uid),
  ]);

  readonly totalOwed = computed(() =>
    this.groupItems()
      .filter((g) => g.netBalance > 0)
      .reduce((s, g) => s + g.netBalance, 0),
  );

  readonly totalOwing = computed(() =>
    this.groupItems()
      .filter((g) => g.netBalance < 0)
      .reduce((s, g) => s + g.netBalance, 0),
  );

  async ngOnInit(): Promise<void> {
    const uid = this.auth.currentUser?.uid ?? '';
    this.currentUserId.set(uid);
    this.ownerUid = uid;

    try {
      const groups = await this.groupsService.getMyGroups();
      const items = await Promise.all(
        groups.map(async (group) => {
          try {
            const [expenses, settlements] = await Promise.all([
              this.expensesService.getExpenses(group.id),
              this.settlementsService.getSettlements(group.id),
            ]);
            const balances = computeBalances(expenses, settlements, group.members, uid);
            return {
              group,
              netBalance: totalNetBalance(balances),
              memberCount: group.members.filter((m) => m.isActive).length + 1,
            };
          } catch {
            return { group, netBalance: 0, memberCount: group.members.length };
          }
        }),
      );
      this.groupItems.set(items);
    } finally {
      this.loading.set(false);
    }
  }

  openGroup(groupId: string): void {
    void this.router.navigateByUrl(`/user/groups/${groupId}`);
  }

  toggleCreatePanel(): void {
    const next = !this.createExpanded();
    this.createExpanded.set(next);
    if (next) void this.usersLookup.loadUsersDirectory();
  }

  openCreatePanel(): void {
    this.createExpanded.set(true);
    void this.usersLookup.loadUsersDirectory();
  }

  onMemberSearchChange(): void {
    const q = this.memberSearchQuery.trim();
    if (q.length >= 2) void this.usersLookup.loadUsersDirectory();
  }

  pickMember(hit: UserLookupHit, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (hit.uid === this.ownerUid) {
      this.notifier.error("You can't add yourself.");
      return;
    }
    if (this.invitedMembers().some((m) => m.uid === hit.uid)) {
      this.notifier.show('This person is already added.');
      return;
    }
    this.invitedMembers.update((list) => [...list, hit]);
    this.memberSearchQuery = '';
  }

  removeInvited(uid: string): void {
    this.invitedMembers.update((list) => list.filter((m) => m.uid !== uid));
  }

  async submitNewGroup(): Promise<void> {
    const name = this.newGroupName.trim();
    if (!name) {
      this.notifier.error('Enter a group name.');
      return;
    }
    if (this.creating()) return;
    this.creating.set(true);
    try {
      // Pending members are added by `sendGroupInvite` so invites and notifications are not skipped.
      const group = await this.groupsService.createGroup({
        name,
        currency: 'INR',
        creatorId: this.ownerUid,
        members: [],
      });

      for (const m of this.invitedMembers()) {
        try {
          await this.inviteService.sendInvite(group.id, m.email);
        } catch (e) {
          console.error('Failed to send invite to', m.email, e);
        }
      }

      this.notifier.success('Group created!');
      this.newGroupName = '';
      this.memberSearchQuery = '';
      this.invitedMembers.set([]);
      this.createExpanded.set(false);
      await this.router.navigateByUrl(`/user/groups/${group.id}`, { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not create group.');
    } finally {
      this.creating.set(false);
    }
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

  onBack(): void {
    void this.router.navigateByUrl('/user/home');
  }
}
