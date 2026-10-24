# UI v2

_Written 2026-10-24._

This document has two parts:
- **The flaws.** Everything the UI/UX review found, using the Emil Kowalski design-engineering checklist on the live app.
- **The v2 design.** The fix, designed with the taste skill.

Mockups are in [`mockups/ui-v2/`](../mockups/ui-v2/index.html). Open `index.html` in a browser; below 760px wide it shows the phone layout.

---

## 1. Flaws found in the current app

The review used screenshots from a full click-through of the live app at phone width, plus a pass over `styles.css`, `theme.css`, `modal.css` and `date-picker.css`.

### 1.1 Wrong or misleading information (fix first)

| Flaw | Where | Fix |
|---|---|---|
| **Dashboard October totals disagree with the rest of the app.** The dashboard shows income ₹30,000 and expense ₹39,619. The transaction list and Budgets show ₹60,000 in and ₹44,629 spent. | Dashboard summary cards | The dashboard reads the saved monthly report, which looks out of date. Rebuild the report, or compute these cards from the transactions. |
| **Settings stats mix scopes.** "Accounts 2" and "Balance ₹1,94,351" sum both accounts, but "Transactions 95" counts only Ghar. | Settings header | Use one scope for all three, or label each ("Ghar · 95 transactions"). |
| **"Premium Member" label, with no premium tier.** | Settings header | Remove it, or show something true ("Member since Jul 2026"). |
| **Empty states show while data is still loading.** Budgets said "No budget set yet" and offered to create one when a ₹60,000 plan existed. The cache cause is fixed; the pattern remains. | Budgets, and any page that shows an empty state when it has no data | Show a skeleton until the first load finishes. Only show an empty state after a load really returned nothing. |
| **An active monthly schedule last paid 6 Aug shows "Next payment —".** It doesn't say September and October were missed. | Recurring detail | Show the next due date, or an "Overdue since 6 Sep" badge. |

### 1.2 Inconsistency

| Flaw | Where | Fix |
|---|---|---|
| Five date formats: `07 Oct, 2026`, `Oct 7, 2026`, `Oct 7`, raw `2026-08-06`, `Today, 23:20`. | Dashboard, list, account details, recurring detail, privacy | One date pipe: `7 Oct` in lists, `Today` / `Yesterday` for recent days, the year only outside the current year. |
| Payment source case differs: "UPI · Bank" on the dashboard, "BANK · CASH" in the list. | Transaction rows | Normalize when displaying: title case, except UPI. |
| A "0%" budget shows in orange (a warning colour). Bills "92%" text is orange while its bar is red. | Budget category cards | One tone rule for both text and bar: neutral below 90%, warning from 90%, red only when over. Zero is neutral. |
| The period chips wrap at phone width, leaving "1Y" alone on a second row. | Reports | One segmented row, or a row that scrolls sideways. |
| The "Switch to this account" button squeezes the title so "Account Details" wraps onto two lines. | Account details header | Move the switch action into the account card. |

### 1.3 Usability

| Flaw | Where | Fix |
|---|---|---|
| Edit and delete are pastel icon-only squares placed side by side, and delete appears on every row. Accidental deletes are easy, and nothing explains the icons. | Categories list, transaction detail sheet | Put delete in an overflow menu or behind a swipe. Keep a gap from edit; tap targets at least 44px. |
| Your own row in Members is greyed out, so "samay joshi (Owner) (You)" looks disabled. | Account details → Members | Owner at normal contrast; other rows marked as tappable instead. |
| Icons already used by another category are only slightly faded, with no explanation. | New/Edit category | Fade them clearly and add a line: "Used by Bills". |
| On a shared account, the Groups tab is a dead end: it explains why, but offers no way out. | Groups | A "Switch to Personal" button, or hide the tab on shared accounts. |
| Dozens of rows repeat "Oct 7, 2026" with no grouping. | Transaction list | Day headers with the day's total; no date on each row. |
| Google sign-in is a lone "G" icon. | Login | A full-width "Continue with Google" button. |
| No date field is visible on the add form (not verified). | Add transaction | A date row that defaults to Today. |

### 1.4 Motion and interaction

| Before | After | Why |
|---|---|---|
| Every page entry: `page-fade-up 0.42s` plus up to 290ms of stagger, about 700ms per page | Max 200ms, opacity plus `translateY(6px)`, stagger only the first 2–3 items, none on tab switches | Pages open dozens of times a day; frequent actions should feel instant |
| Modal and date-picker enter in `0.5s` | `250ms cubic-bezier(0.32, 0.72, 0, 1)` | Sheets should land under 300ms |
| Modal and date-picker exit in `0.5s cubic-bezier(0.4, 0, 1, 1)` (ease-in) | `200ms cubic-bezier(0.23, 1, 0.32, 1)` | Never ease-in on UI; closing is faster than opening |
| `.budget-progress-fill { transition: width 1s }` | `transform: scaleX()` with `transform-origin: left`, 300ms, first view only | Animating `width` forces layout; 1s on every visit drags |
| `.card.clickable` / `.bg-primary-light.clickable`: `transition: all 0.2s ease-in-out`; Reports chips use `transition-all` | `transition: transform 160ms ease-out, background-color 160ms ease` | Name the properties; `all` animates things nobody meant to |
| No `:active` state on chips, plain rows, icon buttons, the bottom nav or the + button | `:active { transform: scale(0.97) }`, `transition: transform 160ms ease-out` | Only `.button-*` and `.clickable` respond to a press today |
| 11 `:hover` rules with no media query (notification cards, filter tabs, date-picker chips, modal close) | Wrap in `@media (hover: hover) and (pointer: fine)` | Hover sticks after a tap on phones |
| `prefers-reduced-motion` only in the modal and date picker | Also the page fade-up, stagger and progress fills (opacity only) | The heaviest motion ignores the user's setting |
| `.button-primary { transition: transform 0.2s ease-in-out }` | `160ms cubic-bezier(0.23, 1, 0.32, 1)` | Press feedback should be crisp |
| `.fintrackr-modal-cdk-pane { max-height: 100vh }` | `max-height: 100dvh` | `100vh` ignores the mobile URL bar, so sheets get cut off |

