// FinTrackr UI v2 · Round 3 — Figma development plugin.
// Applies the round-3 UX pass to https://www.figma.com/design/I9Y2OiKxuvC7vvDfZZFPIq :
//   1. 44px touch targets in the shared components (Button Medium, Chip, Segment option,
//      Top bar back/action, Section header, Icon buttons) and 12px minimum text (Label/Nav, small avatar).
//   2. Rebuilds the screens whose layout changed, in place (same section, position and name):
//      Home, Transactions, Add transaction, Notifications, Budget, Settings, Onboarding.
//   3. Builds the "Read me & Foundations" page, including the round-3 notes.
// Safe to run more than once: screens are found by name and replaced; the Read me frame is rebuilt.
// code.js is generated from this file + ../readme-page.js by build.mjs; edit these, not code.js.

/*__PRELUDE__*/
// ---------------------------------------------------------------------------------------------
// 1. Components: 44px targets, 12px minimum text
// ---------------------------------------------------------------------------------------------
async function fixComponents() {
  const log = [];
  const buttons = await figma.getNodeByIdAsync(C.buttonSet);
  for (const v of buttons.children) if (/Size=Medium/.test(v.name)) { setH(v, 44); log.push(`Button ${v.name} → 44`); }
  for (const id of [C.chip.False, C.chip.True]) { const v = await figma.getNodeByIdAsync(id); setH(v, 44); }
  log.push('Chip → 44');
  for (const id of [C.segment.False, C.segment.True]) { const v = await figma.getNodeByIdAsync(id); v.resize(v.width, 44); }
  log.push('Segment option → 44 (track 50)');
  const tb = await figma.getNodeByIdAsync(C.topBar.id);
  const back = tb.findOne((n) => n.name === 'Back'); back.resize(44, 44);
  const action = tb.findOne((n) => n.name === 'Action'); setH(action, 44);
  log.push('Top bar back + action → 44');
  const sh = await figma.getNodeByIdAsync(C.sectionHeader.id); sh.resize(sh.width, 44); log.push('Section header → 44');
  const navStyle = await getStyle(S['Label/Nav']);
  if (navStyle && navStyle.fontSize < 12) { await figma.loadFontAsync(navStyle.fontName); navStyle.fontSize = 12; log.push('Label/Nav → 12px'); }
  for (const id of [C.avatar['A/Small'], C.avatar['B/Small'], C.avatar['Me/Small']]) {
    const a = await figma.getNodeByIdAsync(id); a.resize(22, 22);
    for (const t of a.findAllWithCriteria({ types: ['TEXT'] })) if (!t.textStyleId && t.fontSize < 12) { await figma.loadFontAsync(t.fontName); t.fontSize = 12; }
  }
  log.push('Small avatar → 22px / 12px');
  const screens = await figma.getNodeByIdAsync(PAGES.screens); await screens.loadAsync();
  const small = screens.findAll((n) => n.type === 'FRAME' && n.name.startsWith('Icon button') && n.width < 44);
  for (const b of small) b.resize(44, 44);
  log.push(`Icon buttons on other screens → 44 (${small.length})`);
  return log.join(' · ');
}

