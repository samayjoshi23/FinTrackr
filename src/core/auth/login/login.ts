import { Component, inject, signal } from '@angular/core';
import { Icon } from '../../../shared/components/icon/icon';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import { authErrorMessage } from '../auth-error-message';

@Component({
  selector: 'app-login',
  imports: [Icon, RouterLink, ReactiveFormsModule],
  templateUrl: './login.html',
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

  private getErrorMessage(error: unknown): string {
    return authErrorMessage(error, 'Authentication failed.');
  }
}
