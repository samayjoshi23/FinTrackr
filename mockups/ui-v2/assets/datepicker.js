// Date picker for the mockups, shown in the shared bottom sheet (Sheet.open).
//   DatePicker.open({ title, mode: 'single' | 'range', value, min, max, shortcuts, opener, onDone })
// Single: tap a day, Done. Range: From and To are two buttons; tapping a day sets the active one and
// moves to the next. Week starts Monday (as in the app). Today is a ring, never red. Days outside
// min/max are disabled. Keyboard: arrows move a day/week, PageUp/PageDown a month, Home/End the week,
// Enter/Space picks. The grid uses one roving tab stop.
window.DatePicker = (() => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // taste-skill-ignore: ISO date
  const parse = (s) => new Date(s + 'T00:00:00');
  const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = iso(FT.today);
  const nice = (s) => (s ? parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Pick a day');
  // "5–19 Oct" within a month, "28 Sep – 4 Oct" across months: short enough for one button line.
  const span = (a, b) => { const x = parse(a), y = parse(b), mon = (d) => d.toLocaleDateString('en-IN', { month: 'short' });
    return mon(x) === mon(y) ? `${x.getDate()}–${y.getDate()} ${mon(y)}` : `${x.getDate()} ${mon(x)} – ${y.getDate()} ${mon(y)}`; };
  const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.id = 'dp-sheet'; sheet.hidden = true;
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'dp-h');
  document.body.appendChild(sheet);

  let o, view, sel, focus, editing;

  function inBounds(s) { return (!o.min || s >= o.min) && (!o.max || s <= o.max); }
  function draw(keepFocus) {
    const [y, m] = view;
    const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const prevOk = !o.min || iso(new Date(y, m, 0)) >= o.min, nextOk = !o.max || iso(new Date(y, m + 1, 1)) <= o.max;
    const isRange = o.mode === 'range';
    const [a, b] = isRange ? sel : [sel, sel];
    const label = isRange ? (a && b ? `Show ${span(a, b)}` : 'Pick both dates') : `Done · ${sel ? `${parse(sel).getDate()} ${parse(sel).toLocaleDateString('en-IN', { month: 'short' })}` : ''}`;
    let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="wd" role="columnheader" aria-label="${d}">${d[0]}</span>`).join('');
    cells += '<span role="gridcell"></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const s = iso(new Date(y, m, d));
      const picked = s === a || s === b;
      const cls = [s === today ? 'today' : '', isRange && a && b && s > a && s < b ? 'in-range' : '', isRange && b && s === a ? 'range-start' : '', isRange && a && s === b ? 'range-end' : ''].join(' ');
      cells += `<button type="button" role="gridcell" class="dp-day ${cls}" data-d="${s}" aria-selected="${picked}" tabindex="${s === focus ? 0 : -1}" ${inBounds(s) ? '' : 'disabled'}
        aria-label="${parse(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}${s === today ? ', today' : ''}"><span>${d}</span></button>`;
    }
    sheet.innerHTML = `<div class="grabber" aria-hidden="true"></div>
      <div class="sheet-head"><h2 id="dp-h">${o.title}</h2><button class="icon-btn" type="button" data-sheet-close aria-label="Close">${Shell.icon('x', 20)}</button></div>
      ${isRange ? `<div class="dp-range" role="group" aria-label="Range">
        <button type="button" data-edit="0" aria-pressed="${editing === 0}"><span class="k">From</span><span class="v">${nice(a)}</span></button>
        <button type="button" data-edit="1" aria-pressed="${editing === 1}"><span class="k">To</span><span class="v">${nice(b)}</span></button></div>` : ''}
      <div class="chip-row" role="group" aria-label="Shortcuts">${(o.shortcuts || []).map(([l, v], i) => `<button type="button" class="chip plain" data-sc="${i}">${l}</button>`).join('')}</div>
      <div class="dp-nav"><button class="icon-btn" type="button" data-nav="-1" aria-label="Previous month" ${prevOk ? '' : 'disabled'}>${Shell.icon('back', 20)}</button>
        <h3 aria-live="polite">${monthName(y, m)}</h3>
        <button class="icon-btn" type="button" data-nav="1" aria-label="Next month" ${nextOk ? '' : 'disabled'} ${nextOk ? '' : 'style="opacity:.35"'}>${Shell.icon('chevron', 20)}</button></div>
      <div class="dp-grid" role="grid" aria-label="${monthName(y, m)}">${cells}</div>
      <div class="sheet-actions"><button class="btn" type="button" data-sheet-close>Cancel</button><button class="btn primary" type="button" data-done ${isRange && !(a && b) ? 'disabled' : ''}>${label}</button></div>`;
    if (keepFocus) sheet.querySelector(`[data-d="${focus}"]`)?.focus({ preventScroll: true });
  }
  function moveFocus(s) {
    if (!inBounds(s)) return;
    focus = s; const d = parse(s);
    if (d.getFullYear() !== view[0] || d.getMonth() !== view[1]) view = [d.getFullYear(), d.getMonth()];
    draw(true);
  }
  function pick(s) {
    if (o.mode !== 'range') { sel = s; focus = s; draw(true); return; }
    if (editing === 0) { sel = [s, sel[1] && sel[1] >= s ? sel[1] : null]; editing = 1; }
    else if (sel[0] && s < sel[0]) { sel = [s, null]; editing = 1; }
    else { sel = [sel[0] || s, s]; editing = 0; }
    focus = s; draw(true);
  }
  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.d) pick(t.dataset.d);
    if (t.dataset.nav) { view = [view[0], view[1] + +t.dataset.nav]; const v = new Date(view[0], view[1], 1); view = [v.getFullYear(), v.getMonth()]; focus = iso(v); draw(); }
    if (t.dataset.edit) { editing = +t.dataset.edit; draw(); }
    if (t.dataset.sc) { const v = o.shortcuts[+t.dataset.sc][1]; sel = v; const f = Array.isArray(v) ? v[0] : v; focus = f; view = [parse(f).getFullYear(), parse(f).getMonth()]; editing = 0; draw(); }
    if ('done' in t.dataset) { Sheet.close(); o.onDone?.(sel); }
  });
  sheet.addEventListener('keydown', (e) => {
    const t = e.target.closest('.dp-day'); if (!t) return;
    const s = t.dataset.d, d = parse(s), dow = (d.getDay() + 6) % 7;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -dow, End: 6 - dow }[e.key];
    if (step != null) { e.preventDefault(); moveFocus(add(s, step)); }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); const n = new Date(d); n.setMonth(n.getMonth() + (e.key === 'PageUp' ? -1 : 1)); moveFocus(iso(n)); }
  });

  function open(opts) {
    o = opts; sel = o.mode === 'range' ? [...(o.value || [null, null])] : o.value; editing = 0;
    focus = (o.mode === 'range' ? sel[0] : sel) || today;
    view = [parse(focus).getFullYear(), parse(focus).getMonth()];
    draw(); Sheet.open(sheet, o.opener);
    sheet.querySelector(`[data-d="${focus}"]`)?.focus({ preventScroll: true });
  }
  return { open, iso, add, nice, span, today };
})();