**Not reviewed yet:** Groups screens, dark mode, offline states, and feel on a real device.

---

## 2. Design direction for v2

The direction was made with the **taste skill** (`design-taste-frontend`, app-screen run). It dealt the
**pastel-consumer** style (seed `2076740600`) for a wallet / budgeting product. The brand is kept as it is.

| Decision | Value | Why |
|---|---|---|
| Style | Pastel consumer: one large radius (20px cards → 10 → 8 → 5), white panels on a faintly green ground, quiet money signs | A phone-first budgeting app read in quick daily looks; close to today's soft look, so v2 is an evolution, not a rebrand |
| Brand kept | Emerald `#059669` for the mark and the main data element; `#047857` for the one filled action (5.5:1 with white); DM Sans for text; Space Grotesk for titles and figures | `--keep palette,type` |
| Colour budget | About 5–8% of the screen. Emerald on data and one action, amber for warning, red only when over plan, pale sky and amber tints for the two people | Colour on data and status, not on chrome |
| Face | **The household's people.** Samay and Ayushi each get one pale tint (sky, amber), used on their avatars, their share of the pot and who-paid splits | A shared account is about two people; this is what makes it FinTrackr and not a kit |
| Signature element | **The pot.** Ghar is funded by two ₹30,000 shares. Home answers "how much of October's pot is left?" with one track: plan, spent, and a tick at the even pace for today (₹44,516 by 23 Oct, so ₹113 over) | Built from the product's own data; no other money app has this exact object |
| Money polarity | Income in green with a `+`; spending in ink; no red on ordinary outgoings | Red is a signal, not a texture |
| Icons | One 1.5px outline set in grey, in a fixed 24px slot | **A deliberate change from the dealt sheet**, which puts category icons in pale tinted tiles. The inspector fails tinted icon tiles repeated down a list (the commonest generated-dashboard tell), so tints are kept for people only |
| Motion | Press `scale(0.97)` at 140ms ease-out on every pressable; hover only on devices that can hover; no page-entry animation; `prefers-reduced-motion` honoured | Fixes section 1.4 |

**Tokens** live in [`mockups/ui-v2/assets/fintrackr.css`](../mockups/ui-v2/assets/fintrackr.css) and are ready to move into `src/shared/themes/theme.css`.

**Shell:**
- **Desktop:** a 72px icon rail with the brand mark, Home / Activity / Add / Budget / Settings, and Add as the one filled action.
- **Below 760px:** the same five items become the bottom bar, with short labels and the safe-area inset.

---

## 3. Screen by screen

Each screen answers one question first; its largest figure is the answer.

### Home: "How much of October's pot is left?"
- **Title row:** `Ghar · October`. The finding goes under it: "₹1,921 a day for the 8 days left. Bills is at 92% of its ₹40,000."
- **The pot:** ₹15,371 left of ₹60,000. The track shows spent plus the even-pace tick. Each person's share sits beside their avatar, and "Spent by 23 Oct ₹44,629" carries an "over even pace" pill.
- **Closest to the limit:** four categories, text and bar in one tone.
- **Recent activity:** grouped by day, with each day's total. Each row: category · source · payer avatar.
- **Due next:** the 4 bills on 5 Nov (₹36,900), with one "Review bills" action.
- **Paid this month:** a split bar in each person's tint (Samay ₹32,821, Ayushi ₹11,808).
- **Removed:**
  - the 4-icon "Quick actions" grid (Add moves to the shell);
  - the separate income/expense cards that disagreed with the transactions.

### Activity (transactions): "What went out, by day, and who paid?"
- **Controls:** search, an All / In / Out segment and Filters in one row; the period selector sits in the title row.
- **Summary line:** "12 transactions · In +₹60,000 · Out ₹44,629", recomputed for every filter.
- **Rows:** grouped by day ("Mon, 19 Oct · ₹1,102 out"). One date format, title-case sources, a "monthly" mark on recurring rows.
- **Load older:** the history footer comes from the new delta sync: "Showing everything since 1 Aug. Older months load when you need them."
- **Desktop side column:** stays pinned while the list scrolls. It holds out by category and out by person as thin grey bars, with the largest in emerald.

