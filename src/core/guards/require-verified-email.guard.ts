import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * Password-provider users must verify their email before entering `/user/**`,
 * unless verification is switched off globally or for that user — see
 * {@link AuthService.mustVerifyEmail}. Google/SSO users always bypass.
 *
 * Runs AFTER {@link authGuard}, so `auth.currentUser` is always populated.
 */
export const requireVerifiedEmailGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  const user = auth.currentUser;
  if (!user) return router.createUrlTree(['/login']);

  if (await authService.mustVerifyEmail(user)) {
    return router.createUrlTree(['/verify-email']);
  }
  return true;
};
