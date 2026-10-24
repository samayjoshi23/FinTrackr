// Dev-only audit for the mockups: tap targets under 44px, text under WCAG AA contrast, smallest font.
// Loaded only when the URL has ?audit (see shell.js); prints JSON into window.__auditResult.
window.__audit = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let bg = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) bg = blend(c, bg); return bg; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('.visually-hidden'); };
  const small = [];
  for (const el of document.querySelectorAll('a, button, input, select, [role="button"]')) {
    if (!visible(el)) continue;
    const b = el.getBoundingClientRect();
    // An absolutely positioned ::after hit layer (see fintrackr.css) counts toward the target size.
    const h = getComputedStyle(el, '::after');
    const r = h.content !== 'none' && h.position === 'absolute' ? { width: Math.max(b.width, parseFloat(h.width) || 0), height: Math.max(b.height, parseFloat(h.height) || 0) } : b;
    if (r.width < 44 || r.height < 44) small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 26)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const low = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (seen.has(el) || !visible(el)) continue; seen.add(el);
    const s = getComputedStyle(el); const fg = parse(s.color); if (!fg) continue;
    const bg = bgOf(el); const cr = ratio(blend(fg, bg), bg);
    const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 600;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (cr < need) low.push(`"${t.textContent.trim().slice(0, 26)}" ${cr.toFixed(2)}:1 @${size}px`);
  }
  const fonts = [...seen].map((e) => parseFloat(getComputedStyle(e).fontSize));
  return { page: location.pathname.split('/').pop(), smallTargets: small, lowContrast: low, minFontPx: Math.min(...fonts), hScroll: document.documentElement.scrollWidth > innerWidth };
};
