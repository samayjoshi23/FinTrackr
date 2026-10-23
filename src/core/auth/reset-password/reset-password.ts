import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../shared/components/icon/icon';
import { AuthService } from '../auth.service';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import { authErrorMessage } from '../auth-error-message';

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, Icon],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly notifier = inject(NotifierService);
  private readonly router = inject(Router);

  isSubmitting = signal(false);
  emailSent = signal(false);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const email = this.form.getRawValue().email?.trim() ?? '';
    this.isSubmitting.set(true);

    try {
      await this.authService.resetPassword(email);
      this.emailSent.set(true);
    } catch (error) {
      this.notifier.error(this.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  goBack() {
    void this.router.navigateByUrl('/login');
  }

  private getErrorMessage(error: unknown): string {
    return authErrorMessage(error, 'Could not send reset email.', {
      'auth/user-not-found': 'No account found with that email address.',
      'auth/invalid-email': 'No account found with that email address.',
      'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    });
  }
}
