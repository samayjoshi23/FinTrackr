import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { authState } from 'rxfire/auth';
import { from, of } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';

/**
 * Requires a signed-in user with a valid ID token. Redirects to `/login` otherwise.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return authState(auth).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        return of(router.createUrlTree(['/login']));
      }
      return from(user.getIdToken()).pipe(
        switchMap((token) => {
          if (!token) {
            return of(router.createUrlTree(['/login']));
          }
          return of(true);
        }),
      );
    }),
  );
};