// ---------------------------------------------------------------------------------------------
// 2. Screens
// ---------------------------------------------------------------------------------------------
async function buildHome(sec, x) {
  const { f, body } = await screen(sec, 'Home · Dashboard', x, { navActive: 'Home' });
  annotate(f, 'Account pill opens the switcher sheet (hidden layer). Budget row links to Budget. Attention banner = text + icon. Bills have Mark paid.');
  body.itemSpacing = 20;
  const head = row(8, 'Header'); add(body, head);
  const hl = col(0, 'Greeting'); hl.appendChild(await text('Good evening, Samay', 'Body/Small', 'text/muted')); hl.appendChild(await text('FinTrackr', 'Title/Screen')); grow(head, hl);
  const bell = await iconBtn('bell', true, 'Notifications, 2 unread'); absolute(bell, dot('money/expense'), 27, 9); head.appendChild(bell);
  const pill = row(6, 'Account switcher · Ghar'); pad(pill, 0, 4, 0, 14); minH(pill, 44); pill.cornerRadius = 999; pill.fills = [fill('surface/card')]; outline(pill);
  pill.appendChild(await text('Ghar', 'Body/Strong')); pill.appendChild(await icon('down', 16, 'text/muted')); pill.appendChild(await avatar('Me', 'Medium', 'SJ')); head.appendChild(pill);

  const sum = card(14, 'brand/soft', 'Summary card'); add(body, sum);
  const bal = col(2); bal.appendChild(await text('Total balance · Ghar', 'Body/Small', 'text/muted')); bal.appendChild(await text('₹18,846.17', 'Display/Balance')); add(sum, bal);
  const flows = row(10, 'In and out'); add(sum, flows);
  for (const [k, v, c, ic] of [['In · October', '+₹60,000', 'money/income', 'arrowIn'], ['Out · October', '−₹44,629', 'money/expense', 'arrowOut']]) {
    const t = col(2, k); t.cornerRadius = 12; t.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.75 }]; pad(t, 10, 12);
    const kr = row(6); kr.appendChild(await icon(ic, 16, c)); kr.appendChild(await text(k, 'Body/Small', 'text/muted')); t.appendChild(kr);
    t.appendChild(await text(v, 'Figure/Large', c)); grow(flows, t);
  }
  const bu = col(8, 'Budget link → Budget'); add(sum, bu);
  const bt = row(0); bt.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(bu, bt); minH(bt, 28);
  bt.appendChild(await text('Budget used 74%', 'Label/Small'));
  const left = row(2); left.appendChild(await text('₹15,371 left · 8 days', 'Body/Small', 'text/muted')); left.appendChild(await icon('chevron', 16, 'text/muted')); bt.appendChild(left);
  const track = bar(0.744, 'brand/emerald', 'surface/card', 8, 314); add(bu, track);
  const pace = figma.createRectangle(); pace.name = 'Even pace'; pace.resize(2, 14); pace.x = Math.round(314 * 0.742); pace.y = -3; pace.fills = [fill('text/primary')]; track.appendChild(pace);
  const pn = row(6, 'Pace note'); const pm = figma.createRectangle(); pm.resize(2, 12); pm.fills = [fill('text/primary')]; pn.appendChild(pm);
  grow(pn, await text('Even pace for 23 Oct is ₹44,516 · you are ₹113 over', 'Body/Small', 'text/muted')); add(bu, pn);
  const sh = row(16, 'Shares'); sh.layoutWrap = 'WRAP'; sh.counterAxisSpacing = 6;
  for (const [p, n, a] of [['A', 'S', 'Samay added ₹30,000'], ['B', 'A', 'Ayushi added ₹30,000']]) { const r = row(6); r.appendChild(await avatar(p, 'Small', n)); r.appendChild(await text(a, 'Body/Small', 'text/muted')); sh.appendChild(r); }
  add(sum, sh);

  const att = row(10, 'Needs attention → Budget'); pad(att, 12, 14); att.cornerRadius = 16; att.fills = [fill('status/warning-bg')]; minH(att, 52); add(body, att);
  att.appendChild(await icon('info', 20, 'status/warning')); grow(att, await text('Bills is at 92% · ₹3,100 left for 8 days', 'Body/Strong')); att.appendChild(await icon('chevron', 18, 'text/muted'));

  const quick = row(8, 'Quick actions'); quick.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(body, quick);
  for (const [l, ic] of [['Budget', 'pie'], ['Goals', 'target'], ['Reports', 'chart'], ['Recurring', 'repeat']]) {
    const q = col(6, l); q.counterAxisAlignItems = 'CENTER';
    const b = row(0); b.resize(52, 52); b.primaryAxisSizingMode = 'FIXED'; b.counterAxisSizingMode = 'FIXED'; b.primaryAxisAlignItems = 'CENTER'; b.cornerRadius = 16; b.fills = [fill('surface/card')]; outline(b); b.appendChild(await icon(ic, 22, 'text/primary'));
    q.appendChild(b); q.appendChild(await text(l, 'Label/Small')); quick.appendChild(q);
  }

  const bills = col(0, 'Upcoming bills'); add(bills, await secHead('Upcoming bills', '5 Nov · in 13 days'));
  for (const [n, amt] of [['House rent', '−₹29,400'], ['Anita didi, cook', '−₹4,000']]) {
    const r = row(12, n); pad(r, 10, 0); ruleTop(r); r.appendChild(await icon('bulb', 22, 'text/muted'));
    const c = col(2); c.appendChild(await text(n, 'Body/Regular')); const m = row(4); m.appendChild(await text(amt, 'Body/Small', 'money/expense')); m.appendChild(await text('· Bills · monthly', 'Body/Small', 'text/muted')); c.appendChild(m); grow(r, c);
    r.appendChild(await btn('Mark paid', 'Secondary/Medium')); add(bills, r);
  }
  const more = row(8, 'More bills'); pad(more, 4, 0); ruleTop(more); grow(more, await text('+2 more on 5 Nov · ₹36,900 in total', 'Body/Small', 'text/muted')); more.appendChild(await textBtn('All bills')); add(bills, more);
  add(body, bills);

  const rec = col(4, 'Recent transactions'); add(rec, await secHead('Recent transactions', 'See all'));
  add(rec, await text('Mon, 19 Oct · −₹1,102', 'Label/Small', 'text/muted'));
  add(rec, await txRow('Expense', 'Auto, Kartik to home', 'Travel · UPI · Samay', '−₹102', 'plane'));
  add(rec, await txRow('Expense', 'BlaBlaCar, Mussoorie to Chandigarh', 'Travel · UPI · Samay', '−₹1,000', 'plane'));
  add(rec, await text('Sun, 18 Oct · −₹2,519', 'Label/Small', 'text/muted'));
  add(rec, await txRow('Expense', 'Kartik restaurant', 'Food · UPI · Samay', '−₹819', 'fork'));
  add(body, rec);

  // Account switcher: a sheet on Home, not a new screen. Hidden; show the layer to review it.
  const sheet = col(4, 'Account switcher sheet (show to review)'); sheet.resize(390, 10); sheet.counterAxisSizingMode = 'FIXED'; sheet.primaryAxisSizingMode = 'AUTO';
  pad(sheet, 10, 20, 28, 20); sheet.topLeftRadius = sheet.topRightRadius = 24; sheet.fills = [fill('surface/card')];
  sheet.effects = [{ type: 'DROP_SHADOW', color: { r: 0.06, g: 0.09, b: 0.08, a: 0.18 }, offset: { x: 0, y: -8 }, radius: 32, spread: 0, visible: true, blendMode: 'NORMAL' }];
  const grab = row(0, 'Grabber'); grab.primaryAxisAlignItems = 'CENTER'; add(sheet, grab); const g = figma.createRectangle(); g.resize(40, 4); g.cornerRadius = 999; g.fills = [fill('line/control')]; grab.appendChild(g);
  add(sheet, await text('Switch account', 'Heading/Section'));
  for (const [n, sub, ic, cur] of [['Personal', 'Just me · ₹1,75,505', 'wallet', false], ['Ghar', 'Shared with Ayushi · ₹18,846', 'users', true]]) {
    const r = row(12, n); pad(r, 10, 12); minH(r, 60); r.cornerRadius = 14; r.fills = cur ? [fill('brand/soft')] : [];
    r.appendChild(await icon(ic, 22, 'text/primary')); const c = col(2); c.appendChild(await text(n, 'Body/Regular')); c.appendChild(await text(sub, 'Body/Small', 'text/muted')); grow(r, c);
    if (cur) r.appendChild(await icon('check', 20, 'brand/ink')); add(sheet, r);
  }
  const acts = row(12, 'Sheet actions'); pad(acts, 12, 0, 0, 0); add(sheet, acts);
  const m1 = await btn('Manage accounts', 'Secondary/Medium'); grow(acts, m1); const m2 = await btn('New account', 'Primary/Medium'); grow(acts, m2);
  absolute(f, sheet, 0, 400); sheet.visible = false;
  return f;
}

