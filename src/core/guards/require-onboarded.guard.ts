import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * Requires a completed onboarding (Firestore / cached `isOnboarded`).
 * Runs after {@link authGuard} on the `/user/**` shell.
 */
export const requireOnboardedGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const raw = localStorage.getItem('userProfile');
    if (!raw) {
      return router.createUrlTree(['/login']);
    }
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (p['isOnboarded'] === true) return true;
      return router.createUrlTree(['/onboarding']);
    } catch {
      return router.createUrlTree(['/onboarding']);
    }
  }

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
