// One bottom-sheet behaviour for every popup in the mockups (detail, confirm, filters, pickers).
// Rules it encodes: one sheet at a time (a confirm replaces the sheet's content instead of stacking a
// second dialog), focus moves into the sheet and back to the opener, Tab stays inside, Esc and the
// backdrop close it, exit is quicker than enter. Plus a snackbar with Undo for soft deletes.
window.Sheet = (() => {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  document.body.appendChild(backdrop);
  let current = null, opener = null;
  const focusables = (el) => [...el.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);

  function open(sheet, from) {
    if (current && current !== sheet) close(true);
    current = sheet; opener = from || document.activeElement;
    sheet.hidden = false; sheet.classList.remove('closing');
    void sheet.offsetHeight; // commit the closed position so the transition runs (no rAF: it stalls in background tabs)
    sheet.classList.add('open'); backdrop.classList.add('open');
    opener?.setAttribute?.('aria-expanded', 'true');
    focusFirst();
  }
  function focusFirst() { if (!current) return; (current.querySelector('[data-autofocus]') || focusables(current)[0])?.focus({ preventScroll: true }); }
  function close(instant) {
    if (!current) return;
    const s = current; current = null;
    s.classList.remove('open'); s.classList.add('closing'); backdrop.classList.remove('open');
    setTimeout(() => { s.hidden = true; s.classList.remove('closing'); }, instant ? 0 : 200);
    opener?.setAttribute?.('aria-expanded', 'false');
    opener?.focus?.();
  }
  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = focusables(current); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-sheet-close]')) close(); });

  // Snackbar: one line, an optional action, auto-hides after 6s; announced politely.
  const snack = document.createElement('div');
  snack.className = 'snackbar'; snack.setAttribute('role', 'status'); snack.hidden = true;
  document.body.appendChild(snack);
  let timer;
  function toast(message, action) {
    clearTimeout(timer);
    snack.innerHTML = `<span>${message}</span>` + (action ? `<button type="button" class="link">${action.label}</button>` : '');
    snack.hidden = false;
    snack.querySelector('button')?.addEventListener('click', () => { action.run(); snack.hidden = true; });
    timer = setTimeout(() => { snack.hidden = true; }, 6000);
  }
  return { open, close, focusFirst, toast, get current() { return current; } };
})();
