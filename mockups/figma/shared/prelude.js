// Shared by the round-3 and round-4 plugins: ids of the file's variables, styles and components,
// and the helpers the screens are built with. build.mjs inlines it where a plugin says /*__PRELUDE__*/.
// `figma.createAutoLayout` exists only in the Figma MCP runtime. The plugin API's `figma` object is frozen
// (it can't be polyfilled), so screens call this local helper; build.mjs rewrites readme-page.js to use it too.
const createAutoLayout = (direction = 'HORIZONTAL', opts = {}) => {
  const f = figma.createFrame();
  f.layoutMode = direction; f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
  f.fills = []; f.clipsContent = false;
  if (opts.name) f.name = opts.name;
  if (opts.itemSpacing != null) f.itemSpacing = opts.itemSpacing;
  return f;
};

const V = {"brand/emerald":"VariableID:1:7","brand/ink":"VariableID:1:8","brand/soft":"VariableID:1:9","brand/soft-2":"VariableID:1:10","surface/ground":"VariableID:1:11","surface/card":"VariableID:1:12","surface/raised":"VariableID:1:13","line/border":"VariableID:1:14","line/rule":"VariableID:1:15","line/control":"VariableID:1:16","text/primary":"VariableID:1:17","text/muted":"VariableID:1:18","text/on-brand":"VariableID:1:19","money/income":"VariableID:1:20","money/expense":"VariableID:1:21","status/warning":"VariableID:1:22","status/warning-bar":"VariableID:1:23","status/warning-bg":"VariableID:1:24","status/negative":"VariableID:1:25","person/a-bg":"VariableID:1:26","person/a-ink":"VariableID:1:27","person/a-bar":"VariableID:1:28","person/b-bg":"VariableID:1:29","person/b-ink":"VariableID:1:30","person/b-bar":"VariableID:1:31"};
const S = {"Display/Amount":"S:cbad78ac43bd3b3d5286d95ad69c21ab4bac9d74,","Display/Balance":"S:01ed4ca35970c60c4a0fa9d0aabfa74505792b3c,","Title/Screen":"S:84a1b48d48f24184e390656609b418c542c2c062,","Title/Bar":"S:f1aa8e8062d0df605546851aab0e591e57ebc2fb,","Figure/Large":"S:5fe60e951c6ed9e9e3c076474799f9e3de67e7f4,","Figure/Body":"S:b79b883605d59c263200c0892fc37f974baabf48,","Heading/Section":"S:e9cc2be018ab3a3b7da532f3b671354d040cd4f4,","Body/Strong":"S:ef79032f223311a400d8dc8ea2289c1b9c1b3d72,","Body/Regular":"S:6769d51d4d5963bd5e550472ea0c441ad83d9c74,","Body/Small":"S:bd8e821563584c43cb852ba056ac4e19813d110b,","Label/Small":"S:124ec57269b9eae27907c47576a9671f113cd612,","Label/Nav":"S:d587963ae41a27444c90242403c9625fe3d88196,"};
const IC = {"home":"3:5","list":"3:8","users":"3:11","gear":"3:14","plus":"3:17","check":"3:26","bell":"3:29","chevron":"3:32","back":"3:35","down":"3:38","search":"3:41","filter":"3:44","repeat":"3:47","calendar":"3:50","arrowIn":"3:53","arrowOut":"3:56","target":"3:59","chart":"3:62","pie":"3:65","tag":"3:68","lock":"3:71","info":"3:74","bank":"3:80","wallet":"3:83","card":"3:86","cash":"3:89","upi":"3:92","edit":"3:95","mail":"3:101","user":"3:107","bulb":"3:134","basket":"3:137","leaf":"3:140","cup":"3:143","fork":"3:146","screen":"3:149","plane":"3:152","coin":"3:155"};
const C = {"nav":{"Home":"4:2","Transactions":"4:22","Groups":"4:42","Settings":"4:62","None":"4:82"},"topBar":{"id":"4:103","title":"Title#4:0","showAction":"Show action#4:1","action":"Action#4:2","actionIcon":"Action icon#7:0"},"buttonSet":"4:124","button":{"label":"Label#4:3","Primary/Large":"4:112","Primary/Medium":"4:114","Secondary/Large":"4:116","Secondary/Medium":"4:118","Danger/Large":"4:120","Danger/Medium":"4:122"},"input":{"id":"5:28","label":"Label#5:0","value":"Value#5:1","showLabel":"Show label#5:2","showIcon":"Show icon#5:3","icon":"Icon#5:4"},"chip":{"False":"5:34","True":"5:38","label":"Label#5:5","showIcon":"Show icon#5:8","icon":"Icon#5:11"},"segment":{"False":"5:43","True":"5:45","label":"Label#5:14"},"avatar":{"initials":"Initials#5:17","A/Small":"5:48","A/Medium":"5:50","B/Small":"5:52","B/Medium":"5:54","Me/Small":"5:56","Me/Medium":"5:58"},"txRow":{"Expense":"5:61","Income":"5:68","title":"Title#5:24","meta":"Meta#5:27","amount":"Amount#5:30","icon":"Icon#5:33"},"menuRow":{"id":"5:76","title":"Title#5:36","subtitle":"Subtitle#5:37","showSubtitle":"Show subtitle#5:38","value":"Value#5:39","showValue":"Show value#5:40","icon":"Icon#5:41"},"sectionHeader":{"id":"5:85","title":"Title#5:42","action":"Action#5:43","showAction":"Show action#5:44"}};
const PAGES = { readme: '0:1', components: '1:4', screens: '1:5' };
const SECTIONS = { auth: '6:2', core: '7:87', budget: '9:331', settings: '12:973' };

