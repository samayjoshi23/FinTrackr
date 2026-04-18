import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';

/**
 * Requires a signed-in user with a valid ID token. Redirects to `/login` otherwise.
 * When offline, allows access if a cached user profile exists in localStorage.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  // When offline, trust the cached profile to avoid blocking the user
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const stored = localStorage.getItem('userProfile');
    if (stored) return true;
    return router.createUrlTree(['/login']);
  }

  return new Promise((resolve) => {
    // Use the native Firebase Auth state listener — no rxfire dependency
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(router.createUrlTree(['/login']));
        return;
      }
      try {
        const token = await user.getIdToken();
        resolve(token ? true : router.createUrlTree(['/login']));
      } catch {
        resolve(router.createUrlTree(['/login']));
      }
    });
  });
};
