import { PlatformLocation } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/** Key on `Route.data` — the logical PARENT this screen's back button should go to. */
export const BROWSER_BACK_TARGET_KEY = 'browserBackTarget' as const;

/** URLs under this prefix get hierarchical back; everything else (auth, onboarding)
 *  keeps native browser-back behaviour. */
const IN_APP_PREFIX = '/user';

/** Marks a history entry as our own sentinel. */
const SENTINEL_STATE = { __backTrap: true } as const;

/**
 * Hierarchical ("Up") back navigation for the in-app (`/user/**`) area.
 *
 * The browser/hardware back button (and Android's back swipe) normally replays *temporal*
 * history — the exact reverse of every screen visited. Users expect back to climb the
 * logical hierarchy toward Home instead (e.g. Account details → Settings → Home → exit),
 * regardless of the path taken.
 *
 * Mechanism — a **sentinel buffer** that is always kept on top of the history stack while
 * an in-app screen is showing:
 *  1. After every in-app navigation we push a sentinel (a duplicate of the current URL).
 *     A back press therefore pops the *sentinel*, not the real screen — so we stay in the
 *     app and get a `popstate` to act on (this is what prevents the app from simply
 *     closing on the first back).
 *  2. In `popstate` we look up the current route's declared parent (`data.browserBackTarget`):
 *       • has a parent → navigate to it (replacing the current entry); the next
 *         `NavigationEnd` re-arms the sentinel, so repeated backs climb child → parent → …
 *         → Home. Buried temporal entries are never visited.
 *       • no parent (Home) → unwind the remaining in-app history so the app exits / the
 *         installed PWA closes.
 *
 * Must be provided on a long-lived shell (`Features`) so the listener survives child route
 * teardown. Parent targets support `:param` templates filled from the merged route params
 * (root → leaf), e.g. `/user/groups/:id`.
 */
@Injectable()
export class BrowserBackRedirectService {
  private readonly router = inject(Router);
  private readonly platformLocation = inject(PlatformLocation);
  private readonly destroyRef = inject(DestroyRef);

  /** Resolved parent URL for the current screen, or null (root / non-app screen). */
  private currentBackTarget: string | null = null;
  /** True while a sentinel we pushed is sitting on top of the history stack. */
  private sentinelArmed = false;

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
    this.currentBackTarget = this.readBrowserBackTarget(this.router.routerState.snapshot.root);
    this.armSentinel();
  }

  /** Keep a sentinel on top so the next back press is absorbed by us, not by history. */
  private armSentinel(): void {
    if (!this.isInAppUrl(this.currentUrl())) {
      this.sentinelArmed = false;
      return;
    }
    try {
      history.pushState(SENTINEL_STATE, '', window.location.href);
      this.sentinelArmed = true;
    } catch {
      // history unavailable (very old webview) — degrade to native back.
      this.sentinelArmed = false;
    }
  }

  private onPopState(): void {
    // Not our sentinel (auth screen, our own exit-back, or a stale event) — leave the
    // native behaviour so the browser/PWA can proceed (this is how the app exits at Home).
    if (!this.sentinelArmed) return;
    this.sentinelArmed = false;

    const target = this.currentBackTarget;
    if (target) {
      // Climb one level. Deferred so Angular Router finishes its OWN popstate handling
      // (which restores the just-popped URL) BEFORE we navigate — otherwise that restore
      // races and overrides our climb. `replaceUrl` keeps the stack from growing on the
      // way up; NavigationEnd re-arms the sentinel so the next back climbs again.
      window.setTimeout(() => void this.router.navigateByUrl(target, { replaceUrl: true }), 0);
      return;
    }

    // At Home (no parent): the sentinel we just consumed kept us in-app; issue one more
    // back so the app exits / the installed PWA closes. If history has buried entries
    // instead, the browser lands on the previous one (still usable) — the next
    // NavigationEnd re-arms the trap there.
    window.setTimeout(() => history.back(), 0);
  }

  private currentUrl(): string {
    return this.router.url ?? '';
  }

  private isInAppUrl(url: string): boolean {
    return this.isInAppPath((url || '').split('?')[0]);
  }

  private isInAppPath(path: string): boolean {
    const p = (path || '').split('?')[0];
    return p === IN_APP_PREFIX || p.startsWith(`${IN_APP_PREFIX}/`);
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
