import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * Root path `/`: routes based on the real Firebase Auth session (persisted by
 * Firebase in a dedicated IndexedDB store; works offline). Anonymous users go
 * to /login; signed-in users go to dashboard or onboarding based on their
 * cached user doc. Never trusts `localStorage.userProfile` alone — DevTools
 * tampering with that key must not put the user into a signed-in shell.
 */
export const appEntryGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

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
