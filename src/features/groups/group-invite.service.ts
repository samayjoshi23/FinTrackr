import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

@Injectable({ providedIn: 'root' })
export class GroupInviteService {
  private readonly functions = inject(Functions);

  /** Invites a user (by email) to a group and sends them a GROUP_INVITE notification. */
  async sendInvite(groupId: string, inviteeEmail: string): Promise<void> {
    const fn = httpsCallable<{ groupId: string; inviteeEmail: string }, { ok: boolean }>(
      this.functions,
      'sendGroupInvite',
    );
    await fn({ groupId, inviteeEmail });
  }

  /** Accept or decline a group invite. */
  async respond(groupId: string, accept: boolean): Promise<void> {
    const fn = httpsCallable<{ groupId: string; accept: boolean }, { ok: boolean }>(
      this.functions,
      'respondGroupInvite',
    );
    await fn({ groupId, accept });
  }
}