### Budget: "Which category is close to its limit?"
- **Title row:** `Budget` with a month switcher. The finding names the categories at 90% or more.
- **Every category:** "₹36,900 of ₹40,000 · 92% · ₹3,100 left", with a legend for the three tones. Zeros are neutral.
- **October plan card:** ₹15,371 left, then income, allocated, not allocated, spent, and daily room, plus one "Edit budget" action.
- **Phone:** the plan card moves first, because it carries the answer.

### Add: "What does this spend do to the month?"
- **One form:**
  - Money out / Money in;
  - a large amount;
  - "What was it for?";
  - **Date** (Today by default), fixing the missing date field;
  - **Paid by** (Samay / Ayushi), category chips with icons, and Paid with.
- **"After this" preview:** before saving, it shows the category and the month with the new amount as a lighter segment. Daily room "drops from ₹1,921 to ₹1,765".
- **The primary button says what it does:** "Add ₹1,250 to Food".

---

## 4. Mockup checks

`inspect.mjs --app` was run at 1440 / 768 / 390, and `lint.mjs --app` on the folder.

| Screen | Result | Warnings and why they're acceptable |
|---|---|---|
| Home | 0 FAIL, 0 WARN | none |
| Activity | 0 FAIL, 1 WARN | `ragged-row`: a long list beside a short summary column. The column is sticky, so it stays in view while the list scrolls |
| Budget | 0 FAIL, 2 WARN | `ragged-row` (71px; same sticky column) and `hero-void`: the screen is shorter than a 1440×900 window, so the space below the last card is the end of the page |
| Add | 0 FAIL, 1 WARN | `ragged-row`: a sticky preview beside a tall form |
| Lint | 0 FAIL, 0 WARN | one intentional `box-shadow`: a 2px ring that separates overlapping avatars |

**Sample data to confirm before using these as the spec** (in [`assets/data.js`](../mockups/ui-v2/assets/data.js)):
- **Payers, sources and categories** of each October transaction. Amounts and totals match the live account; who paid and the source are samples.
- **The category plan split** (40,000 / 9,000 / 4,500 / 2,000 / 2,000 / 1,500 / 1,000). It sums to the real ₹60,000, but which category gets which amount is my reading of the plan's values.
- **The recurring bills due 5 Nov.**

---

## 5. Implementation plan (Angular)

The changes are ordered so each step ships on its own.

1. **Fix the wrong numbers** (section 1.1):
   - Compute the dashboard cards from transactions, or rebuild the stale report.
   - One scope on Settings.
   - Remove "Premium Member".
   - Skeletons instead of early empty states.
2. **Tokens and motion** (sections 1.4 and 2):
   - Port the `fintrackr.css` tokens into `theme.css`.
   - Remove the page fade-up.
   - Shorten the modal and date-picker timings.
   - Add `:active` press feedback everywhere; gate hover.
   - Replace `transition: all`.
3. **Shared pieces:**
   - A `date` pipe (one format).
   - A `source` pipe (case).
   - A `budgetTone()` util (one tone rule for text and bar).
   - The `formatMoney` util that already exists.
4. **Activity:** day groups with totals, the summary line, "Load older" wired to `TransactionsService.loadOlderTransactions()`, and the pinned side column on desktop.
5. **Budget:** the plan list with the tone rule and the plan card; card-first on phone.
6. **Home:** the pot, closest to the limit, due next and paid this month. Remove quick actions.
7. **Add:**
   - the date field;
   - Paid by;
   - the "After this" preview;
   - the action label that says what it does.
8. **Shell:** the bottom bar with an inline Add (replacing the floating +), and an icon rail at desktop widths.

**Not designed yet:** Reports, Settings, Groups, the transaction detail sheet, and dark mode. The tokens have no dark set; take it from the taste skill's dark defaults when Settings gets its theme switch.

---

## 6. Round 2: owner feedback (24 Oct 2026)

Round 1's desktop "pastel" layout was replaced by a phone-first design that stays close to today's app.
The owner's feedback, and how each point is applied:

| Screen | Feedback | Applied as |
|---|---|---|
| Dashboard | No top heading; keep the greeting, app name, bell, and settings | "Good evening, Samay" with **FinTrackr** under it; bell button (unread dot); account pill **Ghar · SJ** opens Settings |
| Dashboard | Main card: balance, In/Out, budget used, each person's share | One soft-green card: total balance, In · October (+green) and Out · October (−crimson), budget used with an even-pace tick, "Samay added ₹30,000 · Ayushi added ₹30,000" |
| Dashboard | Quick actions missing | Budget · Goals · Reports · Recurring restored as neutral icon tiles |
| Dashboard | No card around transactions | Day-grouped rows on the page ground with hairline rules; "Upcoming bills" added in the same style |
| All inner screens | Back button; no description at the top | Shared top bar: back, short title, optional action pill (e.g. Edit, New, Mark all read) |
| Transactions | No cards; colour the amounts | Rows on the ground; income `#0F7A52` with +, spending `#C0304A` with − |
| Transactions | Remove out by category; keep out by person | Out by person is a split bar in each person's tint; categories live in Budget and Reports |
| Transactions | Search + filter in one row; calendar + In/Out below | Row 1: search field + filter button. Row 2: period button "Oct 2026" + All/In/Out |
| Transactions | Count and totals as a static footer above the nav | "12 transactions · +₹60,000 · −₹44,629" pinned above the bottom bar |
| Budget | Keep it; add the edit screen; back button | Budget kept, with a top bar Edit action. **Edit budget** is the existing `budgets/new` plan editor: monthly total, allocated vs total, category limit inputs, "Split the rest evenly", sticky Save |
| Add transaction | Fields not in a card; better amount; payment icons | Fields on the page. Large centred amount with +100 / +500 / +1,000 and a live "Food will have ₹731 left" hint. **Paid with** tiles for UPI, Card, Cash and Bank, each with its icon. Date field added |
| Settings | Make the page | Profile with Edit; stats scoped to one account and labelled ("Ghar balance", "Ghar transactions"); accounts with balances; Light/Dark/System; General list; Log out |
| Everywhere | Subtle colours; don't change the screens | Pale emerald summary cards, white chips, a soft crimson for spending. The same screens and the same 5-item bottom nav as today; Add sits inside the bar |

