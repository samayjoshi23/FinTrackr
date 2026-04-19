import { Component, inject, signal } from '@angular/core';
import { Icon } from '../../../shared/components/icon/icon';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { FirebaseError } from 'firebase/app';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import { NotifierSeverity } from '../../../shared/components/notifier/types';

@Component({
  selector: 'app-login',
  imports: [Icon, RouterLink, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  // Inject dependencies
  private readonly formBuilder = inject(FormBuilder);
  private readonly notifier = inject(NotifierService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // Form state
  isSubmitting = signal(false);
  readonly loginForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  async onSubmit() {
    this.loginForm.markAllAsTouched();

    if (this.loginForm.invalid) {
      return;
    }

    this.isSubmitting.set(true);

    try {
      const { email, password } = this.loginForm.getRawValue();
      const normalizedEmail = email ?? '';
      const normalizedPassword = password ?? '';
      const user = await this.authService.loginWithEmail(normalizedEmail, normalizedPassword);
      this.notifier.success('Logged in successfully.');
      await this.navigateAfterAuth(user.uid);
    } catch (error) {
      this.notifier.error(this.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async onGoogleLogin() {
    this.isSubmitting.set(true);

    try {
      const user = await this.authService.loginWithGoogle();
      this.notifier.success('Google login successful.');
      await this.navigateAfterAuth(user.uid);
    } catch (error) {
      this.notifier.error(this.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private async navigateAfterAuth(uid: string) {
    const path = await this.authService.getPostAuthHomePath(uid);
    await this.router.navigateByUrl(path, { replaceUrl: true });
  }

  async onForgotPassword() {
    const email = this.loginForm.controls.email.value?.trim() ?? '';

    if (!email) {
      this.notifier.show(
        'Enter your email first, then click reset password.',
        NotifierSeverity.WARNING,
      );
      return;
    }

    try {
      await this.authService.resetPassword(email);
      this.notifier.show('Password reset email sent.', NotifierSeverity.PRIMARY);
    } catch (error) {
      this.notifier.error(this.getErrorMessage(error));
    }
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof FirebaseError)) {
      return 'Something went wrong. Please try again.';
    }

    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email or password.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again in a few minutes.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in was cancelled.';
      default:
        return error.message || 'Authentication failed.';
    }
  }
}
