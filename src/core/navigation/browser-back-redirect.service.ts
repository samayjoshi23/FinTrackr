import { PlatformLocation } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/** Key on `Route.data` — the logical PARENT this screen's back button should go to. */
export const BROWSER_BACK_TARGET_KEY = 'browserBackTarget' as const;

/** URLs under this prefix participate in hierarchical back; everything else (auth,
 *  onboarding) keeps native browser-back behaviour. Kept in sync with
 *  `InAppReplaceLocationStrategy`, which flattens forward navigation for the same prefix. */
const IN_APP_PREFIX = '/user';

/**
 * Hierarchical ("Up") back navigation for the in-app (`/user/**`) area.
 *
 * Problem this solves: the browser/hardware back button replays *temporal* history — the
 * exact reverse of every screen visited, including lateral tab hops and transient screens.
 * Users expect back to climb the logical hierarchy toward Home instead
 * (e.g. Account details → Settings → Home → exit), regardless of the path taken.
 *
 * How it works (two cooperating pieces):
 *  - {@link InAppReplaceLocationStrategy} makes every forward `/user` navigation a history
 *    *replacement*, so the browser holds at most ONE `/user` entry (plus whatever preceded
 *    the app). There are never buried temporal entries to replay.
 *  - This service intercepts `popstate` (a back press, which pops that single `/user` entry
 *    down to the pre-app entry) and, using the current route's declared logical parent
 *    (`data.browserBackTarget`):
 *      • has a parent  → re-instate the current entry (cancel the back) and navigate to the
 *        parent, which the strategy flattens in place → history stays `[preApp, parent]`.
 *        Repeated backs climb child → parent → … → Home.
 *      • no parent (Home) → do nothing; the back already moved to the pre-app entry, so the
 *        app exits / the installed PWA closes.
 *
 * Must be provided on a long-lived shell (`Features`) so the `popstate` listener survives
 * child route teardown. Parent targets support `:param` templates filled from the merged
 * route params (root → leaf), e.g. `/user/groups/:id`.
 */
@Injectable()
export class BrowserBackRedirectService {
  private readonly router = inject(Router);
  private readonly platformLocation = inject(PlatformLocation);
  private readonly destroyRef = inject(DestroyRef);

  /** Resolved parent URL for the current screen, or null (root / non-app screen). */
  private currentBackTarget: string | null = null;
  /** The last settled in-app URL — re-instated to cancel a back press while climbing. */
  private lastInAppUrl: string | null = null;

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.onNavigationEnd());

    this.onNavigationEnd();

    const unlistenPopState = this.platformLocation.onPopState(() => this.onPopState());
    this.destroyRef.onDestroy(() => unlistenPopState());
  }

  private onNavigationEnd(): void {
    const url = this.currentUrl();
    this.currentBackTarget = this.readBrowserBackTarget(this.router.routerState.snapshot.root);
    this.lastInAppUrl = this.isInAppUrl(url) ? url : null;
  }

  private onPopState(): void {
    // Only govern back presses that leave an in-app screen; auth/onboarding keep native back.
    if (!this.lastInAppUrl) return;

    const target = this.currentBackTarget;
    if (!target) {
      // At the root (Home): no parent → allow the pop to stand, exiting the app / closing
      // the installed PWA. (Forward history is flat, so the entry below Home is the
      // pre-app entry, not a buried in-app screen.)
      return;
    }

    // Cancel the back by re-instating the current entry, then navigate up one level. The
    // location strategy flattens that navigation in place, so history stays two-deep and
    // the next back climbs again — child → parent → … → Home.
    const reinstate = this.lastInAppUrl;
    try {
      history.pushState(null, '', reinstate);
    } catch {
      /* history unavailable — fall through to a best-effort navigate */
    }
    void this.router.navigateByUrl(target, { replaceUrl: true });
  }

  private currentUrl(): string {
    return this.router.url ?? '';
  }

  private isInAppUrl(url: string): boolean {
    const path = (url || '').split('?')[0];
    return path === IN_APP_PREFIX || path.startsWith(`${IN_APP_PREFIX}/`);
  }

  private readBrowserBackTarget(root: ActivatedRouteSnapshot): string | null {
    const leaf = this.leafPrimaryRoute(root);
    const raw = leaf.data[BROWSER_BACK_TARGET_KEY];
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return this.resolveBackTargetTemplate(leaf, raw);
  }

  /** Merges `params` from root → leaf so nested routes see parent path params. */
  private mergedRouteParams(leaf: ActivatedRouteSnapshot): Record<string, string> {
    const chain: ActivatedRouteSnapshot[] = [];
    let n: ActivatedRouteSnapshot | null = leaf;
    while (n) {
      chain.push(n);
      n = n.parent;
    }
    const merged: Record<string, string> = {};
    for (let i = chain.length - 1; i >= 0; i--) {
      const p = chain[i]!.params;
      for (const key of Object.keys(p)) {
        const v = p[key];
        if (v != null && v !== '') merged[key] = String(v);
      }
    }
    return merged;
  }

  /**
   * If `template` contains `:param` tokens, substitutes from `mergedRouteParams(leaf)`.
   * Otherwise returns `template` unchanged. Returns null if a token is missing.
   */
  private resolveBackTargetTemplate(leaf: ActivatedRouteSnapshot, template: string): string | null {
    const params = this.mergedRouteParams(leaf);
    const tokenRe = /:(\w+)/g;
    let m: RegExpExecArray | null;
    const keysNeeded = new Set<string>();
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(template)) !== null) {
      keysNeeded.add(m[1]!);
    }
    if (keysNeeded.size === 0) return template;

    for (const key of keysNeeded) {
      if (!(key in params)) return null;
    }

    return template.replace(/:(\w+)/g, (_match, key: string) => encodeURIComponent(params[key]!));
  }

  private leafPrimaryRoute(route: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
    let r = route;
    while (r.firstChild) {
      r = r.firstChild;
    }
    return r;
  }
}
