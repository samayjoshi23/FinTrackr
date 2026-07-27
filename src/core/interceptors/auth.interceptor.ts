import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { HttpInterceptorFn } from '@angular/common/http';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/**
 * Hosts that are allowed to see the Firebase ID token. All Firebase SDKs
 * bypass this interceptor (they use their own SDK-level auth); this list
 * exists so that if a future `HttpClient.get(url)` call were added, it
 * could not silently leak the token to an arbitrary origin.
 *
 * Match by suffix (`endsWith`) on the URL's hostname:
 *   - *.googleapis.com — Firestore, Storage REST, etc.
 *   - *.cloudfunctions.net — Cloud Function HTTPS triggers
 *   - a<project>.web.app / firebaseapp.com — app's own hosting origin
 * Plus the current page origin (`location.hostname`) — same-origin API calls.
 */
const AUTH_HOST_SUFFIXES = [
  '.googleapis.com',
  '.cloudfunctions.net',
  '.web.app',
  '.firebaseapp.com',
];

function isAuthHost(url: string): boolean {
  try {
    // Resolve against document base so relative URLs (same-origin) are handled.
    const base =
      typeof location !== 'undefined' ? location.origin : 'http://localhost/';
    const parsed = new URL(url, base);
    const host = parsed.hostname;
    if (
      typeof location !== 'undefined' &&
      location.hostname &&
      host === location.hostname
    ) {
      return true;
    }
    return AUTH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    // Un-parseable URL — do not attach the token.
    return false;
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);

  // Never attach the ID token to a request going to an untrusted host —
  // Firebase ID tokens grant full Firestore/Storage access under the current
  // user's rules; leaking one to a third-party host is a silent takeover.
  if (!isAuthHost(req.url)) {
    return next(req);
  }

  const tokenPromise =
    typeof navigator !== 'undefined' && !navigator.onLine
      ? Promise.resolve(null)
      : (auth.currentUser?.getIdToken() ?? Promise.resolve(null));

  return from(tokenPromise).pipe(
    switchMap((token) => {
      if (!token) {
        return next(req);
      }

      return next(
        req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`,
          },
        }),
      );
    }),
  );
};
