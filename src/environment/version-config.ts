/**
 * Bump this string whenever a deploy changes local-data shape and every device
 * needs a one-time cache wipe.
 *
 * On the next boot after a deploy, each device compares the value in the
 * served `/version.json` (stamped from THIS constant at build time) against
 * the value it saved to `localStorage['fintrackr:breakingBuild']` on its last
 * boot. When they differ, `AppVersionService.hydrateAndCompare()` wipes
 * IndexedDB via `IndexedDbRecoveryService.recover()` and reloads once.
 *
 * Regular deploys (bug fixes, UI tweaks) DO NOT touch this value — the code
 * refresh happens silently via `SwUpdate` in the App component.
 *
 * Format is free; a monotonic date makes intent obvious in `git log`:
 *   '2026-08-02-1', '2026-08-15-1', …
 */
export const BREAKING_BUILD = '1';
