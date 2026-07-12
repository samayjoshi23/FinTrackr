import { Pipe, PipeTransform } from '@angular/core';

/**
 * Validates that a photo URL is an HTTPS image from a known avatar host
 * before we bind it to `[src]`. A user profile doc that ships a `javascript:`
 * URI, an `http://` URL, or a URL pointing at an attacker-controlled host
 * would otherwise (a) leak the viewer's IP + browser fingerprint on every
 * render, or (b) let a compromised profile inject unwanted content on load.
 *
 * Approved hosts:
 *   - *.googleusercontent.com   (Google Sign-In avatars)
 *   - firebasestorage.googleapis.com  (uploaded profile pictures)
 *   - *.gravatar.com            (default Google fallback in some regions)
 *
 * Anything else returns null; the template's `@if (url)` branch shows the
 * fallback avatar instead.
 */
const APPROVED_HOSTS: readonly string[] = [
  '.googleusercontent.com',
  'firebasestorage.googleapis.com',
  '.gravatar.com',
];

@Pipe({ name: 'safePhotoUrl', standalone: true, pure: true })
export class SafePhotoUrlPipe implements PipeTransform {
  transform(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:') return null;
      const host = parsed.hostname;
      const ok = APPROVED_HOSTS.some((h) =>
        h.startsWith('.') ? host.endsWith(h) : host === h,
      );
      return ok ? trimmed : null;
    } catch {
      return null;
    }
  }
}
