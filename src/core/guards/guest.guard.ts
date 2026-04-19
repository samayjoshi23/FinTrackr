import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * For /login and /register only: if a session exists, send the user to dashboard or onboarding
 * and replace the history entry so the back button does not return to auth screens.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const stored = localStorage.getItem('userProfile');
    if (!stored) return true;
    try {
      const p = JSON.parse(stored) as Record<string, unknown>;
      const uid = typeof p['uid'] === 'string' ? p['uid'] : null;
      if (!uid) return true;
      const path =
        p['isOnboarded'] === true ? '/user/dashboard' : '/onboarding';
      void router.navigateByUrl(path, { replaceUrl: true });
      return false;
    } catch {
      return true;
    }
  }

  return new Promise<boolean>((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(true);
        return;
      }
      const path = await authService.getPostAuthHomePath(user.uid);
      await router.navigateByUrl(path, { replaceUrl: true });
      resolve(false);
    });
  });
};