### HTML mockups (round 2)
`mockups/ui-v2/` contains:
- `home.html`
- `transactions.html`
- `budgets.html`
- `budget-edit.html`
- `add-transaction.html`
- `settings.html`

Every screen passes `inspect.mjs --app` with 0 FAIL and 0 WARN, and `lint.mjs --app` with 0/0.

### Figma wireframes
https://www.figma.com/design/I9Y2OiKxuvC7vvDfZZFPIq (see [`mockups/figma/README.md`](../mockups/figma/README.md)).

- **Components:**
  - 51 outline icons.
  - Bottom nav, built first, in 5 variants (Active = Home / Transactions / Groups / Settings / None).
  - Top bar, with a swappable action icon.
  - Button (Primary / Secondary / Danger × Large / Medium).
  - Input, Chip, Segment option, Avatar.
  - Transaction row (Expense / Income).
  - Menu row and Section header.
- **Tokens:** 25 colour variables, 6 size variables and 12 text styles; screens bind to them.
- **Screens:** 32 frames, one per route, in six sections:
  - Auth & onboarding (Login and Create account first);
  - Core;
  - Budget & goals;
  - Categories & recurring;
  - Groups & reports;
  - Settings & system.
- **Pending:** the "Read me & Foundations" page. The call that builds it hit the Starter plan's Figma MCP limit; its script is saved in `mockups/figma/readme-page.js`.

---

## 7. Validation (ui-ux-pro-max), 24 Oct 2026

**Method:**
- **Requested changes:** checked against the Figma frames, using screenshots taken at build time. The Figma MCP Starter limit blocks new reads this month.
- **HTML mockups:** measured in a browser with `mockups/ui-v2/assets/audit.js`, covering tap targets, WCAG text contrast, minimum font size and horizontal scroll.
- **UX rules:** checked against the skill's guidelines (touch, navigation, forms, colour-only meaning, destructive actions).

**Every requested change is present in both Figma and the HTML mockups** (table in §6). Two items need a decision:
- **"Use icons for card types":** this was built as payment-method icons (UPI, Card, Cash, Bank). If it meant card networks (Visa, Mastercard, RuPay), the Card option needs a sub-picker.
- **Onboarding:** it has Back in the footer but no back arrow at the top.

**Measured results (6 HTML screens):**
- **Text contrast:** 0 failures. Every text element meets WCAG AA.
- **Horizontal scroll at 375px:** none.
- **Tap targets below 44px:** these appear on every screen, and the Figma components share them:

| Element | Size now | Fix |
|---|---|---|
| Icon buttons (Back, Bell, Filter, month arrows) | 40×40 | 44×44 |
| Medium buttons, chips, Top bar action pill | 40px tall | 44px |
| Segment options (All/In/Out, Expense/Income, Light/Dark/System) | 34–38px tall | 44px track, 40px options |
| Text links (See all, New account, Split the rest evenly, Forgot password) | 22–24px tall | Pad the hit area to 44px; the visual stays the same |

- **Smallest text:** 10–11px, on the small avatar initials and the nav labels. Labels should be at least 12px, and the small avatar should be 20px with 11px initials.

**Gaps (not regressions):**
- **Dark mode:** not designed, though Settings offers it.
- **States:** no loading, empty or error states for the lists.
- **Confirm sheet:** the shared confirm prompt behind every Danger button has no wireframe.
- **"Read me" Figma page:** still pending, blocked by the plan limit.

---

## 8. Round 3: placement pass, final draft (24 Oct 2026)

The same 32 screens and routes. **No Firestore collection or field changes**: every new control writes data the app already stores.