async function buildTransactions(sec, x) {
  const ft = footerBar(); const tr = row(0, 'Totals'); tr.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(ft, tr);
  tr.appendChild(await text('Showing 12 · Oct', 'Body/Regular', 'text/muted'));
  const sums = row(14); sums.appendChild(await text('+₹60,000', 'Figure/Body', 'money/income')); sums.appendChild(await text('−₹44,629', 'Figure/Body', 'money/expense')); tr.appendChild(sums);
  const { f, body } = await screen(sec, 'Transactions', x, { top: 'Transactions', navActive: 'Transactions', footer: ft });
  annotate(f, 'Filter button shows a count badge when filters are on. Person chips filter the list (toggle, aria-pressed). Footer says what is shown.');
  body.itemSpacing = 16;
  const r1 = row(8, 'Search row'); add(body, r1);
  grow(r1, await input(null, 'Search transactions', 'search'));
  const fb = await iconBtn('filter', true, 'Filters, 1 applied'); const badge = row(0, 'Badge'); pad(badge, 0, 5); minH(badge, 18); badge.minWidth = 18; badge.primaryAxisAlignItems = 'CENTER'; badge.cornerRadius = 999; badge.fills = [fill('brand/ink')];
  badge.appendChild(await text('1', 'Label/Nav', 'text/on-brand')); absolute(fb, badge, 28, -4); r1.appendChild(fb);
  const r2 = row(8, 'Period and type'); add(body, r2);
  const date = row(8, 'Period'); pad(date, 0, 14); minH(date, 44); date.cornerRadius = 999; date.fills = [fill('surface/card')]; outline(date);
  date.appendChild(await icon('calendar', 18, 'text/primary')); grow(date, await text('Oct 2026', 'Label/Small')); date.appendChild(await icon('down', 16, 'text/muted'));
  grow(r2, date); const sg = await seg(['All', 'In', 'Out'], 0, false); r2.appendChild(sg); for (const s of sg.children) s.resize(56, 44);
  const who = col(8, 'Out by person'); const wh = row(0); wh.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(who, wh);
  wh.appendChild(await text('Out by person · tap to filter', 'Label/Small')); wh.appendChild(await text('₹44,629', 'Body/Small', 'text/muted'));
  const split = row(2, 'Split'); split.resize(350, 6); split.counterAxisSizingMode = 'FIXED'; split.cornerRadius = 999; split.clipsContent = true;
  for (const [w, c] of [[257, 'person/a-bar'], [91, 'person/b-bar']]) { const r = figma.createRectangle(); r.resize(w, 6); r.fills = [fill(c)]; split.appendChild(r); }
  add(who, split);
  const key = row(8, 'Person filter'); add(who, key, false);
  key.appendChild(await pillToggle('Samay ₹32,821', false, 'A', 'S')); key.appendChild(await pillToggle('Ayushi ₹11,808', false, 'B', 'A'));
  add(body, who);
  const list = col(2, 'List');
  add(list, await text('Mon, 19 Oct · −₹1,102', 'Label/Small', 'text/muted'));
  add(list, await txRow('Expense', 'Auto, Kartik to home', 'Travel · UPI · Samay', '−₹102', 'plane'));
  add(list, await txRow('Expense', 'BlaBlaCar, Mussoorie to Chandigarh', 'Travel · UPI · Samay', '−₹1,000', 'plane'));
  add(list, await text('Sun, 18 Oct · −₹2,519', 'Label/Small', 'text/muted'));
  add(list, await txRow('Expense', 'Kartik restaurant', 'Food · UPI · Samay', '−₹819', 'fork'));
  add(list, await txRow('Expense', 'Mall Road dinner, Mussoorie', 'Food · Cash · Ayushi', '−₹1,700', 'fork'));
  add(list, await text('Thu, 1 Oct · +₹60,000', 'Label/Small', 'text/muted'));
  add(list, await txRow('Income', 'October share, Ayushi', 'Income · UPI · Ayushi', '+₹30,000', 'coin'));
  add(list, await txRow('Income', 'October share, Samay', 'Income · Bank · Samay', '+₹30,000', 'coin'));
  add(body, list);
  const lo = row(0, 'Load older'); lo.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(body, lo);
  lo.appendChild(await text('Loaded since 1 Aug', 'Body/Small', 'text/muted')); lo.appendChild(await btn('Load older', 'Secondary/Medium'));
  return f;
}

