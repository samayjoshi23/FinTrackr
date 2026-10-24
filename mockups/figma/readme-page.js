// Builds the "Read me & Foundations" page of the FinTrackr UI v2 Figma file
// (https://www.figma.com/design/I9Y2OiKxuvC7vvDfZZFPIq). Run through the Figma MCP `use_figma`
// tool (top-level await is supported there). IDs below are the file's own variables and styles.
const pg = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(pg);
const V = {"brand/emerald":"VariableID:1:7","brand/ink":"VariableID:1:8","brand/soft":"VariableID:1:9","brand/soft-2":"VariableID:1:10","surface/ground":"VariableID:1:11","surface/card":"VariableID:1:12","surface/raised":"VariableID:1:13","line/border":"VariableID:1:14","line/rule":"VariableID:1:15","line/control":"VariableID:1:16","text/primary":"VariableID:1:17","text/muted":"VariableID:1:18","text/on-brand":"VariableID:1:19","money/income":"VariableID:1:20","money/expense":"VariableID:1:21","status/warning":"VariableID:1:22","status/warning-bar":"VariableID:1:23","status/warning-bg":"VariableID:1:24","status/negative":"VariableID:1:25","person/a-bg":"VariableID:1:26","person/a-ink":"VariableID:1:27","person/a-bar":"VariableID:1:28","person/b-bg":"VariableID:1:29","person/b-ink":"VariableID:1:30","person/b-bar":"VariableID:1:31"};
const S = {"Display/Amount":"S:cbad78ac43bd3b3d5286d95ad69c21ab4bac9d74,","Display/Balance":"S:01ed4ca35970c60c4a0fa9d0aabfa74505792b3c,","Title/Screen":"S:84a1b48d48f24184e390656609b418c542c2c062,","Title/Bar":"S:f1aa8e8062d0df605546851aab0e591e57ebc2fb,","Figure/Large":"S:5fe60e951c6ed9e9e3c076474799f9e3de67e7f4,","Figure/Body":"S:b79b883605d59c263200c0892fc37f974baabf48,","Heading/Section":"S:e9cc2be018ab3a3b7da532f3b671354d040cd4f4,","Body/Strong":"S:ef79032f223311a400d8dc8ea2289c1b9c1b3d72,","Body/Regular":"S:6769d51d4d5963bd5e550472ea0c441ad83d9c74,","Body/Small":"S:bd8e821563584c43cb852ba056ac4e19813d110b,","Label/Small":"S:124ec57269b9eae27907c47576a9671f113cd612,","Label/Nav":"S:d587963ae41a27444c90242403c9625fe3d88196,"};
const vars = Object.fromEntries(await Promise.all(Object.entries(V).map(async ([k, id]) => [k, await figma.variables.getVariableByIdAsync(id)])));
const fill = (k) => figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', vars[k]);
await Promise.all([['DM Sans','Medium'],['DM Sans','SemiBold'],['DM Sans','Regular'],['Space Grotesk','Medium'],['Space Grotesk','Bold']].map(([family, style]) => figma.loadFontAsync({ family, style })));
async function text(str, styleKey, colorKey = 'text/primary') { const t = figma.createText(); await t.setTextStyleIdAsync(S[styleKey]); t.characters = str; t.fills = [fill(colorKey)]; return t; }
function col(gap = 0, name = 'Column') { const f = figma.createAutoLayout('VERTICAL', { name, itemSpacing: gap }); f.fills = []; return f; }
function row(gap = 0, name = 'Row') { const f = figma.createAutoLayout('HORIZONTAL', { name, itemSpacing: gap }); f.counterAxisAlignItems = 'MIN'; f.fills = []; return f; }
function add(p, c) { p.appendChild(c); if (p.layoutMode === 'VERTICAL') { c.layoutSizingHorizontal = 'FILL'; if (c.type === 'TEXT') c.textAutoResize = 'HEIGHT'; } return c; }
function panel(name, w) { const f = col(14, name); f.resize(w, 100); f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'FIXED'; f.cornerRadius = 24; f.fills = [fill('surface/card')]; f.strokes = [fill('line/border')]; f.strokeWeight = 1; f.paddingTop = f.paddingBottom = f.paddingLeft = f.paddingRight = 32; return f; }

const root = col(32, 'Read me'); root.x = 0; root.y = 0; root.paddingTop = root.paddingBottom = root.paddingLeft = root.paddingRight = 48; root.fills = [fill('surface/ground')]; root.resize(1560, 100); root.primaryAxisSizingMode = 'AUTO'; root.counterAxisSizingMode = 'FIXED';
const head = col(8, 'Title'); add(root, head);
add(head, await text('FinTrackr · UI v2 wireframes', 'Display/Balance'));
add(head, await text('Phone wireframes (390 × 844) for every screen of the current app, redesigned with the UI/UX review and the round-2 feedback. 32 routed screens: none added, none removed. Updated 24 Oct 2026.', 'Body/Regular', 'text/muted'));

