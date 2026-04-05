import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../../services/auth.service';

/**
 * Prevents already-onboarded users from accessing the onboarding page.
 * Redirects them to `/user/dashboard` instead.
 * Non-authenticated users are allowed through (authGuard handles that separately).
 */
export const onboardingGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const authService = inject(AuthService);
  const router = inject(Router);

  const user = auth.currentUser;
  if (!user) {
    // Not authenticated — let authGuard handle redirect to login
    return true;
  }

  const isOnboarded = await authService.checkOnboardingStatus(user.uid);
  if (isOnboarded) {
    return router.createUrlTree(['/user/dashboard']);
  }

  return true;
};
