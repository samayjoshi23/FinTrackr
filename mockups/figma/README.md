# FinTrackr UI v2 — Figma wireframes

File: https://www.figma.com/design/I9Y2OiKxuvC7vvDfZZFPIq

Pages (Starter plan allows 3):
- **Read me & Foundations** — built by the round-3 plugin (screen inventory, rules, tokens, round-3 notes, merge/split).
- **Components** — 51 icons, Bottom nav (Active = Home / Transactions / Groups / Settings / None),
  Top bar, Button, Input, Chip, Segment option, Avatar, Transaction row, Menu row, Section header.
- **Screens** — 32 frames (390 wide), one per app route, in six sections.

Variables: `FinTrackr colour` (25 colours) and `FinTrackr size` (radius/spacing).
Text styles: 12 (DM Sans + Space Grotesk).

## Round 3 update (run once)
The Figma MCP is capped by the Starter plan's monthly tool-call limit, so the round-3 edits ship as a
local development plugin (`round3-plugin/`). It:
1. sets 44px targets on Button (Medium), Chip, Segment option, Top bar back/action, Section header and
   every "Icon button" frame; raises Label/Nav to 12px and the small avatar to 22px / 12px;
2. rebuilds Home, Transactions, Add transaction, Notifications, Budget, Settings and Onboarding in place
   (same section, position and name — the screen count stays 32). Home carries the account-switcher
   sheet as a hidden layer;
3. builds the Read me page.

How to run (Figma desktop app, file open):
1. **Plugins → Development → Import plugin from manifest…** and pick `round3-plugin/manifest.json`.
2. **Plugins → Development → FinTrackr UI v2 · Round 3**. It closes with a summary; on any failure,
   open **Plugins → Development → Show/Hide console** for the per-step log.

It is safe to run again (screens are matched by name, the Read me frame is rebuilt). Undo with ⌘Z.

## Round 4 update (run once, after round 3)
`round4-plugin/` — import its `manifest.json` the same way and run **FinTrackr UI v2 · Round 4**. It:
1. sets every colour variable to the mockup CSS (`mockups/ui-v2/assets/fintrackr.css`), adds the 7 tokens
   Figma was missing, binds loose paints that equal a token and lists off-palette colours on the Read me page;
2. aligns text styles with the mockup (SemiBold figures/titles, Label/Small 14/20, selected chip in brand/deep);
3. adds pause / play / alert / clock / phone icons and a **Sheets & popups** board on the Components page;
4. rebuilds Recurring, View / Add / Edit recurring, Notifications and Notification settings in place;
5. places the popups on Transactions and View recurring as hidden "Overlay · … (show to review)" layers
   (toggle the eye in the Layers panel); the screen count stays 32;
6. appends round-4 notes and the colour/type check to the Read me page.

## Round 5 update (run once, after round 4)
`round5-plugin/` — import its `manifest.json` and run **FinTrackr UI v2 · Round 5**. It:
1. regroups list rows into cards in place: one card per day on Transactions and Home's recent list,
   Home's upcoming bills, each recurring section and a schedule's payments (Transaction row → 64px);
2. adds a **Date pickers & loading** board on Components: Sheet / Date, Sheet / Date range,
   Skeleton / Row, Skeleton / Day card, Button / Saving, Banner / Offline (and the `text/disabled` token);
3. places hidden states to review: "State · Loading" on Transactions, Home and Recurring,
   "State · Offline banner" on Transactions, "State · Saving" on Add transaction, and the pickers as
   "Overlay · Date" (Add transaction) and "Overlay · Custom range" (Transactions);
4. appends round-5 notes to the Read me page.

## Round 6 update (run once, after round 5)
`round6-plugin/` — import its `manifest.json` and run **FinTrackr UI v2 · Round 6**. It:
1. makes pills shorter (chip/segment 36px, medium button 40px, large 48px, top-bar action 40px) and steps the
   large type down (amount 40, balance 28, screen title 20, bar title 17, figures 16, section 15, labels 13);
2. removes every hidden "(show to review)" layer from the 32 route screens and re-fits their heights;
3. adds a **Dropdowns** board: Popover / Paid by, Dropdown / Member search (results, searching, no match),
   Sheet / Switch account;
4. builds **07 · States (not routes)** below the route sections — 21 real frames named
   "<Screen> — <State>" in three rows: popovers & sheets, dropdowns & date pickers, loading & system.

## Round 7 update: prototype wiring (run once, after round 6)
`round7-plugin/` — import its `manifest.json` and run **FinTrackr UI v2 · Round 7**. It only adds tap
interactions: no frame is added, removed or moved. Then press ▶ (Present) on the Screens page.
- bottom-bar tabs + Add button and every top-bar Back arrow are wired once, on the components;
- route screens link to the screen the same action opens in the app (flow map in `UI_V2.md` §12);
- popovers, sheets and pickers open their frame from "07 · States"; scrim, ✕, Cancel and Keep it go back;
  each confirm button lands on the screen the app returns to;
- flow starting points: **Sign in** (Login) and **Signed in** (Home);
- frames taller than the phone scroll vertically in the prototype.
The console lists any layer it could not find (skipped) and any target it could not resolve.

## Editing the plugins
Sources: `shared/prelude.js` (ids + helpers), `round3/4/5/6/7-plugin/src/*.js`,
`readme-page.js`. Rebuild every `code.js` with `node mockups/figma/build.mjs`.
