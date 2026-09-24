import { APP_BASE_HREF, PathLocationStrategy, PlatformLocation } from '@angular/common';
import { inject, Injectable } from '@angular/core';

/** In-app URL prefix whose navigations are flattened (replace instead of push). */
const IN_APP_PREFIX = '/user';

/**
 * Location strategy that turns **forward navigations within `/user/**` into replacements**
 * instead of history pushes, so the browser history never accumulates in-app screens —
 * it holds at most one `/user` entry plus whatever preceded the app.
 *
 * This is the other half of {@link BrowserBackRedirectService}'s hierarchical back:
 *  - forward navigation is flat (no buried temporal entries), and
 *  - the back button is driven entirely by each route's declared logical parent.
 *
 * Together they make back climb child → parent → … → Home and then exit the app, no matter
 * what path the user took. Navigations OUTSIDE `/user` (auth, onboarding) keep normal push
 * behaviour, so their multi-step back still works natively.
 */
@Injectable()
export class InAppReplaceLocationStrategy extends PathLocationStrategy {
  constructor() {
    super(inject(PlatformLocation), inject(APP_BASE_HREF, { optional: true }) ?? undefined);
  }

  override pushState(state: unknown, title: string, url: string, queryParams: string): void {
    if (this.isInApp(url)) {
      super.replaceState(state, title, url, queryParams);
    } else {
      super.pushState(state, title, url, queryParams);
    }
  }

  private isInApp(url: string): boolean {
    const path = (url || '').split('?')[0].split('#')[0];
    return path === IN_APP_PREFIX || path.startsWith(`${IN_APP_PREFIX}/`);
  }
}
