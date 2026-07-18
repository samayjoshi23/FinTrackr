import { inject, Injectable } from '@angular/core';
import {
  Auth,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../core/auth/auth.service';

@Injectable({ providedIn: 'root' })
export class AccountDeletionService {
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);
  private readonly authService = inject(AuthService);

  getAuthProvider(): 'password' | 'google' {
    const user = this.auth.currentUser;
    if (!user) return 'password';
    if (user.providerData.some((p) => p.providerId === 'google.com')) return 'google';
    return 'password';
  }

  async reauthenticate(password?: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not signed in.');

    const provider = this.getAuthProvider();

    if (provider === 'google') {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
    } else {
      if (!password) throw new Error('Password is required.');
      if (!user.email) throw new Error('No email associated with this account.');
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
    }
  }

  async deleteAccount(): Promise<void> {
    const fn = httpsCallable(this.functions, 'deleteUserAccount');
    await fn({});
    await this.authService.logout();
  }
}