let vars = {};
const fill = (k) => figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', vars[k]);
const compCache = {};
const comp = async (id) => (compCache[id] ??= await figma.getNodeByIdAsync(id));
const getStyle = async (id) => (await figma.getStyleByIdAsync(id)) || figma.getStyleByIdAsync(id.replace(/,$/, ''));
async function text(str, styleKey, colorKey = 'text/primary', opts = {}) { const t = figma.createText(); await t.setTextStyleIdAsync(S[styleKey]); t.characters = str; t.fills = [fill(colorKey)]; if (opts.name) t.name = opts.name; if (opts.align) t.textAlignHorizontal = opts.align; return t; }
async function icon(name, size = 20, colorKey = 'text/muted') { const inst = (await comp(IC[name])).createInstance(); inst.resize(size, size); for (const v of inst.findAllWithCriteria({ types: ['VECTOR'] })) v.strokes = [fill(colorKey)]; return inst; }
function col(gap = 0, name = 'Column') { const f = createAutoLayout('VERTICAL', { name, itemSpacing: gap }); f.fills = []; return f; }
function row(gap = 0, name = 'Row') { const f = createAutoLayout('HORIZONTAL', { name, itemSpacing: gap }); f.counterAxisAlignItems = 'CENTER'; f.fills = []; return f; }
function add(parent, child, fillH = true) { parent.appendChild(child); if (fillH && parent.layoutMode === 'VERTICAL') { child.layoutSizingHorizontal = 'FILL'; if (child.type === 'TEXT') child.textAutoResize = 'HEIGHT'; } return child; }
function grow(parent, child) { parent.appendChild(child); child.layoutGrow = 1; if (child.type === 'TEXT') child.textAutoResize = 'HEIGHT'; return child; }
function pad(f, t, r = t, b = t, l = r) { f.paddingTop = t; f.paddingRight = r; f.paddingBottom = b; f.paddingLeft = l; return f; }
function ruleTop(n) { n.strokes = [fill('line/rule')]; n.strokeTopWeight = 1; n.strokeBottomWeight = 0; n.strokeLeftWeight = 0; n.strokeRightWeight = 0; return n; }
function outline(f, key = 'line/border') { f.strokes = [fill(key)]; f.strokeWeight = 1; return f; }
// Components: change height, keep hugging width. Layout rows: minHeight, so FILL widths survive.
function setH(f, h) { f.counterAxisSizingMode = 'FIXED'; f.resize(Math.max(1, f.width), h); f.primaryAxisSizingMode = 'AUTO'; return f; }
function minH(f, h) { f.minHeight = h; return f; }
function card(gap = 12, fillKey = 'surface/card', name = 'Card') { const f = col(gap, name); f.cornerRadius = 20; f.fills = [fill(fillKey)]; if (fillKey === 'surface/card') outline(f); pad(f, 18); return f; }
function absolute(parent, child, x, y) { parent.appendChild(child); child.layoutPositioning = 'ABSOLUTE'; child.x = x; child.y = y; return child; }
async function topBar(title, action, actionIcon) { const i = (await comp(C.topBar.id)).createInstance(); i.setProperties({ [C.topBar.title]: title, [C.topBar.showAction]: !!action, ...(action ? { [C.topBar.action]: action } : {}), ...(actionIcon ? { [C.topBar.actionIcon]: IC[actionIcon] } : {}) }); return i; }
async function nav(active) { return (await comp(C.nav[active])).createInstance(); }
async function btn(label, kind = 'Primary/Large') { const i = (await comp(C.button[kind])).createInstance(); i.setProperties({ [C.button.label]: label }); return i; }
async function input(label, value, iconName) { const i = (await comp(C.input.id)).createInstance(); i.setProperties({ [C.input.label]: label || 'Label', [C.input.value]: value, [C.input.showLabel]: !!label, [C.input.showIcon]: !!iconName, ...(iconName ? { [C.input.icon]: IC[iconName] } : {}) }); return i; }
async function chip(label, selected = false, iconName) { const i = (await comp(C.chip[selected ? 'True' : 'False'])).createInstance(); i.setProperties({ [C.chip.label]: label, [C.chip.showIcon]: !!iconName, ...(iconName ? { [C.chip.icon]: IC[iconName] } : {}) }); return i; }
async function seg(options, selected = 0, full = true) { const t = row(0, 'Segmented'); t.cornerRadius = 999; t.fills = [fill('surface/raised')]; pad(t, 3); for (const [i, o] of options.entries()) { const s = (await comp(C.segment[i === selected ? 'True' : 'False'])).createInstance(); s.setProperties({ [C.segment.label]: o }); t.appendChild(s); if (full) s.layoutGrow = 1; } return t; }
async function avatar(person, size, initials) { const i = (await comp(C.avatar[`${person}/${size}`])).createInstance(); if (initials) i.setProperties({ [C.avatar.initials]: initials }); return i; }
async function txRow(type, title, meta, amount, iconName) { const i = (await comp(C.txRow[type])).createInstance(); i.setProperties({ [C.txRow.title]: title, [C.txRow.meta]: meta, [C.txRow.amount]: amount, [C.txRow.icon]: IC[iconName] }); return i; }
async function menuRow(title, subtitle, value, iconName) { const i = (await comp(C.menuRow.id)).createInstance(); i.setProperties({ [C.menuRow.title]: title, [C.menuRow.showSubtitle]: !!subtitle, ...(subtitle ? { [C.menuRow.subtitle]: subtitle } : {}), [C.menuRow.showValue]: !!value, ...(value ? { [C.menuRow.value]: value } : {}), [C.menuRow.icon]: IC[iconName] }); return i; }
async function secHead(title, action) { const i = (await comp(C.sectionHeader.id)).createInstance(); i.setProperties({ [C.sectionHeader.title]: title, [C.sectionHeader.showAction]: !!action, ...(action ? { [C.sectionHeader.action]: action } : {}) }); return i; }
async function menuGroup(rows) { const g = col(0, 'Menu group'); g.cornerRadius = 20; g.clipsContent = true; outline(g); g.fills = [fill('surface/card')]; for (const r of rows) add(g, r); return g; }
function bar(pct, colorKey = 'brand/emerald', trackKey = 'surface/raised', h = 6, w = 350) { const t = figma.createFrame(); t.name = 'Progress'; t.resize(w, h); t.cornerRadius = 999; t.clipsContent = false; t.fills = [fill(trackKey)]; const f = figma.createRectangle(); f.name = 'Fill'; f.resize(Math.max(1, w * pct), h); f.cornerRadius = 999; f.fills = [fill(colorKey)]; t.appendChild(f); return t; }
async function iconBtn(name, filled = true, label) { const b = row(0, label ? `Icon button · ${label}` : 'Icon button'); b.resize(44, 44); b.primaryAxisSizingMode = 'FIXED'; b.counterAxisSizingMode = 'FIXED'; b.primaryAxisAlignItems = 'CENTER'; b.cornerRadius = 999; b.clipsContent = false; if (filled) { b.fills = [fill('surface/card')]; outline(b); } b.appendChild(await icon(name, 20, 'text/primary')); return b; }
function dot(colorKey, size = 8) { const d = figma.createEllipse(); d.name = 'Unread dot'; d.resize(size, size); d.fills = [fill(colorKey)]; return d; }
async function textBtn(label, colorKey = 'brand/ink') { const b = row(4, `Text button · ${label}`); pad(b, 0, 8); minH(b, 44); b.appendChild(await text(label, 'Label/Small', colorKey)); return b; }
async function pillToggle(label, pressed, person, initials) { const p = row(6, `Toggle · ${label}`); pad(p, 0, 14, 0, 8); minH(p, 44); p.cornerRadius = 999; p.fills = [fill(pressed ? 'brand/soft' : 'surface/card')]; outline(p, pressed ? 'brand/ink' : 'line/border'); p.appendChild(await avatar(person, 'Small', initials)); p.appendChild(await text(label, 'Body/Small', pressed ? 'brand/ink' : 'text/primary')); return p; }
function toggle(on) { const tg = row(0, on ? 'Switch · on' : 'Switch · off'); tg.resize(48, 28); tg.primaryAxisSizingMode = 'FIXED'; tg.counterAxisSizingMode = 'FIXED'; tg.cornerRadius = 999; tg.fills = [fill(on ? 'brand/ink' : 'line/control')]; pad(tg, 3); tg.primaryAxisAlignItems = on ? 'MAX' : 'MIN'; const k = figma.createEllipse(); k.resize(22, 22); k.fills = [fill('surface/card')]; tg.appendChild(k); return tg; }
function footerBar() { const ft = col(0, 'Footer'); pad(ft, 12, 20, 16, 20); ft.fills = [fill('surface/card')]; ruleTop(ft); ft.strokes = [fill('line/border')]; return ft; }
async function screen(section, name, x, { navActive = null, top = null, topAction = null, topActionIcon = null, ground = 'surface/ground', footer = null } = {}) {
  const f = col(0, name); f.resize(390, 844); f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'FIXED'; f.minHeight = 844; f.fills = [fill(ground)]; f.clipsContent = true;
  section.appendChild(f); f.x = x; f.y = 80;
  if (top) add(f, await topBar(top, topAction, topActionIcon));
  const body = col(20, 'Content'); pad(body, top ? 4 : 20, 20, 32, 20); add(f, body); body.layoutGrow = 1;
  if (footer) add(f, footer);
  if (navActive) add(f, await nav(navActive));
  return { f, body };
}
function finalize(f) { const body = f.children.find((c) => c.name === 'Content'); body.layoutGrow = 0; body.layoutSizingVertical = 'HUG'; f.primaryAxisSizingMode = 'AUTO'; const h = f.height; f.primaryAxisSizingMode = 'FIXED'; f.resize(390, Math.max(844, Math.ceil(h))); body.layoutGrow = 1; return Math.round(f.height); }
function fitSection(sec) { const bottom = Math.max(...sec.children.map((c) => c.y + c.height)); if (bottom + 80 > sec.height) sec.resizeWithoutConstraints(sec.width, bottom + 80); }
function annotate(f, note) { f.setSharedPluginData('fintrackr', 'round', '3'); f.setSharedPluginData('fintrackr', 'note', note); }

