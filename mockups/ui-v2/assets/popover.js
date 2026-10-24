// Anchored select (listbox popover) for short choices such as "Paid by" with 3+ people.
//   Popover.open(anchorButton, { label, items: [{ value, label, sub, lead }], value, onPick })
// Opens under the field (or above it when there's no room), the listbox takes focus and the current
// option is active (aria-activedescendant). Arrows / Home / End move, Enter or Space picks, Esc or Tab
// closes, a tap outside closes. Focus returns to the field.
window.Popover = (() => {
  const el = document.createElement('div');
  el.className = 'popover'; el.hidden = true; el.tabIndex = -1; el.setAttribute('role', 'listbox');
  document.body.appendChild(el);
  let o = null, anchor = null, active = 0;

  function place() {
    const r = anchor.getBoundingClientRect(), h = el.offsetHeight;
    const up = innerHeight - r.bottom < h + 12 && r.top > h + 12;
    el.dataset.side = up ? 'top' : 'bottom';
    el.style.left = `${r.left}px`; el.style.width = `${r.width}px`;
    el.style.top = `${up ? r.top - h - 6 : r.bottom + 6}px`;
  }
  function draw() {
    el.setAttribute('aria-label', o.label);
    el.innerHTML = o.items.map((it, i) => `<div role="option" id="pop-${i}" class="opt${i === active ? ' active' : ''}" data-i="${i}" aria-selected="${it.value === o.value}">
      ${it.lead || ''}<span class="body"><span>${it.label}</span>${it.sub ? `<span class="sub">${it.sub}</span>` : ''}</span>${it.value === o.value ? Shell.icon('check', 18) : ''}</div>`).join('');
    el.setAttribute('aria-activedescendant', `pop-${active}`);
    el.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }
  function open(a, opts) {
    anchor = a; o = opts; active = Math.max(0, o.items.findIndex((it) => it.value === o.value));
    el.hidden = false; draw(); place();
    anchor.setAttribute('aria-expanded', 'true'); el.focus({ preventScroll: true });
  }
  function close(refocus = true) {
    if (el.hidden) return;
    el.hidden = true; anchor.setAttribute('aria-expanded', 'false');
    if (refocus) anchor.focus({ preventScroll: true });
  }
  function pick(i) { const it = o.items[i]; close(); o.onPick?.(it); }
  el.addEventListener('keydown', (e) => {
    const n = o.items.length;
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) { e.preventDefault(); active = (active + move + n) % n; draw(); }
    if (e.key === 'Home') { e.preventDefault(); active = 0; draw(); }
    if (e.key === 'End') { e.preventDefault(); active = n - 1; draw(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') close(false);
  });
  el.addEventListener('click', (e) => { const opt = e.target.closest('[data-i]'); if (opt) pick(+opt.dataset.i); });
  el.addEventListener('pointermove', (e) => { const opt = e.target.closest('[data-i]'); if (opt && +opt.dataset.i !== active) { active = +opt.dataset.i; draw(); } });
  document.addEventListener('pointerdown', (e) => { if (!el.hidden && !el.contains(e.target) && !anchor.contains(e.target)) close(false); });
  addEventListener('resize', () => { if (!el.hidden) place(); });
  addEventListener('scroll', () => { if (!el.hidden) place(); }, true);
  return { open, close };
})();