async function buildAdd(sec, x) {
  const ft = footerBar(); add(ft, await btn('Add ₹1,250 expense'));
  const { f, body } = await screen(sec, 'Add transaction', x, { top: 'Add transaction', footer: ft });
  annotate(f, 'Order follows the decisions: type → amount → category (drives the budget hint) → description → method → date → payer → repeat. Repeat writes to the existing recurring collection.');
  body.itemSpacing = 22;
  add(body, await seg(['Expense', 'Income'], 0, true));
  const amt = col(6, 'Amount'); amt.counterAxisAlignItems = 'CENTER';
  const al = row(4); al.counterAxisAlignItems = 'BASELINE'; al.appendChild(await text('₹', 'Figure/Large', 'text/muted')); al.appendChild(await text('1,250', 'Display/Amount')); amt.appendChild(al);
  amt.appendChild(await text('Food will have ₹731 left this month', 'Body/Small', 'text/muted'));
  const qa = row(8); for (const q of ['+100', '+500', '+1,000']) qa.appendChild(await chip(q, false)); amt.appendChild(qa);
  add(body, amt);
  const cat = col(8, 'Category'); cat.appendChild(await text('Category', 'Label/Small'));
  const cw = row(8, 'Chips'); cw.layoutWrap = 'WRAP'; cw.counterAxisSpacing = 8; add(cat, cw);
  for (const [l, ic] of [['Bills', 'bulb'], ['Groceries', 'basket'], ['Vegetables', 'leaf'], ['Dairy', 'cup'], ['Food', 'fork'], ['Entertainment', 'screen'], ['Travel', 'plane'], ['New category', 'plus']]) cw.appendChild(await chip(l, l === 'Food', ic));
  add(body, cat);
  add(body, await input('Description', 'Dinner with Kartik', null));
  const pw = col(8, 'Paid with'); pw.appendChild(await text('Paid with', 'Label/Small')); const mr = row(8); add(pw, mr);
  for (const [l, ic, on] of [['UPI', 'upi', true], ['Card', 'card', false], ['Cash', 'cash', false], ['Bank', 'bank', false]]) {
    const m = col(6, l); m.counterAxisAlignItems = 'CENTER'; pad(m, 12, 4); m.cornerRadius = 14; m.fills = [fill(on ? 'brand/soft' : 'surface/card')]; outline(m, on ? 'brand/ink' : 'line/border');
    m.appendChild(await icon(ic, 22, on ? 'brand/ink' : 'text/muted')); m.appendChild(await text(l, 'Label/Small', on ? 'brand/ink' : 'text/primary')); grow(mr, m);
  }
  add(body, pw);
  add(body, await input('Date', 'Today, 23 Oct', 'calendar'));
  const by = col(8, 'Paid by'); by.appendChild(await text('Paid by', 'Label/Small')); add(by, await seg(['Samay', 'Ayushi'], 0, true)); add(body, by);
  const rp = row(12, 'Repeat monthly'); pad(rp, 12, 16); rp.cornerRadius = 16; rp.fills = [fill('surface/card')]; outline(rp);
  rp.appendChild(await icon('repeat', 22, 'text/muted'));
  const rc = col(2); rc.appendChild(await text('Repeat monthly', 'Body/Regular')); add(rc, await text('Also creates a recurring bill for the 23rd of each month', 'Body/Small', 'text/muted')); grow(rp, rc);
  rp.appendChild(toggle(false)); add(body, rp);
  return f;
}

