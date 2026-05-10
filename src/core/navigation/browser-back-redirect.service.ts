import { PlatformLocation } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/** Key on `Route.data` — when set, browser back from this screen goes here instead of history. */
export const BROWSER_BACK_TARGET_KEY = 'browserBackTarget' as const;

/**
 * Intercepts browser back (`popstate`) for routes that declare `data.browserBackTarget`.
 * Target may be a static URL or a template with `:paramName` segments filled from the
 * merged route `params` (root → leaf; child overrides). Example: `/user/groups/:id`.
 * If any placeholder is missing, redirect is skipped for that navigation.
 * Must be provided on a long-lived shell (e.g. `Features`) so the listener survives
 * child route teardown when history pops.
 */
@Injectable()
export class BrowserBackRedirectService {
  private readonly router = inject(Router);
  private readonly platformLocation = inject(PlatformLocation);
  private readonly destroyRef = inject(DestroyRef);

  /** Resolved from the active route tree after each navigation. */
  private lastBrowserBackTarget: string | null = null;

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.syncFromRouter());

    this.syncFromRouter();

    const unlistenPopState = this.platformLocation.onPopState(() => {
      if (!this.lastBrowserBackTarget) return;
      const target = this.lastBrowserBackTarget;
      window.setTimeout(() => {
        void this.router.navigateByUrl(target, { replaceUrl: true });
      }, 0);
    });
    this.destroyRef.onDestroy(() => unlistenPopState());
  }

  private syncFromRouter(): void {
    this.lastBrowserBackTarget = this.readBrowserBackTarget(this.router.routerState.snapshot.root);
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