// Replace a screen by name inside its section, keeping position and stacking order.
async function replaceScreen(sectionId, name, build) {
  const sec = await figma.getNodeByIdAsync(sectionId);
  const old = sec.children.find((c) => c.name === name);
  if (!old) throw new Error(`"${name}" not found in ${sec.name}`);
  const { x, y } = old; const index = sec.children.indexOf(old);
  const f = await build(sec, x);
  f.y = y; sec.insertChild(index, f); old.remove();
  const h = finalize(f);
  const sheet = f.children.find((c) => c.name.startsWith('Account switcher sheet'));
  if (sheet) sheet.y = f.height - sheet.height;
  fitSection(sec);
  return `${name} → ${f.id} (${h}px)`;
}


// Sheet building blocks (round 4+): the one bottom-sheet pattern and its parts.
async function kvRow(k, v, first) { const r = row(16, k); r.primaryAxisAlignItems = 'SPACE_BETWEEN'; pad(r, 11, 0); if (!first) ruleTop(r); r.appendChild(await text(k, 'Body/Regular', 'text/muted')); r.appendChild(await text(v, 'Body/Strong')); return r; }
async function lead(str) { return text(str, 'Body/Regular', 'text/muted'); }
async function noteBox(iconName, str, tone = 'neutral') { const n = row(10, 'Note'); n.counterAxisAlignItems = 'MIN'; pad(n, 12, 14); n.cornerRadius = 14; n.fills = [fill(tone === 'warn' ? 'status/warning-bg' : 'surface/raised')]; n.appendChild(await icon(iconName, 18, tone === 'warn' ? 'status/warning' : 'text/muted')); grow(n, await text(str, 'Body/Small', tone === 'warn' ? 'status/warning-ink' : 'text/muted')); return n; }
async function pairActions(a, b) { const r = row(12, 'Actions'); pad(r, 20, 0, 0, 0); for (const x of [a, b]) { r.appendChild(x); x.layoutGrow = 1; } return r; }
async function solidDanger(label) { const b = await btn(label, 'Primary/Medium'); b.fills = [fill('status/negative')]; return b; }
async function bigAmount(str, colorKey, size = 26) { const t = await text(str, 'Figure/Large', colorKey); t.fontSize = size; return t; }

