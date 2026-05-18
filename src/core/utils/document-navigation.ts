/**
 * Document load kind from {@link https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming/type PerformanceNavigationTiming#type}.
 * Used to show the boot loader only on cold open (`navigate`) or refresh (`reload`).
 */
export type DocumentNavType = 'navigate' | 'reload' | 'back_forward' | 'prerender';

export function getDocumentNavType(): DocumentNavType | null {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return null;
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const t = nav?.type;
  if (t === 'navigate' || t === 'reload' || t === 'back_forward' || t === 'prerender') {
    return t;
  }
  return null;
}

/** `true` only for cold document load or explicit reload — not bfcache / prerender / unknown. */
export function shouldShowDocumentBootLoader(): boolean {
  const t = getDocumentNavType();
  return t === 'navigate' || t === 'reload';
}

export function documentBootLoaderMessage(): string {
  const t = getDocumentNavType();
  if (t === 'reload') return 'Reloading LogMyMudra...';
  if (t === 'navigate') return 'Starting LogMyMudra...';
  return '';
}
