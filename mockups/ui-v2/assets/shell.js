// Shared shell for the UI v2 mockups: one outline icon set (24-unit grid, 1.5px stroke), the app's
// bottom bar (Home, Transactions, Add, Groups, Settings — the same destinations as today) and a top
// app bar with a back button for inner screens. Screens call Shell.mount('<id>', { back, title, action }).
window.Shell = (() => {
  const P = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    list: 'M7 7h13M7 12h13M7 17h13M4 7h.01M4 12h.01M4 17h.01',
    users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    x: 'M6 6l12 12M18 6 6 18',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1',
    split: 'M6 3v5a6 6 0 0 0 12 0V3M12 14v7M8 21h8',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
    pause: 'M8 5v14M16 5v14',
    play: 'M7 5v14l11-7z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    chevron: 'm9 6 6 6-6 6',
    back: 'm15 6-6 6 6 6',
    down: 'm6 9 6 6 6-6',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
    filter: 'M4 6h16M7 12h10M10 18h4',
    repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
    calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    arrowIn: 'M17 7 7 17M7 9v8h8',
    arrowOut: 'M7 17 17 7M9 7h8v8',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
    pie: 'M12 3v9l7.8 4.5A9 9 0 1 1 12 3zM15 3.5a9 9 0 0 1 5.5 8.5H15z',
    tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM8 8h.01',
    lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
    logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 17l5-5-5-5M15 12H4',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
    phone: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
    bank: 'M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
    wallet: 'M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11v3M16 13.5h.01',
    card: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM2 10h20M6 15h4',
    cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4',
    upi: 'M5 4h14v16H5zM9 8l3 8 3-8',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    check: 'm5 12 5 5 9-10',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
    basket: 'M5 10h14l-1.5 9a1 1 0 0 1-1 .8h-9a1 1 0 0 1-1-.8zM8 10l4-6 4 6M3 10h18',
    leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7',
    cup: 'M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2',
    fork: 'M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9',
    screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
    plane: 'M10.5 13.5 4 12l-1-2 6 .5L13 4h2l-1.5 7 5.5.5 1.5-2h1.5l-1 4 1 4H21l-1.5-2-5.5.5L15.5 21h-2l-4-6.5-6 .5 1-2z',
    coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 8h6M9 11.5h6M13.5 8c1.5 0 1.5 7-1 7H9l5 4',
  };
  const icon = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name]}"/></svg>`;

  const nav = [
    { id: 'home', label: 'Home', icon: 'home', href: 'home.html' },
    { id: 'transactions', label: 'Transactions', icon: 'list', href: 'transactions.html' },
    { id: 'add', label: 'Add', icon: 'plus', href: 'add-transaction.html', primary: true },
    { id: 'groups', label: 'Groups', icon: 'users', href: '#' },
    { id: 'settings', label: 'Settings', icon: 'gear', href: 'settings.html' },
  ];

  function mount(current, bar) {
    const app = document.querySelector('.app');
    if (bar) {
      const top = document.createElement('header');
      top.className = 'topbar';
      top.innerHTML = `<a class="icon-btn back" href="${bar.back || 'home.html'}" aria-label="Back">${icon('back', 20)}</a>`
        + `<h1>${bar.title}</h1>`
        + (bar.action ? `<span class="topbar-action">${bar.action}</span>` : '<span class="topbar-action"></span>');
      app.prepend(top);
    }
    if (current !== false) {
      const items = nav.map((n) =>
        `<a class="nav-item${n.primary ? ' is-add' : ''}" href="${n.href}" ${n.id === current ? 'aria-current="page"' : ''} aria-label="${n.label}">${icon(n.icon, n.primary ? 22 : 20)}${n.primary ? '' : `<span>${n.label}</span>`}</a>`).join('');
      const navEl = document.createElement('nav');
      navEl.className = 'bottom-nav';
      navEl.setAttribute('aria-label', 'Main');
      navEl.innerHTML = `<div class="nav-inner">${items}</div>`;
      document.body.appendChild(navEl);
    }
    paint();
  }
  const paint = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, +(el.dataset.size || 18)); });

  const tile = (cat, size = 20) => `<span class="cat-icon" aria-hidden="true">${icon(FT.categories[cat].icon, size)}</span>`;
  const avatar = (key, cls = '') => {
    const p = FT.people[key];
    return `<span class="avatar ${p.tint} ${cls}" title="${p.name}">${p.initial}</span>`;
  };

  // One transaction row: plain category icon, description, one quiet meta line, coloured amount.
  // Payer is a word, not an avatar bubble — the list reads as text, not a row of badges.
  const txRow = (t) => `<a class="tx" href="#" data-tx="${t.id}" aria-haspopup="dialog">${tile(t.cat, 22)}<div class="body"><div class="desc">${t.desc}</div>
    <div class="line2"><span>${t.cat}</span>·<span>${t.source}</span>·<span>${FT.people[t.by].name}</span>${t.recurring ? `<span class="rep" title="Repeats monthly">· ${icon('repeat', 12)}<span class="visually-hidden">repeats monthly</span></span>` : ''}</div></div>
    <span class="amt ${t.type === 'income' ? 'in' : 'out'}">${t.type === 'income' ? '+' : '−'}${FT.money(t.amount)}</span></a>`;

  // Rows grouped by day: the label and the day's total sit on the ground, the rows share one card.
  const dayGroups = (rows) => [...new Set(rows.map((t) => t.date))].map((day) => {
    const r = rows.filter((t) => t.date === day);
    const out = FT.sum(r.filter((t) => t.type === 'expense')), inn = FT.sum(r.filter((t) => t.type === 'income'));
    const tot = [inn ? `<span style="color:var(--income)">+${FT.money(inn)}</span>` : '', out ? `<span>−${FT.money(out)}</span>` : ''].filter(Boolean).join(' · ');
    return `<div class="day-group" role="group" aria-label="${FT.dayLabel(day)}"><div class="day-head"><b>${FT.dayLabel(day)}</b><span class="money">${tot}</span></div><div class="day-card">${r.map(txRow).join('')}</div></div>`;
  }).join('');

  // Skeletons mirror the real layout (day label + card of rows) so nothing shifts when data arrives.
  const skLine = (w, h = 12, cls = '') => `<span class="sk ${cls}" style="width:${w};height:${h}px"></span>`;
  const skRows = (n) => Array.from({ length: n }, (_, i) => `<div class="sk-row">${skLine('22px', 22, 'round')}<div class="lines">${skLine(['62%', '48%', '70%', '55%'][i % 4], 14)}${skLine(['38%', '30%', '42%', '34%'][i % 4], 11)}</div>${skLine('64px', 14)}</div>`).join('');
  const skDays = (counts = [2, 3]) => counts.map((n) => `<div class="day-head">${skLine('92px', 14)}${skLine('56px', 12)}</div><div class="day-card">${skRows(n)}</div>`).join('');
  // ?state=loading | offline | empty on any mockup page shows that state.
  const state = new URLSearchParams(location.search).get('state');

  return { mount, icon, tile, avatar, txRow, dayGroups, skLine, skRows, skDays, state, paint };
})();