async function sheetComp(name, title, build) {
  const c = figma.createComponent(); c.name = `Sheet / ${name}`;
  c.layoutMode = 'VERTICAL'; c.itemSpacing = 0; c.resize(390, 100); c.counterAxisSizingMode = 'FIXED'; c.primaryAxisSizingMode = 'AUTO';
  pad(c, 8, 20, 28, 20); c.topLeftRadius = c.topRightRadius = 24; c.fills = [fill('surface/card')];
  c.effects = [{ type: 'DROP_SHADOW', color: { r: 0.07, g: 0.13, b: 0.11, a: 0.16 }, offset: { x: 0, y: -8 }, radius: 32, spread: 0, visible: true, blendMode: 'NORMAL' }];
  const grab = row(0, 'Grabber'); grab.primaryAxisAlignItems = 'CENTER'; pad(grab, 0, 0, 12, 0); add(c, grab);
  const g = figma.createRectangle(); g.resize(40, 4); g.cornerRadius = 999; g.fills = [fill('line/control')]; grab.appendChild(g);
  const head = row(8, 'Header'); head.primaryAxisAlignItems = 'SPACE_BETWEEN'; add(c, head);
  grow(head, await text(title, 'Heading/Section')); head.appendChild(await iconBtn('x', false, 'Close'));
  await build(c);
  return c;
}
// Hidden overlay (scrim + sheet) on a screen. Show the layer to review the popup in context.
function overlay(screen, sheet, label, extra) {
  screen.children.filter((n) => n.name === `Overlay · ${label} (show to review)`).forEach((n) => n.remove());
  const o = figma.createFrame(); o.name = `Overlay · ${label} (show to review)`; o.fills = []; o.clipsContent = true;
  screen.appendChild(o); o.layoutPositioning = 'ABSOLUTE'; o.x = 0; o.y = 0; o.resize(390, screen.height);
  const scrim = figma.createRectangle(); scrim.name = 'Scrim'; scrim.resize(390, screen.height); scrim.fills = [fill('overlay/scrim')]; o.appendChild(scrim);
  const s = sheet.createInstance(); o.appendChild(s); s.x = 0; s.y = Math.max(0, screen.height - s.height);
  if (extra) extra(o);
  o.visible = false;
  return o;
}