const cols = row(24, 'Panels'); add(root, cols);
const p1 = panel('How to use this file', 740); cols.appendChild(p1);
add(p1, await text('How this file is organised', 'Heading/Section'));
for (const l of ['Read me & Foundations — this page: screen inventory, design rules, colour and type tokens.', 'Components — icons (51), Bottom nav (5 variants), Top bar, Button, Input, Chip, Segment option, Avatar, Transaction row, Menu row, Section header. Every screen is built from these instances.', 'Screens — six sections in flow order: 01 Auth & onboarding · 02 Home, transactions, add, notifications · 03 Budget & goals · 04 Categories & recurring · 05 Groups & reports · 06 Settings & system.']) add(p1, await text('• ' + l, 'Body/Regular'));
add(p1, await text('Design rules applied', 'Heading/Section'));
for (const l of [
  'Inner screens get a back button and a short title in the top bar — no large heading or description underneath.',
  'Lists sit on the page, not inside cards. One filled summary card per screen at most.',
  'Money is colour-coded: income green with “+”, spending soft crimson with “−”.',
  'Home: greeting + app name, bell, and an account pill (“Ghar · SJ”) that opens Settings. Main card holds balance, In/Out, budget used and each person’s share. Quick actions stay.',
  'Transactions: search + filter in one row; period + All/In/Out below; out by person kept, out by category removed (it lives in Budget); a static totals footer above the nav.',
  'Add transaction: fields on the page, a large amount with quick-add chips, payment methods with icons, a date field, and a live “left in budget” hint.',
  'The Add button sits inside the bottom bar (never floating). The nav shows the same five destinations as today.',
  'Destructive actions are a separate red outlined button at the end of a screen, with the consequence spelled out.',
  'One date format, title-case sources, and budget tones shared by text and bar (neutral → 90% warning → red over).',
]) add(p1, await text('• ' + l, 'Body/Regular'));

const p2 = panel('Screen inventory', 740); cols.appendChild(p2);
add(p2, await text('Screen inventory → app route', 'Heading/Section'));
const inv = [
  ['01 Auth & onboarding', 'Login /login · Create account /register · Reset password /reset-password · Verify email /verify-email · Onboarding /onboarding'],
  ['02 Core', 'Home /user/dashboard · Transactions /user/transactions/list · Add transaction /user/transactions/add · Notifications /user/notifications'],
  ['03 Budget & goals', 'Budget /user/budgets · Edit budget /user/budgets/new · Goals /user/goals · New goal /user/goals/new · Edit goal /user/goals/edit/:id'],
  ['04 Categories & recurring', 'Categories /user/categories · New category /…/new · Edit category /…/edit/:id · Recurring /user/recurring · New recurring /…/add · View recurring /…/view/:id · Edit recurring /…/edit/:id'],
  ['05 Groups & reports', 'Groups /user/groups · Group detail /user/groups/:id · Add group expense /user/groups/:id/add · Reports /user/reports'],
  ['06 Settings & system', 'Settings /user/settings · Notification settings /user/settings/notifications · New account /user/settings/accounts/new · Account details /user/settings/accounts/:id · Privacy & security /…/privacy · About /…/about · Not found **'],
];
for (const [k, v] of inv) { const r = col(4, k); add(r, await text(k, 'Body/Strong')); add(r, await text(v, 'Body/Small', 'text/muted')); add(p2, r); }
add(p2, await text('Total: 32 screens + bottom nav. Shared sheets (transaction detail, confirm, date picker) keep today’s behaviour and use the same components.', 'Body/Small', 'text/muted'));

const p3 = panel('Colour', 1464); add(root, p3);
add(p3, await text('Colour variables (collection “FinTrackr colour”)', 'Heading/Section'));
const sw = row(16, 'Swatches'); sw.layoutWrap = 'WRAP'; sw.counterAxisSpacing = 16; add(p3, sw);
for (const k of Object.keys(V)) {
  const c = col(6, k); c.resize(150, 10); c.counterAxisSizingMode = 'FIXED'; c.primaryAxisSizingMode = 'AUTO';
  const chipR = figma.createRectangle(); chipR.resize(150, 56); chipR.cornerRadius = 12; chipR.fills = [fill(k)]; chipR.strokes = [fill('line/border')]; chipR.strokeWeight = 1; c.appendChild(chipR);
  add(c, await text(k, 'Label/Small')); sw.appendChild(c);
}
const p4 = panel('Type', 1464); add(root, p4);
add(p4, await text('Text styles — DM Sans for text, Space Grotesk for titles and figures', 'Heading/Section'));
for (const [k, sample] of [['Display/Amount', '₹1,250'], ['Display/Balance', '₹18,846.17'], ['Title/Screen', 'FinTrackr'], ['Title/Bar', 'Transactions'], ['Figure/Large', '+₹60,000'], ['Figure/Body', '−₹1,700'], ['Heading/Section', 'Recent transactions'], ['Body/Strong', 'House rent'], ['Body/Regular', 'Shared with Ayushi'], ['Body/Small', 'Bills · UPI · Samay'], ['Label/Small', 'Paid with'], ['Label/Nav', 'Transactions']]) {
  const r = row(24, k); r.counterAxisAlignItems = 'CENTER'; add(p4, r);
  const lbl = await text(k, 'Body/Small', 'text/muted'); r.appendChild(lbl); lbl.resize(180, lbl.height); lbl.textAutoResize = 'HEIGHT';
  r.appendChild(await text(sample, k));
}
return { readmeId: root.id, height: Math.round(root.height) };
