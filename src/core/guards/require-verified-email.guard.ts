import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

/**
 * Password-provider users must verify their email before entering `/user/**`.
 * Google/SSO users bypass — their identity is already verified by the provider.
 *
 * Runs AFTER {@link authGuard}, so `auth.currentUser` is always populated.
 */
export const requireVerifiedEmailGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  const user = auth.currentUser;
  if (!user) return router.createUrlTree(['/login']);

  if (authService.requiresEmailVerification(user)) {
    return router.createUrlTree(['/verify-email']);
  }
  return true;
};
