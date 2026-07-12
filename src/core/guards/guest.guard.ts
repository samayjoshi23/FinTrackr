import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * For /login and /register only. Waits on the real Firebase Auth state; when
 * a session exists, sends the user to their post-auth home (dashboard or
 * onboarding). Never trusts `localStorage.userProfile` alone — Firebase's own
 * persistence layer is the source of truth for "is this user signed in?".
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

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
