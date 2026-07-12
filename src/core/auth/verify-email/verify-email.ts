import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth.service';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import { Icon } from '../../../shared/components/icon/icon';

/**
 * Landing page for password-provider users whose email is not yet verified.
 * Shows the address the verification link was sent to, offers a resend, and
 * lets the user check verification status after clicking the emailed link.
 */
@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, Icon],
  templateUrl: './verify-email.html',
})
export class VerifyEmail {
  private readonly auth = inject(Auth);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);

  readonly resending = signal(false);
  readonly checking = signal(false);

  get email(): string {
    return this.auth.currentUser?.email ?? '';
  }

  async onResend(): Promise<void> {
    this.resending.set(true);
    try {
      await this.authService.resendVerificationEmail();
      this.notifier.success('Verification email sent. Check your inbox.');
    } catch {
      this.notifier.error('Could not resend the verification email. Try again shortly.');
    } finally {
      this.resending.set(false);
    }
  }

  async onCheck(): Promise<void> {
    this.checking.set(true);
    try {
      const verified = await this.authService.refreshEmailVerified();
      if (verified) {
        this.notifier.success('Email verified.');
        const uid = this.auth.currentUser?.uid;
        const path = uid ? await this.authService.getPostAuthHomePath(uid) : '/login';
        await this.router.navigateByUrl(path, { replaceUrl: true });
      } else {
        this.notifier.show('Email is not verified yet. Click the link in the email first.');
      }
    } finally {
      this.checking.set(false);
    }
  }

  async onSignOut(): Promise<void> {
    await this.authService.logout();
  }
}