async function buildNotifications(sec, x) {
  const { f, body } = await screen(sec, 'Notifications', x, { top: 'Notifications', topAction: 'Mark all read', topActionIcon: 'check', navActive: 'None' });
  annotate(f, 'Invites are answered inline (Accept / Decline) without leaving the list. Unread = bold title + dot + "unread" in the label.');
  body.itemSpacing = 16;
  add(body, await seg(['All', 'Personal', 'Ghar'], 0, true));
  const list = col(2, 'List');
  const note = async (t, b, time, ic, unread, actions) => {
    const r = row(12, unread ? `${t} · unread` : t); pad(r, 12, 0); r.counterAxisAlignItems = 'MIN'; ruleTop(r);
    r.appendChild(await icon(ic, 22, unread ? 'brand/ink' : 'text/muted'));
    const c = col(2); c.appendChild(await text(t, unread ? 'Body/Strong' : 'Body/Regular')); add(c, await text(b, 'Body/Small', 'text/muted')); add(c, await text(time, 'Body/Small', 'text/muted'));
    if (actions) { const a = row(8, 'Invite actions'); pad(a, 8, 0, 0, 0); a.appendChild(await btn('Accept', 'Primary/Medium')); a.appendChild(await btn('Decline', 'Secondary/Medium')); c.appendChild(a); }
    grow(r, c); if (unread) r.appendChild(dot('brand/emerald')); return r;
  };
  add(list, await text('Today', 'Label/Small', 'text/muted'));
  add(list, await note('Kartik invited you to “Flat 3B”', 'Shared account · 3 members. You can leave any time.', '1h ago', 'users', true, true));
  add(list, await note('Bills is at 92%', '₹3,100 left in Bills for the next 8 days.', '2h ago · Ghar', 'pie', true));
  add(list, await note('Ayushi added an expense', 'Mall Road dinner, ₹1,700 in Food.', '5h ago · Ghar', 'users', true));
  add(list, await text('Earlier', 'Label/Small', 'text/muted'));
  add(list, await note('Payment processed', '₹5,000 deducted from Personal for Mutual funds.', '19 days ago · Personal', 'repeat', false));
  add(list, await note('Month in review · September', 'You saved 49% of income in September.', '23 days ago · Personal', 'chart', false));
  add(body, list);
  return f;
}

async function planRow(iconName, name, spent, planned, pct, note, tone) {
  const r = row(12, `${name} → transactions`); r.counterAxisAlignItems = 'CENTER'; pad(r, 12, 0); ruleTop(r);
  r.appendChild(await icon(iconName, 22, 'text/muted'));
  const c = col(6); const top = row(8); top.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(c, top);
  top.appendChild(await text(name, 'Body/Strong')); const nums = row(4); nums.appendChild(await text(spent, 'Figure/Body')); nums.appendChild(await text(`of ${planned}`, 'Body/Small', 'text/muted')); top.appendChild(nums);
  add(c, bar(pct, tone === 'warn' ? 'status/warning-bar' : tone === 'over' ? 'status/negative' : 'brand/emerald', 'surface/raised', 6, 290));
  add(c, await text(note, 'Body/Small', tone === 'warn' ? 'status/warning' : tone === 'over' ? 'status/negative' : 'text/muted'));
  grow(r, c); r.appendChild(await icon('chevron', 18, 'text/muted')); return r;
}