### 8.1 What a real user trips over (walkthrough of a normal week)
| Moment | What goes wrong today / in round 2 | Fix |
|---|---|---|
| Opens the app to check "are we OK this month?" | The budget bar has no reference point, so 74% is meaningless on day 23 | An even-pace marker on the bar, said in words: "Even pace for 23 Oct is ₹44,516 · you are ₹113 over" |
| Wants to know what needs action | The warning is buried in Budget | A "needs attention" banner on Home (icon + words) for the category closest to its limit; it opens Budget |
| Pays the rent | Has to go Recurring → find the bill → open → pay | "Mark paid" on each upcoming bill on Home. It writes an ordinary transaction |
| Switches between Personal and Ghar | The account pill went to Settings, which is already in the bottom bar | The pill opens an account switcher sheet: accounts with balances, the current one ticked, Manage, New account |
| Asks "how much did Ayushi spend?" | Out-by-person is read-only | The person chips filter the list; the footer says "Showing 8 · Oct · Ayushi"; the filter button shows a count badge |
| Asks "where did Bills go?" | Budget rows are dead ends | Each category row opens Transactions filtered to that category |
| Adds an expense | Category comes after five other fields, yet it drives the "left in budget" hint | New order: type → amount → **category** → description → method → date → paid by. "Repeat monthly" switch at the end |
| Gets invited to a shared account | Must open the invite to answer | Accept / Decline inline in Notifications |
| First run | 5 onboarding steps, no way out | 3 steps (Welcome & currency · First account · Monthly budget). Back and "Skip for now" at the top |
| Reads Settings stats | "12 transactions" — of what? | "Ghar · October / 12 transactions"; the current account is marked "Current" in text |

### 8.2 Element placement per screen (changed screens only)
- **Home:**
  - Greeting + FinTrackr on the left; on the right, the bell (unread dot, plus "2 unread" in its label) and the account switcher pill "Ghar ▾ SJ".
  - Summary card: balance → In/Out → Budget row (links to Budget, pace marker + note) → shares.
  - Needs-attention banner → quick actions → Upcoming bills (Mark paid, "+2 more · All bills") → Recent transactions.
- **Transactions:** search + filter (with count badge) in one row → period + All/In/Out → out by person (filter chips) → list → "Load older" → static footer "Showing N · period[ · person]" with In/Out totals.
- **Add transaction:** order as in 8.1. The save button repeats the amount and the repeat state ("Add ₹1,250 expense · repeats monthly").
- **Budget:** month switcher → plan card → near-limit line → category rows with chevrons; Edit in the top bar opens Edit budget.
- **Notifications:** filter segment → invites with inline actions first → today → earlier.
- **Settings:** profile → scoped stats → accounts → appearance → general → Log out.
- **Onboarding:** top row (Back · Skip) → 3-step progress → question → choices → fields → a single Continue in the footer.

### 8.3 Accessibility rules applied everywhere
- **Tap targets:** at least 44 × 44 for buttons, chips, segments, icon buttons, top-bar back/action, section-header actions and text links (padded hit area, same look).
- **Text:** minimum 12px (nav labels and small-avatar initials raised from 10–11px).
- **No colour-only meaning:** warnings carry an icon and words; unread carries a dot, a bold title and is said in the label; the current account is marked "Current"; income and expense carry "+" and "−".
- **No gesture-only actions:** every swipe action also has a visible button.
- **Sheets:** sheets are dialogs. Focus moves in on open; Esc and the backdrop close them; focus returns to the opener.
- **Toggles:** they expose state (`aria-pressed`, `role="switch"`). The filter button's label states how many filters are on.

### 8.4 Merge / split recommendations (no route or schema change)
| Screens | Recommendation | Why |
|---|---|---|
| New/Edit goal, New/Edit category, Add/Edit recurring | **Merge into one form component per pair**, with a create/edit mode. Routes stay | Same fields; one design and one validation to maintain |
| Add group expense ↔ Add transaction | **Share the Add transaction form**, plus a "Split" section | Users learn one form |
| Add recurring | **Keep the route**, but expect most people to use "Repeat monthly" in Add transaction | Recurring is usually discovered at the moment of paying |
| View recurring vs Edit recurring | **Keep separate** | Viewing history is frequent; editing is rare and needs a confirm |
| Onboarding | **Split less:** 5 steps become 3 on the same route; everything skipped is reachable from Settings | Faster first run |
| Reports ↔ Budget | **Cross-link, don't merge** ("See trends" / "Open budget") | They answer different questions |
| Groups tab on a shared account | **Show a hint with a "Switch to Personal" button** instead of an empty list | Avoids a dead end |
| Notification settings | **Keep as a Settings subpage**; add a link at the bottom of Notifications | Discoverable from where the need arises |

### 8.5 Final draft status
- **HTML mockups (`mockups/ui-v2/`):** Home, Transactions, Add transaction, Budget, Edit budget and Settings are updated.
  - **`audit.js` at 375px:** 0 contrast failures, no horizontal scroll, minimum font 12px on all 6 screens, and no tap target under 44px.
  - **Remaining audit flags:** inputs and switches inside 44–64px label rows. These are false positives, because the row is the target.
- **Figma:** the MCP is still capped by the Starter plan, so the round-3 edits ship as a development plugin in `mockups/figma/round3-plugin/`. It does three things:
  - Resizes the shared components to 44px.
  - Rebuilds Home, Transactions, Add transaction, Notifications, Budget, Settings and Onboarding, in place.
  - Builds the Read me page, with these notes.

  Run it from Figma desktop: **Plugins → Development → Import plugin from manifest…**, then **Run**. See [`mockups/figma/README.md`](../mockups/figma/README.md). The other 25 screens inherit the component fixes automatically.
- **Resolved from §7:**
  - Onboarding now has a top back button.
  - 44px targets and the 12px minimum font are in place.
  - The Read me page is in the plugin.
