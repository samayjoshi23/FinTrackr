import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

@Injectable({ providedIn: 'root' })
export class AccountInviteService {
  private readonly functions = inject(Functions);

  async respond(accountId: string, accept: boolean): Promise<void> {
    const fn = httpsCallable<{ accountId: string; accept: boolean }, { ok: boolean }>(
      this.functions,
      'respondAccountInvite',
    );
    await fn({ accountId, accept });
  }
}