async function buildBudget(sec, x) {
  const { f, body } = await screen(sec, 'Budget', x, { top: 'Budget', topAction: 'Edit', topActionIcon: 'edit', navActive: 'None' });
  annotate(f, 'Each category row opens Transactions filtered to that category. The near-limit line repeats the warning in words.');
  const mr = row(8, 'Month'); mr.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(body, mr);
  mr.appendChild(await iconBtn('back', true, 'Previous month')); mr.appendChild(await text('October 2026', 'Body/Strong')); const nx = await iconBtn('chevron', true, 'Next month (disabled)'); nx.opacity = 0.45; mr.appendChild(nx);
  const sum = card(10, 'brand/soft', 'Plan card'); add(body, sum);
  sum.appendChild(await text('October plan · 8 days left', 'Body/Small', 'text/muted'));
  const big = row(8); big.counterAxisAlignItems = 'BASELINE'; big.appendChild(await text('₹15,371', 'Display/Balance')); big.appendChild(await text('left of ₹60,000', 'Body/Regular', 'text/muted')); add(sum, big, false);
  add(sum, bar(0.744, 'brand/emerald', 'surface/card', 8, 314));
  const kv = col(0, 'Facts'); add(sum, kv);
  for (const [k, v] of [['Spent', '−₹44,629'], ['Daily room', '₹1,921 a day'], ['Not allocated', '₹0']]) { const r = row(0, k); r.primaryAxisAlignItems = 'SPACE_BETWEEN'; pad(r, 8, 0); add(kv, r); r.appendChild(await text(k, 'Body/Regular', 'text/muted')); r.appendChild(await text(v, 'Figure/Body')); }
  const att = row(10, 'Needs attention'); pad(att, 12, 14); att.cornerRadius = 16; att.fills = [fill('status/warning-bg')]; add(body, att);
  att.appendChild(await icon('info', 20, 'status/warning')); grow(att, await text('Bills 92% · close to the limit', 'Body/Strong'));
  const list = col(0, 'By category'); add(list, await secHead('By category', null));
  for (const p of [['bulb', 'Bills', '₹36,900', '₹40,000', 0.92, '92% used · ₹3,100 left', 'warn'], ['plane', 'Travel', '₹1,102', '₹1,500', 0.73, '73% used · ₹398 left', 'ok'], ['fork', 'Food', '₹2,519', '₹4,500', 0.56, '56% used · ₹1,981 left', 'ok'], ['leaf', 'Vegetables', '₹928', '₹2,000', 0.46, '46% used · ₹1,072 left', 'ok'], ['basket', 'Groceries', '₹3,180', '₹9,000', 0.35, '35% used · ₹5,820 left', 'ok'], ['cup', 'Dairy', '₹0', '₹2,000', 0, '0% used · ₹2,000 left', 'ok'], ['screen', 'Entertainment', '₹0', '₹1,000', 0, '0% used · ₹1,000 left', 'ok']]) add(list, await planRow(...p));
  add(body, list);
  return f;
}

