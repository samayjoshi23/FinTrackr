import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * Root path `/`: send anonymous users to login; signed-in users to dashboard or onboarding.
 * Uses replaceUrl so the empty shell route does not pollute history.
 */
export const appEntryGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const stored = localStorage.getItem('userProfile');
    if (stored) {
      try {
        const p = JSON.parse(stored) as Record<string, unknown>;
        const path =
          p['isOnboarded'] === true ? '/user/dashboard' : '/onboarding';
        void router.navigateByUrl(path, { replaceUrl: true });
      } catch {
        void router.navigateByUrl('/login', { replaceUrl: true });
      }
    } else {
      void router.navigateByUrl('/login', { replaceUrl: true });
    }
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        await router.navigateByUrl('/login', { replaceUrl: true });
        resolve(false);
        return;
      }
      const path = await authService.getPostAuthHomePath(user.uid);
      await router.navigateByUrl(path, { replaceUrl: true });
      resolve(false);
    });
  });
};
