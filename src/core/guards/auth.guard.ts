import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';

/**
 * Requires a real Firebase Auth session. Firebase persists the signed-in user
 * in its own IndexedDB store (separate from our `localStorage.userProfile`
 * blob), so `onAuthStateChanged` resolves correctly even when offline. We
 * intentionally do NOT trust `localStorage.userProfile` — that key is UX cache
 * only and can be tampered with via DevTools to bypass the guard.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(router.createUrlTree(['/login']));
        return;
      }
      // Best-effort token check; if the network is down, `getIdToken()` may
      // return a cached token or fail — a cached token is still proof of a
      // prior valid session (Firebase refreshes when the network is back).
      try {
        await user.getIdToken();
        resolve(true);
      } catch {
        // Offline: no live token but the user object is present → allow.
        // Firestore rules remain the authoritative gate for every read/write.
        resolve(true);
      }
    });
  });
};