// Every colour variable by name, including tokens added by later rounds (looked up, not hard-coded ids).
async function loadAllVars() {
  vars = Object.fromEntries(await Promise.all(Object.entries(V).map(async ([k, id]) => [k, await figma.variables.getVariableByIdAsync(id)])));
  for (const v of await figma.variables.getLocalVariablesAsync('COLOR')) if (!vars[v.name]) vars[v.name] = v;
}

// Screen lookups, list cards and state layers (round 5+).
async function frameIn(sectionId, name) { const sec = await figma.getNodeByIdAsync(sectionId); const f = sec.children.find((c) => c.name === name); if (!f) throw new Error(`"${name}" not found`); return f; }
const relY = (node, frame) => node.absoluteBoundingBox.y - frame.absoluteBoundingBox.y;
function removeStates(f) { f.findAll((n) => n.name.startsWith('State · ')).forEach((n) => n.remove()); }
function newCard(name = 'Day card') { const c = col(0, name); c.fills = [fill('surface/card')]; outline(c); c.cornerRadius = 16; c.clipsContent = true; pad(c, 0, 14); return c; }
function stateLayer(f, label, top, beforeName) {
  const o = col(0, `State · ${label} (show to review)`); o.fills = [fill('surface/ground')]; pad(o, 0, 20);
  // The bottom nav is the last instance in the screen's flow (overlays are absolute and come after it).
  const flow = f.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  const last = flow[flow.length - 1];
  const nav = last && last.type === 'INSTANCE' ? last : f.children.find((c) => c.name === beforeName);
  const idx = nav ? f.children.indexOf(nav) : f.children.length;
  f.insertChild(idx, o); o.layoutPositioning = 'ABSOLUTE'; o.x = 0; o.y = top;
  o.resize(390, Math.max(10, f.height - top)); o.primaryAxisSizingMode = 'FIXED'; o.clipsContent = true;
  return o;
}
async function skeletonSummary() {
  const s = card(14, 'brand/soft', 'Summary skeleton'); // fills its parent's width once added
  const bar = (bw, h) => { const r = figma.createRectangle(); r.resize(bw, h); r.cornerRadius = 6; r.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.85 }]; return r; };
  s.appendChild(await text('Total balance · Ghar', 'Body/Small', 'text/on-soft')); s.appendChild(bar(180, 30));
  const two = row(10); two.appendChild(bar(152, 56)); two.appendChild(bar(152, 56)); s.appendChild(two);
  s.appendChild(bar(314, 8)); s.appendChild(bar(220, 10)); return s;
}