async function buildSettings(sec, x) {
  const { f, body } = await screen(sec, 'Settings', x, { top: 'Settings', navActive: 'Settings' });
  annotate(f, 'Stats name the account and month they count. The current account is marked in text, not only by colour.');
  const prof = row(14, 'Profile'); add(body, prof);
  prof.appendChild(await avatar('Me', 'Medium', 'SJ'));
  const pc = col(2); pc.appendChild(await text('Samay Joshi', 'Figure/Large')); add(pc, await text('samay@fintrackr.app · member since 18 Jul 2026', 'Body/Small', 'text/muted')); grow(prof, pc);
  prof.appendChild(await btn('Edit', 'Secondary/Medium'));
  const st = row(0, 'Stats'); st.cornerRadius = 20; st.fills = [fill('surface/card')]; outline(st); add(body, st);
  for (const [i, [k, v]] of [['Ghar balance', '₹18,846'], ['Ghar · October', '12 transactions'], ['Accounts', '2']].entries()) { const c = col(2, k); pad(c, 14, 12); if (i) { c.strokes = [fill('line/rule')]; c.strokeLeftWeight = 1; c.strokeTopWeight = 0; c.strokeRightWeight = 0; c.strokeBottomWeight = 0; } c.appendChild(await text(k, 'Label/Nav', 'text/muted')); add(c, await text(v, 'Body/Strong')); grow(st, c); }
  const acc = col(8, 'Accounts'); add(acc, await secHead('Accounts', '+ New account'));
  add(acc, await menuGroup([await menuRow('Personal', 'Just me', '₹1,75,505', 'wallet'), await menuRow('Ghar · Current', 'Shared with Ayushi', '₹18,846', 'users')]));
  add(body, acc);
  const ap = col(8, 'Appearance'); add(ap, await secHead('Appearance', null)); add(ap, await seg(['Light', 'Dark', 'System'], 0, true)); add(body, ap);
  const gen = col(8, 'General'); add(gen, await secHead('General', null));
  add(gen, await menuGroup([await menuRow('Categories', '8 categories in Ghar', null, 'tag'), await menuRow('Notifications', 'Budget alerts, bills, invites', null, 'bell'), await menuRow('Privacy & security', 'Biometric lock, hide balances, password', null, 'lock'), await menuRow('About FinTrackr', 'Version 1.0.0 · feedback', null, 'info')]));
  add(body, gen);
  add(body, await btn('Log out', 'Danger/Large'));
  return f;
}

async function buildOnboarding(sec, x) {
  const footer = col(0, 'Footer'); pad(footer, 12, 20, 24, 20); footer.fills = [fill('surface/ground')];
  add(footer, await btn('Continue'));
  const { f, body } = await screen(sec, 'Onboarding', x, { footer });
  annotate(f, 'Three steps instead of five (1 Welcome & currency · 2 First account · 3 Monthly budget). Back and Skip sit at the top; Skip lands on Home with a personal account.');
  body.itemSpacing = 22;
  const topRow = row(8, 'Top row'); topRow.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(body, topRow);
  topRow.appendChild(await iconBtn('back', false, 'Back')); topRow.appendChild(await textBtn('Skip for now'));
  const prog = col(8, 'Progress'); const pr = row(6, 'Steps'); for (let i = 0; i < 3; i++) { const d = figma.createRectangle(); d.resize(110, 4); d.cornerRadius = 999; d.fills = [fill(i < 2 ? 'brand/emerald' : 'surface/raised')]; pr.appendChild(d); d.layoutGrow = 1; } add(prog, pr);
  prog.appendChild(await text('Step 2 of 3 · Your first account', 'Label/Small', 'text/muted')); add(body, prog);
  body.appendChild(await text('Who uses this account?', 'Title/Screen'));
  const choices = col(12, 'Account type');
  for (const [t, s, sel, ic] of [['Just me', 'A personal account only you can see.', false, 'user'], ['Shared', 'Invite your partner or flatmates by email.', true, 'users']]) {
    const c = card(4, sel ? 'brand/soft' : 'surface/card', sel ? `${t} · selected` : t); if (sel) { c.strokes = [fill('brand/ink')]; c.strokeWeight = 1.5; }
    const r = row(12); r.appendChild(await icon(ic, 22, sel ? 'brand/ink' : 'text/muted')); const tt = col(2); tt.appendChild(await text(t, 'Body/Strong')); tt.appendChild(await text(s, 'Body/Small', 'text/muted')); grow(r, tt);
    if (sel) r.appendChild(await icon('check', 20, 'brand/ink')); add(c, r); add(choices, c);
  }
  add(body, choices);
  add(body, await input('Account name', 'Ghar', 'wallet'));
  add(body, await input('Starting balance', '₹ 15,703', 'coin'));
  const inv = col(8, 'Invite'); add(inv, await input('Invite members (optional)', 'ayushi@fintrackr.app', 'mail'));
  const invited = row(8); invited.appendChild(await chip('Ayushi', true)); add(inv, invited, false); add(body, inv);
  return f;
}

