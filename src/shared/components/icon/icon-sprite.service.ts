import { Injectable, signal } from '@angular/core';

/**
 * Inlines the SVG icon sprite into the document ONCE at startup so icons render via
 * same-document `<use href="#id">` references instead of external
 * `<use href="assets/icons/sprite.svg#id">` references.
 *
 * Why: an external `<use>` depends on the sprite file being fetched AND parsed at the
 * moment the element paints. That file is a separate resource the service worker caches
 * lazily, so on a cold app open (served instantly from the SW shell, sometimes before the
 * sprite is cached or while the network is briefly offline at boot) the reference can fail
 * — and browsers do NOT re-resolve a failed external `<use>`. The symptom is blank icons
 * that only appear after a hard refresh (which serves the sprite warm from cache).
 *
 * Once the sprite lives in the document, `<use href="#id">` resolves synchronously and can
 * never race a network fetch. {@link inlined} flips to `true` when injection succeeds; the
 * `Icon` component reads it to switch from the external URL to the same-document reference,
 * which also self-heals any icons already showing blank (changing the `href` re-resolves).
 */
@Injectable({ providedIn: 'root' })
export class IconSpriteService {
  /** Same-origin sprite (also the external fallback while inlining is pending/failed). */
  static readonly spriteUrl = 'assets/icons/sprite.svg';
  private static readonly CONTAINER_ID = 'app-icon-sprite';

  /** True once the sprite symbols live in the document and `#id` references resolve. */
  readonly inlined = signal(false);

  private loadStarted = false;

  /**
   * Fetch the sprite and inject its symbols into a hidden container in <body>. Idempotent
   * and safe to call eagerly at startup. Never throws — on failure the app keeps using the
   * external URL, i.e. today's behaviour, so this can only improve icon resolution.
   */
  async load(): Promise<void> {
    if (this.loadStarted) return;
    this.loadStarted = true;

    if (typeof document === 'undefined') return;

    // Already injected (e.g. a prior session's DOM restored, or a double call).
    if (document.getElementById(IconSpriteService.CONTAINER_ID)) {
      this.inlined.set(true);
      return;
    }

    try {
      const res = await fetch(IconSpriteService.spriteUrl, { cache: 'force-cache' });
      if (!res.ok) return;
      const markup = await res.text();
      if (!markup.includes('<svg')) return;

      const container = document.createElement('div');
      container.id = IconSpriteService.CONTAINER_ID;
      container.setAttribute('aria-hidden', 'true');
      // Keep it out of layout and the a11y tree without display:none (which can stop
      // some engines from rendering referenced symbols).
      container.style.cssText =
        'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
      container.innerHTML = markup;

      const svg = container.querySelector('svg');
      if (!svg) return;

      document.body.appendChild(container);
      this.inlined.set(true);
    } catch {
      // Network/parse failure — stay on the external URL fallback.
    }
  }
}
