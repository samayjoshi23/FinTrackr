import { Component, inject, signal } from '@angular/core';
import { Icon } from '../../../shared/components/icon/icon';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { FirebaseError } from 'firebase/app';
import { NotifierService } from '../../../shared/components/notifier/notifier.service';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { NotifierSeverity } from '../../../shared/components/notifier/types';
import { UserProfile } from 'firebase/auth';

@Component({
  selector: 'app-signup',
  imports: [Icon, RouterLink, ReactiveFormsModule],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup {
  // Inject dependencies
  private readonly formBuilder = inject(FormBuilder);
  private readonly notifier = inject(NotifierService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // Form state
  isSubmitting = signal(false);
  userProfile = signal<UserProfile | null>(null);
  readonly signupForm = this.formBuilder.group(
    {
      fullName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordsMatchValidator },
  );

  async onSubmit() {
    this.signupForm.markAllAsTouched();

    if (this.signupForm.hasError('passwordMismatch')) {
      this.notifier.show('Password and confirm password must match.', NotifierSeverity.WARNING);
      return;
    }

    if (this.signupForm.invalid) {
      return;
    }

    this.isSubmitting.set(true);

    try {
      const { fullName, email, password } = this.signupForm.getRawValue();
      const normalizedFullName = fullName ?? '';
      const normalizedEmail = email ?? '';
      const normalizedPassword = password ?? '';
      await this.authService.signupWithEmail(
        normalizedFullName,
        normalizedEmail,
        normalizedPassword,
      );
      this.notifier.success('Welcome to FinTrackr! Please complete your profile to get started.');
      await this.router.navigateByUrl('/user/onboarding');
    } catch (error) {
      this.notifier.error(this.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private passwordsMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;

    if (!password || !confirmPassword) {
      return null;
    }

    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  async onGoogleSignup() {
    this.isSubmitting.set(true);

    try {
      await this.authService.signupWithGoogle();
      this.notifier.success('Google sign-up successful.');
      await this.router.navigateByUrl('/user/onboarding');
    } catch (error) {
      this.notifier.error(this.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof FirebaseError)) {
      return 'Something went wrong. Please try again.';
    }

    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'This email is already registered.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/weak-password':
        return 'Password is too weak. Use a stronger password.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-up was cancelled.';
      default:
        return error.message || 'Sign-up failed.';
    }
  }
}