- **Still open:**
  - Dark mode
  - Loading, empty and error states
  - A wireframe for the confirm sheet
  - "Card types" meaning payment methods vs card networks

---

## 9. Round 4: popups, recurring and notifications (24 Oct 2026)

**Method:** I checked the running app at 375px, signed in with the owner's account in the browser pane. I opened every popup and screen, measured each one with a canvas-based audit (tap targets, WCAG contrast, font size, clickable `<div>`s) and read the matching templates. I only viewed: nothing was saved, edited or deleted.

**Constraints:** no collection schema change and still 32 screens.

### 9.1 What the live app does today

| Where | Found (measured) | Why it matters |
|---|---|---|
| Every popup (`app-modal`) | Floats 16px above the bottom, over the nav. No accessible name. Focus stays on the page behind. Close button is 24×24. 0.5s exit | Screen readers announce an unnamed dialog. Keyboard users tab behind it. The exit is slow |
| Transaction detail | Edit and Delete are 32px `<div>`s with no label or keyboard access. Edit changes only the amount, with a **$** icon on ₹ amounts. Linked transactions show a "View linked…" pill with no reason given | Most real edits (wrong category, date or payer) are impossible. The icon is wrong for the currency |
| Delete confirm | Stacks a second dialog on top of the detail (2 open). Delete is red-500 on 20% pink at **3.2:1** (fails AA). Buttons are 39px. Says "permanently" although deletes are soft | Two layers of scrim, a destructive button that's hard to read, and no undo |
| Transactions list | Rows show the entry's **created date** (every row reads "Oct 7"), not the transaction date. Filters expand inline with 3 different selected styles (green, purple, outline). "Income" is offered as a category. The filter button's label is "Clear search" in both states. Chips are 24–28px | Wrong date on every row; a cluttered list; nothing tells you a filter is on |
| Add transaction | No date field at all | Past expenses can't be back-dated |
| Recurring list | Shows no dates, no total and no state. "Active" badge on every row. Code prints the last date where it means the next one | You can't see what's coming or what's broken |
| Recurring detail | **Active schedule with Next payment "—"; last paid 6 Aug.** Sep and Oct were never recorded, and October's rent was entered by hand and isn't linked. Raw ISO dates in the history. Edit and Delete are 32px icon-only buttons in the header. Stop is a small orange button with no Resume | A broken schedule looks healthy. Destructive actions sit next to the title |
| Add / edit recurring | 24 contrast failures (field labels `gray-400` at 2.49:1), 22 targets under 44px, 27 clickable `<div>`s. "Bi-Weekly" wraps. Bright red Expense segment. Edit can't change name, category, type or source. Auto-pay is described in two different ways | — |
| Notifications | 39 contrast failures. Account tag and time at **9.6px**. Filter chips 28px. "2026-08" printed as the month. Unread shown only by a 2% tint and a dot | — |
| Notification settings | Switches have **no accessible name**. Labels don't match what they control: "Expense alerts" actually controls goal and month-end summaries; "Transaction updates" (off by default) controls **account invites**. The switches only gate *push* | Invites never reach the phone by default |
| Whole app | `--color-secondary` (slate-500) on cards measures **4.08:1** | That one token causes most of the contrast failures above |
| Routing | Reloading any inner page lands on the dashboard | Deep links and refresh are broken (raised as a separate task) |

### 9.2 Design changes (mockups in `mockups/ui-v2/`)

- **One sheet for every popup** (`assets/sheet.js`):
  - **Layout:** full width and flush to the bottom, with a grabber, a titled `aria-labelledby` and a 44px close button.
  - **Focus:** moves in on open (the safe button first for confirms), Tab is trapped, and focus returns on close. Esc and the backdrop close it.
  - **Motion:** enter 240ms, exit 200ms.
  - **One at a time:** a confirm *replaces* the sheet's content instead of stacking a second dialog. The date picker already works this way and is the model.
- **Transaction detail:**
  - **Contents:** description, date, amount, category, paid with, paid by, account.
  - **Edit** opens the full Add-transaction form in edit mode (same route, `?edit=<id>`). Every field is editable, the title is "Edit transaction", the button says "Save changes", and the Repeat switch is hidden.
  - **Delete** asks in the same sheet: "Keep it" (focused) or a solid red **Delete** (white on `#B42318`, 5.9:1). The message states the effect in numbers ("Ghar's balance goes back up by ₹29,400").
  - **Undo:** after a delete, a snackbar offers Undo. Deletes are already soft (`deletedAt`/`purgeAt`), so this needs no schema change.
  - **Linked transactions** explain themselves ("Recorded by the House rent schedule…") and link to the schedule.
- **Filters** move into a sheet:
  - Sections: category (filtered by type), paid by, paid with.
  - One selected style, a live "Show N" button and Clear all.
  - The filter button shows a count badge and says the count in its label.
  - Period has its own small sheet.
- **Recurring list:**
  - The month's commitment comes first ("−₹38,528 · 6 active · Next: Airtel Wi-Fi, 25 Oct").
  - Sections: **Needs attention** (active but no next date), **Coming up** (14 days), **Later**, **Paused**.
  - Rows show the frequency, next date and auto-pay. A status appears only when something is off ("⚠ Fix", "Paused").