// ---------------------------------------------------------------------------------------------
// 3. Read me page (body generated from ../readme-page.js, followed by the round-3 panels)
// ---------------------------------------------------------------------------------------------
async function buildReadme() {
  const page = await figma.getNodeByIdAsync(PAGES.readme); await page.loadAsync();
  for (const n of page.children.filter((c) => c.name === 'Read me')) n.remove();
  /*__README_BODY__*/
  const p5 = panel('Round 3', 1464); add(root, p5);
  add(p5, await text('Round 3 · placement and accessibility (24 Oct 2026)', 'Heading/Section'));
  for (const l of [
    'Every tappable thing is at least 44 × 44: buttons, chips, segments, icon buttons, top-bar back/action, section-header actions, text links (padded hit area).',
    'Smallest text is 12px. Status is never colour alone: warnings carry an icon and words (“Bills is at 92%”), unread carries a dot and a bold title and is named in the label.',
    'No gesture-only actions. Everything reachable by swipe also has a visible button (Mark paid, Accept / Decline, Edit).',
    'Home: the account pill opens a switcher sheet (Personal / Ghar, Manage, New account) — Settings already lives in the bottom bar. Budget row links to Budget and shows the even-pace marker in words. A “needs attention” banner surfaces the category closest to its limit. Bills have Mark paid inline.',
    'Transactions: the filter button shows how many filters are on; person chips filter the list; the footer says what is shown (“Showing 12 · Oct”).',
    'Add transaction: order follows the decisions — amount → category (drives the budget hint) → description → method → date → payer. “Repeat monthly” creates the recurring schedule in the same step.',
    'Budget: category rows open Transactions filtered to that category. Notifications: invites are answered inline. Onboarding: 3 steps with Back and Skip at the top.',
    'No Firestore collection or field changes: Mark paid writes an ordinary transaction, Repeat writes the existing recurring document, filters are client-side.',
  ]) add(p5, await text('• ' + l, 'Body/Regular'));
  const p6 = panel('Merge / split recommendations', 1464); add(root, p6);
  add(p6, await text('Merge / split — same 32 routes, fewer things to build', 'Heading/Section'));
  for (const l of [
    'New + Edit pairs (goal, category, recurring) → one form component with a create/edit mode. Same routes; one design to maintain.',
    'Add group expense → the Add transaction form plus a “Split” section. Same route; users learn one form.',
    'Add recurring → keep the route, but most people will use “Repeat monthly” on Add transaction instead.',
    'View recurring and Edit recurring → keep separate: viewing history is common, editing is rare and needs a confirm.',
    'Onboarding → 5 steps become 3 on the same route; anything skipped is reachable from Settings.',
    'Reports ↔ Budget → cross-link (Budget “See trends”, Reports “Open budget”); do not merge — different questions.',
    'Groups tab on a shared account → show a one-line hint with a “Switch to Personal” button instead of an empty list.',
    'Notification settings → stays a Settings subpage; add a “Notification settings” link at the bottom of Notifications.',
  ]) add(p6, await text('• ' + l, 'Body/Regular'));
  return `Read me → ${root.id} (${Math.round(root.height)}px)`;
}

// ---------------------------------------------------------------------------------------------
(async () => {
  const results = [];
  try {
    vars = Object.fromEntries(await Promise.all(Object.entries(V).map(async ([k, id]) => [k, await figma.variables.getVariableByIdAsync(id)])));
    await Promise.all([['DM Sans', 'Medium'], ['DM Sans', 'SemiBold'], ['DM Sans', 'Regular'], ['Space Grotesk', 'Medium'], ['Space Grotesk', 'Bold']].map(([family, style]) => figma.loadFontAsync({ family, style })));
  } catch (e) { figma.closePlugin(`Setup failed: ${e.message}`); return; }

  const steps = [
    ['Components', fixComponents],
    ['Home', () => replaceScreen(SECTIONS.core, 'Home · Dashboard', buildHome)],
    ['Transactions', () => replaceScreen(SECTIONS.core, 'Transactions', buildTransactions)],
    ['Add transaction', () => replaceScreen(SECTIONS.core, 'Add transaction', buildAdd)],
    ['Notifications', () => replaceScreen(SECTIONS.core, 'Notifications', buildNotifications)],
    ['Budget', () => replaceScreen(SECTIONS.budget, 'Budget', buildBudget)],
    ['Settings', () => replaceScreen(SECTIONS.settings, 'Settings', buildSettings)],
    ['Onboarding', () => replaceScreen(SECTIONS.auth, 'Onboarding', buildOnboarding)],
    ['Read me', buildReadme],
  ];
  const screensPage = await figma.getNodeByIdAsync(PAGES.screens);
  for (const [name, run] of steps) {
    try {
      if (name !== 'Read me') await figma.setCurrentPageAsync(screensPage);
      results.push(`✓ ${name}: ${await run()}`);
    } catch (e) { results.push(`✗ ${name}: ${e.message}`); }
  }
  await figma.setCurrentPageAsync(screensPage);
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('✗')).length;
  figma.closePlugin(failed ? `Round 3: ${failed} step(s) failed — see the console (Plugins → Development → Show/Hide console)` : 'Round 3 applied: components, 7 screens and the Read me page');
})();
