import { inject, Injector, runInInjectionContext } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { authState } from 'rxfire/auth';
import { from, of } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';

/**
 * Requires a signed-in user with a valid ID token. Redirects to `/login` otherwise.
 * When offline, allows access if a cached user profile exists in localStorage.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const injector = inject(Injector);

  // When offline, trust the cached profile to avoid blocking the user
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const stored = localStorage.getItem('userProfile');
    if (stored) return of(true);
    return of(router.createUrlTree(['/login']));
  }

  return authState(auth).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        return of(router.createUrlTree(['/login']));
      }
      // Keep Firebase API calls inside an Angular injection context.
      return from(
        runInInjectionContext(injector, () => user.getIdToken()),
      ).pipe(
        switchMap((token) => {
          if (!token) return of(router.createUrlTree(['/login']));
          return of(true);
        }),
      );
    }),
  );
};