- **Recurring detail:**
  - The next payment leads, with **Mark paid** (a sheet to confirm the amount, since rent changes, and the date; it writes a normal linked transaction and moves the date on) and **Skip this one** (with Undo).
  - Stalled and paused states show a note with the fix. "Set next date" replaces Skip when no date is set.
  - Details: repeats "Monthly on the 5th", category, paid with, auto-pay, last paid. Payments history uses full dates.
  - **Pause/Resume** (`isActive`) and **Delete** sit at the end, each with its own confirm.
- **Add / edit recurring are one form:**
  - Order: type, amount (with the monthly equivalent for non-monthly schedules), name, category (no Income on an expense), paid with, repeats (3+2 grid, "Every 2 weeks" in words), next payment with quick dates, auto-pay.
  - Edit can change every field and says "Changes apply from the next payment".
  - Auto-pay copy is the same everywhere: on means it's recorded automatically on the due date; off means you're reminded the day before.
- **Notifications:**
  - Grouped by Today / Yesterday / This week / Earlier.
  - Filter chips: All, **Unread · 3**, then one per account.
  - Plain icons. Unread is shown by a dot, a bold title and "Unread" in the accessible name.
  - The whole row opens the item. Actions (Accept / Decline / Mark paid) are inline and are replaced by a confirmation line once used.
  - Months are written out ("September 2026"). A "Notification settings" link sits at the end.
- **Notification settings:**
  - A note that these control the *phone*. Grouped Money / People.
  - Labels match what they control: Budget alerts (80% and over), Bills and recurring, Goals and monthly review, Shared accounts, Groups.
  - The whole row is the switch's `<label>`.
- **Thresholds aligned:** the UI warning tone now starts at **80%**, the same as the server's `BUDGET_WARNING`.

**Checks:**
- **Audit at 375px:** 15 screen states in total; 0 contrast failures, no sideways scroll, minimum font 12px.
- **Small-target flags left:** all false positives. They are switches inside 64px label rows, and notification titles whose link stretches over the whole row.
- **`inspect.mjs --app`:** 0 FAIL / 0 WARN on every new page.
- **`lint.mjs --app`:** 0 / 0.

### 9.3 For the Angular build (no schema change)
1. **Muted text colour:** set `--color-secondary` to slate-600 (≥ 4.5:1 on `--color-bg-elevated`), and replace `text-gray-400` labels with it.
2. **Modal:**
   - Rebuild `app-modal` as the sheet above: full width, `aria-labelledby`, CDK `FocusTrap` plus focus restore, a 44px close button, and a 200ms exit.
   - Give `ConfirmPrompt` a mode that swaps the host sheet's content rather than opening a second modal.
3. **Buttons:** turn every clickable `<div>` into a `<button>`, with `aria-pressed` on chips and segments and `aria-label` on icon buttons.
4. **Transaction list:**
   - Show `tx.date` (fall back to `createdAt`).
   - Move filters into a sheet.
   - Filter categories by type.
   - Add a count badge to the filter button.
5. **Edit and delete:**
   - Edit opens `transactions/add?edit=<uid>` with all fields.
   - Add a date field to Add transaction.
   - Delete gets Undo by clearing `deletedAt`.
6. **Recurring:**
   - Show `nextPaymentDate` in the list and add the sections.
   - Add a "stalled" state when `isActive && !nextPaymentDate`.
   - Mark paid writes a transaction with `linkedObject: { type: 'recurring' }` and advances `nextPaymentDate`. Skip only advances it.
   - Pause and Resume toggle `isActive`.
   - Edit exposes all fields.
7. **Notifications:**
   - Minimum text 12px.
   - 44px chips and an Unread filter.
   - Use `Intl` for month names.
   - Make Mark all read a `<button>`.
   - Settings rows become `<label for>`.
   - Relabel the five keys.
   - Consider defaulting `transactionUpdates` to on, since it carries invites. That's a default value, not a schema change.

### 9.4 Figma
The Figma MCP is still capped, so this round is `mockups/figma/round4-plugin/` (Plugins → Development → Import plugin from manifest → Run). It does the following:
- **Colours:** sets all 25 colour variables to the mockup CSS values and adds the 7 tokens the mockup uses that Figma lacked:
  - `brand/deep`
  - `brand/on-dark`
  - `text/faint`
  - `text/on-soft`
  - `status/warning-ink`
  - `surface/active`
  - `overlay/scrim`
- **Loose colours:** binds any loose colour that equals a token, and lists everything off-palette on the Read me page.
- **Text styles:** SemiBold figures and titles, Label/Small 14/20, and the selected chip in `brand/deep`.
- **Icons:** adds 5 icons (pause, play, alert, clock, phone).
- **Popups:** builds **Sheets & popups** on the Components page: transaction detail, delete confirm, filters, period, record payment, pause, delete schedule, snackbar.
- **Screens:** rebuilds Recurring, View / Add / Edit recurring, Notifications and Notification settings in place.
- **Overlays:** adds the popups to Transactions and View recurring as hidden "Overlay · … (show to review)" layers. The screen count stays 32.
- **Read me:** appends a round-4 page and a colour/type check page to the Read me.

---

