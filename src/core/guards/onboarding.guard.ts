import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';

/**
 * Prevents already-onboarded users from re-entering the onboarding flow.
 * Reads `isOnboarded` from the cached `userProfile` in localStorage — the
 * same field that AuthService writes after every login/signup.
 * Non-authenticated users are allowed through (authGuard handles that case).
 */
export const onboardingGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  const user = auth.currentUser;
  if (!user) return true;

  try {
    const raw = localStorage.getItem('userProfile');
    if (raw) {
      const profile = JSON.parse(raw) as Record<string, unknown>;
      if (profile['uid'] === user.uid && profile['isOnboarded'] === true) {
        return router.createUrlTree(['/user/dashboard']);
      }
    }
  } catch {
    /* ignore corrupt cache — let the user proceed to onboarding */
  }

  return true;
};
