import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * Requires a completed onboarding. Runs after {@link authGuard} on `/user/**`.
 *
 * Onboarding status comes from Firestore (via `AuthService.checkOnboardingStatus`),
 * which itself falls back to the cached `userProfile.isOnboarded` when offline.
 * The `localStorage` read only decides the "onboarded vs not" hop AFTER Firebase
 * has confirmed the auth session — an attacker who plants a fake userProfile
 * still needs a real Firebase session to reach this guard at all.
 */
export const requireOnboardedGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(router.createUrlTree(['/login']));
        return;
      }
      const onboarded = await authService.checkOnboardingStatus(user.uid);
      resolve(onboarded ? true : router.createUrlTree(['/onboarding']));
    });
  });
};