## 10. Round 5: card lists, date picker, loading states (24 Oct 2026)

**Lists: cards where rows belong together, nothing else.**
- **What gets a card:** each day's transactions share one white card, and the day label and that day's total sit above it on the page background. The same treatment applies to Home's recent list, Home's upcoming bills, each recurring section, and a schedule's payment history.
- **What stays out of cards:** search, filters, segments, summaries and section headings.
- **Rows** are quieter and 64px tall. Each has a plain category icon, the description, one meta line and the coloured amount. The meta line reads like "Travel · UPI · Samay": the payer is a word, not an avatar bubble. Dividers are inset to the text.

**Date picker** (`mockups/ui-v2/assets/datepicker.js`). It's one sheet with two modes:
- **Single date** (Add transaction; future days blocked). Shortcuts: Today, Yesterday, 2 days ago.
- **Range** (Transactions → Period → Custom range). From and To are two buttons; tapping a day fills the active one. Shortcuts: Last 7 days, Last 30 days, This month.
- **The grid:**
  - Monday first, 44px days.
  - Today is a ring, never red.
  - Days outside the allowed dates are disabled but still readable (about 3:1).
  - The month title is announced when it changes.
- **The Done button names the choice:** "Done · 14 Oct" or "Show 5–19 Oct".
- **Keyboard:** arrows move a day or a week, PageUp/PageDown a month, Home/End the week, Enter picks. The grid has one roving tab stop.
- **Recurring:** the form uses the same picker for its next payment date, with past days blocked.

**Loading states** (`?state=loading | offline | empty` on the mockup pages):
- **Skeletons copy the real layout:** a day label plus a card of rows, or the summary card with bars, so nothing jumps when data arrives. They pulse gently and stay still under reduced motion.
- **Load older:** the button shows a spinner and a skeleton day appears where the rows will land.
- **Saving:** the button keeps its size, shows "Adding…", then a snackbar confirms ("Added ₹1,250 to Food · View").
- **Offline:** a banner plus the saved data, never a blank screen.
- **Empty:** a sentence and an "Add a transaction" button.

**Checks:**
- **Audit at 375px:** 0 contrast failures and no sideways scroll on 13 page states plus the open date picker. The only flags are the disabled future days, which are exempt from the contrast rule.
- **`lint.mjs`:** 0 fails and 0 warnings. The skeleton shimmer and the range-band gradients were replaced with flat fills.
- **`inspect.mjs`:** 0 fails on every page. Home and the loading page each get one warning at 1440px desktop width (Home extends below the fold; the skeletons read as empty space). That's acceptable for a 560px phone column.

**Figma:** run `mockups/figma/round5-plugin` after round 4 (see `mockups/figma/README.md`).

**For the Angular build:**
- The date picker replaces `app-date-picker`'s red "today" and its "This week" shortcut.
- Skeleton components for list, summary and row.
- A `[busy]` input on the primary button.
- An offline banner driven by the existing `OfflineCrudService` freshness.

---

## 11. Round 6: lighter pills, calmer type, dropdowns, state frames (24 Oct 2026)

**Pills.** Chips and segments are now 36px tall, medium buttons 40px, the full-width button 48px, and the account pill and period button 40–42px. An invisible `::after` layer keeps every tap target 44px tall. The audit now measures that layer, and every page passes. Segment buttons are at least 48px wide.

**Type.**
- **Smaller:** amount entry 48 → 40, balance 32 → 28, recurring total 28 → 24, detail amount 26 → 22, next-payment date 22 → 19, home title 22 → 20, top-bar title 18 → 17, flow figures 18 → 16, section headings 16 → 15, chips 14 → 13.
- **Unchanged:** body 15 and small 13.

**Dropdowns: when a popover, when a sheet.**
- A short choice next to its field opens as an anchored popover (listbox).
- A task with its own actions opens as a bottom sheet: detail, confirm, filters, date pickers.

The two dropdown patterns:
- **Paid by** (`add-transaction.html?members=3`):
  - 2 people keep the one-tap segment; 3 or more get a select that opens a list under the field (above it if there's no room).
  - Each person shows an avatar, a name and an email. The current one is ticked and focused.
  - Keys: arrows, Home/End, Enter. Esc, Tab or a tap outside closes it, and focus returns to the field.
- **Member search** (`account-new.html?q=ay`, `?state=searching`, `?state=nomatch`). This is the real pattern from onboarding, New account and Groups:
  - It's a combobox. The input keeps focus, and results open under it.
  - States: a hint under 2 letters, "Searching…", results with the typed letters underlined, "Added" for people already invited, and "No one matches … They need a FinTrackr account first."
  - Invited people appear as removable chips.

**Figma.** `mockups/figma/round6-plugin`, run after round 5:
- applies the sizes and type;
- removes the hidden review layers from the 32 route screens;
- builds **07 · States (not routes)**: 21 frames named "<Screen> — <State>" in three rows.

| Row | Frames |
|---|---|
| Popovers & sheets | Transaction detail, delete, filters, period, record payment, pause, delete schedule, switch account |
| Dropdowns & date pickers | Paid by (3 people), member search (results, searching, no match), date, custom range |
| Loading & system | Home, Transactions and Recurring loading; offline; empty period; deleted with Undo; saving |
