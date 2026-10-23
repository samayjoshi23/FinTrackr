# Security & Free-Tier Hardening Plan

_Written 2026-10-23 from a full audit of `src/`, `functions/src/` and `firestore.rules`._

**Goal:** close every known security hole while keeping FinTrackr inside Firebase's no-cost quotas for as long as possible.

---

## 0. Ground rules for "free"

**You are already on the Blaze plan.** Deploying Cloud Functions requires Blaze, and this project deploys 15+ functions. Blaze keeps the same no-cost quotas as Spark and only bills for usage above them. "Free" therefore means two things:

- usage stays under the quotas below;
- there are **hard guards** so a bug or an abuser can't run up a bill.

| Service | No-cost quota (Blaze) | Resets |
|---|---|---|
| Firestore reads / writes / deletes | 50,000 / 20,000 / 20,000 | daily (midnight Pacific) |
| Firestore storage / egress | 1 GiB / 10 GiB per month | — |
| Cloud Functions invocations | 2,000,000 | monthly |
| Cloud Functions compute | 400,000 GB-s, 200,000 CPU-s, 5 GB egress | monthly |
| Cloud Scheduler | 3 jobs per **billing account** (shared across all your projects) | — |
| reCAPTCHA (App Check) | 10,000 assessments | monthly |
| Hosting | 10 GB storage, ~360 MB/day transfer | daily |
| FCM, Auth (email/Google, < 50k MAU) | free | — |

Two rules follow from this table:

1. **Firestore reads are the scarce resource.** At 50k reads a day, read cost decides how long you stay free.
2. **Never scan a whole collection.** Every query should be bounded by time, a cursor, or `limit()`.

### Hard guards (do these first; about 30 min, no code)

1. **Budget alert at $1** in Firebase console → Usage & billing.
   - Alerts **do not cap** spend; they only email you.
2. **Spend cap for Cloud Functions** (Usage & billing → Spend caps).
   - This *pauses* Functions for the rest of the month if their spend reaches your budget.
   - It is the only built-in hard stop. Use it.
3. **`maxInstances` on every function.**
   - Add `setGlobalOptions({ region: 'us-central1', maxInstances: 5 })` at the top of `functions/src/index.ts`.
   - Today nothing is capped, so a loop or abuse script can scale out without limit.
4. **Artifact Registry cleanup policy.**
   - Run `firebase functions:artifacts:setpolicy`.
   - Every deploy leaves container images behind. They quietly exceed the 0.5 GB free storage and cost cents per month forever.
5. **Optional nuclear option:** a budget → Pub/Sub → function that detaches billing at $X.
   - Notifications arrive about every 20 min and lag actual usage, so this is not instant.
   - It takes down *all* paid services, so treat it as a last resort.

---

## 1. Security fixes

### S1. Settlement / transaction replay inflates balances — HIGH
**Problem.** `recordGroupSettlement` and `recordTransactionForUser` create the transaction with `.add()`, which gives it a random id. They then apply `FieldValue.increment` as a separate write. Calling either one twice with the same `settlementId` / `recordId` adds the money twice. A crash between the two writes leaves the transaction and the balance out of sync.

**Design: deterministic id + one Firestore transaction.**
```ts
const txId = `${linked.type}_${linked.recordId}_${targetUid}`;   // deterministic
await db.runTransaction(async (t) => {
  const txRef = db.doc(`transactions/${txId}`);
  if ((await t.get(txRef)).exists) return;          // replay → no-op
  t.create(txRef, txDoc);
  t.update(accountRef, { balance: FieldValue.increment(signed) });
});
```
- **Cost:** +1 read per call, which is negligible.
- **Client side:** the client can safely retry these callables, because a retry is now a no-op.

### S2. Client-chosen `accountId` in `recordTransactionForUser` — HIGH
**Problem.** `data.accountId` is trusted, so a group member can post money into any account whose id they know.

**Design.** Ignore the client value and resolve the account on the server:
- if `accounts/{targetUid}` exists, use it (the legacy personal account);
- otherwise use the target's chosen default account, stored as `users/{uid}.defaultAccountId`;
- in either case assert `ownerId == targetUid || activeMemberIds` contains `targetUid`.

**Cost:** +1 read.

### S3. `notifyGroupExpense` can push arbitrary text to a group — HIGH
**Problem.** `description`, `paidByName` and `amount` come from the caller and go straight into push notifications. That allows phishing and spam, and a non-numeric `amount` crashes `Intl`.

**Design: delete the callable and use a Firestore trigger instead.**
```ts
export const onGroupExpenseCreated = onDocumentCreated(
  'groups/{groupId}/expenses/{expenseId}', async (event) => { /* build text from event.data */ });
```
- The trigger reads only data that rules already validated (rules enforce `createdBy == auth.uid`), so the text can't be spoofed.
- It can't be replayed, because it fires once per document.
- **Cost:** the same single invocation per expense, minus a client round trip.
- Triggers run at least once, so they can occasionally fire twice. Set `notifiedAt` on the expense inside a transaction and skip if it is already set.

### S4. Clients write `balance` and `monthlyReports` directly — HIGH
**Problem.**
- Rules let any active member set `accounts/{id}.balance` to any number.
- `transactions`, `recurring-transactions`, `monthlyReports` and `goals` accept any field values.
- One malicious or buggy client can corrupt shared account data.

**Design: make derived data server-owned, and update it incrementally.**

1. **Rules.**
   - Clients may **not** write `balance` at all.
   - Clients may **not** write `monthlyReports` at all.
2. **New trigger `onTransactionWritten`** on `transactions/{id}`:
   - compute `delta = signed(after) - signed(before)`;
   - in one `runTransaction`: apply `increment(delta)` to `accounts/{id}.balance` and to `monthlyReports/{account_month}.totalIncome / totalExpense / categoryBreakdown.{cat}.amount`;
   - write a marker `processedEvents/{event.id}` with a TTL so duplicate deliveries are skipped.
3. **Retire `recomputeMonthlyReportForAccount`.** Its full-month scan becomes a delta update with no transaction reads.
4. **Offline UX stays the same.**
   - The client still shows an optimistic balance computed from its IndexedDB cache.
   - The server value replaces it when the write syncs.
5. **Add field validation to the rules** (rule evaluation is free unless it calls `get()`):
```
function validTx(d) {
  return d.amount is number && d.amount > 0 && d.amount < 1e9
    && d.type in ['income', 'expense']
    && d.date is timestamp
    && d.description is string && d.description.size() <= 200
    && d.category is string && d.category.size() <= 60;
}
```

**Cost per transaction write:** 1 invocation, about 3 reads (account, report, marker) and 3 writes. At 1,000 transactions a day that is about 3k reads and 3k writes, well inside quota. The client also no longer writes reports, so total writes go down.

### S5. `/user-directory` can be dumped by any signed-in user — MEDIUM
**Problem.** `allow read` includes `list`. Anyone can download every uid, name, photo and **unsalted** SHA-256 email hash, and those hashes reverse easily against email lists.

**Design.** Two steps:

1. **Now (free, 5 min).** Allow `get` (used by `account-details.ts` to fetch owner names) and limit `list` to single-result lookups:
```
match /user-directory/{userId} {
  allow get: if isSignedIn();
  allow list: if isSignedIn() && request.query.limit <= 1;
  allow write: if false;
}
```
   `users-lookup.service.ts` already queries `where('emailHash','==',h), limit(1)`, so no client change is needed.

2. **Later (optional).** Move the email lookup into a callable `findUserByEmail` that:
   - hashes with a server-only **HMAC secret** (Secret Manager; a few secrets fall within its free allowance);
   - returns `{ uid, displayName, photoURL }`;
   - lets you set `allow list: if false`.

   **Cost:** 1 invocation per lookup. Only call it on submit or a valid-email blur, not on every keystroke.

### S6. Email-existence oracles — MEDIUM
**Problem.**
- `sendGroupInvite` throws `No user found with email "…"`.
- Reset-password shows "No account found with that email address".

Both tell anyone which emails are registered.

**Design.**
- **Reset password.** Always show: "If an account exists for that email, a reset link is on its way." Also make sure **Email enumeration protection** is ON in Authentication → Settings. With it on, Firebase stops returning `user-not-found` anyway.
- **Group and account invites.** Always return "Invite sent". If the email isn't registered yet:
  - store `pendingInvites/{emailHmac}` with a TTL;
  - the existing `onUserProfileWrite` trigger resolves it when that person signs up.

  This is better UX too, because you can invite friends before they join. **Cost:** essentially zero.

### S7. App Check is off — MEDIUM
**Problem.** `recaptchaSiteKey` is `''`, so App Check never initializes. Scripts using your public web config can call every callable and hit Firestore directly.

**Design, rolled out in three steps:**
1. **Provider.** Use `ReCaptchaEnterpriseProvider`.
   - Firebase now recommends Enterprise over v3 for new integrations.
   - Put the site key in `environment*.ts`.
2. **Token TTL.** In the App Check console, raise the token TTL from 1 h to the maximum (7 days).
   - Assessments happen at token refresh, roughly twice per TTL per device.
   - At 1 h, one always-open device uses about 1,440 assessments a month, so 10k covers only about 7 heavy users.
   - At 7 days the cost drops to a handful per device per month, so 10k covers thousands of users.
3. **Monitor first, then enforce.**
   - Ship the change and watch the App Check metrics for 1–2 weeks. Old PWA clients that are still cached won't send tokens yet.
   - Then enforce for Firestore and Storage in the console.
   - In functions, add `enforceAppCheck: true` to the callables (put it in `setGlobalOptions`, or in each `onCall` options object).
4. **Local dev.** Register a debug token for localhost.

### S8. No input validation on callable free-text fields — MEDIUM
**Design.** Add one helper file, `functions/src/validate.ts`, with three helpers:
- `str(v, field, max)`
- `oneOf(v, field, values)`
- `money(v)`, built on the existing `requireFiniteAmount`

Call them at the top of every `onCall`. Reject with `invalid-argument`. No dependency (zod adds cold-start time).

### S9. Pending invitees can read account and group data — LOW
**Problem.** Read rules check `memberIds`, which includes invited users who haven't accepted yet.

**Design.**
- Read rules for `accounts`, `groups` and their subcollections should check `activeMemberIds`.
- Invitees see only what the invite notification contains: account or group name, and inviter.
- The accounts listener query must switch to `activeMemberIds array-contains uid`. Rules reject queries that could return docs the user can't read.

### S10. `onAccountUpdated` runs on every balance change — LOW (cost)
**Problem.** The trigger exists only to notify newly invited members, but it fires on every account update, including each balance increment. After S4 that becomes every transaction.

**Design.**
- Send the invite notification from inside the `addAccountMember` callable, which already exists and is owner-checked.
- Delete the `onAccountUpdated` trigger.

**Saves:** 1 invocation and 1 read per transaction.

### S11. Already fixed in this cleanup
- The production VAPID key had an extra leading `B`, so push notifications were silently off in production.
- The `onMessage` handler stacked after every login.
- `settings-home` leaked a `matchMedia` listener.
- `Modal` leaked its overlay.

---

## 2. Free-tier cost fixes

### C1. Transactions listener re-reads the entire history on every app open — HIGH (biggest cost)
**Problem.**
- `transactions.service.ts` listens to `where('accountId','==',X)` with no bound.
- Firestore bills every matching doc when a listener attaches. Its resume token only saves reads if you reconnect within about 30 minutes.
- Example: an account with 2,000 transactions costs **2,000 reads per app open**. **25 opens a day across all users uses up the whole 50k daily quota.**
- `getTransactionsPage` also fetches everything before paging locally.
- `settings-home` loads every transaction just to count them.

**Design: delta sync. Your custom IndexedDB cache makes this natural.**
1. Every write already sets `updatedAt: serverTimestamp()`.
2. **Soft deletes.**
   - Set `deletedAt` instead of `deleteDoc`, so deletions show up in a delta query.
   - Purge them later with a Firestore **TTL policy** on `purgeAt`. TTL deletes count against the free 20k/day.
3. **On app open:**
   - `where('accountId','==',X).where('updatedAt','>',lastSyncedAt).orderBy('updatedAt')`;
   - merge the results into IndexedDB;
   - save the new `lastSyncedAt`.
4. **Live updates for shared accounts:** attach the listener to the same query, bounded by `updatedAt > sessionStart`. Only docs that change during the session are billed.
5. **History pages:** read IndexedDB first. Fall back to `orderBy('date','desc').startAfter(cursor).limit(50)` only for months that were never synced.
6. **Counts:** use `getCountFromServer()` (about 1 read per 1,000 docs). Better still, keep `txCount` on the account doc via the S4 trigger.
7. **Indexes:** add composite indexes `accountId ASC, updatedAt ASC` and `accountId ASC, date DESC`. Indexes are free.

**Effect:** a typical open goes from O(all transactions) to **about 1 read per query when nothing changed**. A query always costs at least 1 read, even with 0 results.

Apply the same pattern to:
- **budgets, categories and accounts listeners:** smaller, but the same leak;
- **group expenses and settlements:** see C3;
- **notifications:** its listener already uses `limit(20)`. Make that `limit(10)` plus "load more", and add a TTL that deletes notifications after 60 days.

### C2. Daily cron scans every user and every account — HIGH
**Problem.** `scheduledDailyNotifications` reads:
- all `users`;
- all `accounts`;
- every budget;
- an **unbounded** transactions query per budget;
- every goal.

Reads grow with *total data*, not with *work to do*. With a few hundred active users this alone can pass 50k reads a day. It also processes accounts one at a time and will hit the 540 s timeout.

**Design: make it event-driven, and have the cron only pick up work that is due.**

| Notification | New source | Reads/day |
|---|---|---|
| Budget warning / exceeded | The S4 `onTransactionWritten` trigger already updates the category total. When it crosses 80% or 100%, write the notification and set `alertsSent.{cat}.{80/100}` on the report so it fires once. | 0 extra |
| Goal achieved | Trigger on goal update when `current >= target` (`achievedNotifiedAt` guard). | 0 extra |
| Recurring due / autopay | Cron runs a `collectionGroup('recurring-transactions').where('nextDueDate','<=',today).limit(200)` page loop. After each item it advances `nextDueDate` (`advanceRecurringDate` already exists). | ≈ items due today |
| Month-end summary | Cron on the last day runs `monthlyReports.where('month','==',thisMonth)`, paged. Reports are already up to date (S4), so there is no recompute. | ≈ active accounts, once a month |

- Process in pages of 100 with `Promise.allSettled` over batches of 10.
- Keep it as **one** scheduler job, within the 3 free per billing account.
- Remember that other projects on the same billing account share those 3 jobs.

### C3. Group expenses and settlements are streamed in full — MEDIUM
**Problem.**
- Each open group listens to its entire `expenses` and `settlements` subcollections.
- Balances are recomputed on the client from all of them.

**Design.**
1. A trigger on `groups/{g}/expenses/{e}` and `groups/{g}/settlements/{s}` keeps `groups/{g}.balances` (a map of `memberId → net`) up to date incrementally, with the same delta and idempotency approach as S4.
2. The group list and detail headers read **one doc** instead of N.
3. The expense list uses `orderBy('createdAt','desc').limit(30)` plus "load more", or the delta sync from C1.
4. The S3 notification trigger can share this same expense trigger, so it is one function rather than two.

### C4. Smaller cost items — LOW
- **`onNotificationCreate`:**
  - add `.limit(10)` to the devices read;
  - prune tokens older than 60 days (FCM recommends refreshing them about monthly).
- **`deleteUserAccount` / `deleteAccountCascade`:** they already batch, but the groups, expenses and settlements reads are unbounded `.get()`. Switch to `limit(400)` loops. These run rarely, so this mostly avoids timeouts.
- **Profile pictures (Storage):**
  - on the client, resize to 256 px WebP before upload (about 20–40 KB instead of up to 2 MB);
  - set `cacheControl: 'public, max-age=604800'` in the upload metadata;
  - lower the rule cap from 2 MB to 200 KB.
- **Hosting transfer (~360 MB/day free):**
  - the initial bundle is 982 kB, already over your own 900 kB budget, so roughly 360 first-time visits a day uses the quota;
  - returning users are served by the service worker;
  - trimming the initial bundle directly stretches this quota.
- **`cron-markers` and `processedEvents`:** add Firestore TTL policies so they don't pile up.

### C5. Rough capacity after the changes
These are estimates assuming 3 opens per user per day.

| | Today | After C1–C3 |
|---|---|---|
| Reads per app open (user with 2k transactions) | ~2,000+ | ~10–30 |
| Daily cron reads (300 users) | 10k–50k+ (grows with history) | a few hundred |
| Daily active users before hitting 50k reads | ~10–20 heavy users | ~1,000+ |

---

## 3. Code-quality fixes (no cost impact)

| # | Problem | Design |
|---|---|---|
| Q1 | Group expenses and settlements services duplicate their listener, ref-counting and cache code | Generic `GroupSubcollectionStore<T>(path, mapper)` that both extend |
| Q2 | `selectedAccountKey` / `requireSelectedAccountKey` / `requireUid` copied into 4–7 services | One `AccountContextService` in `core/` that exposes them |
| Q3 | Onboarding and create-account wizards duplicate about 10 methods | Shared step components in `features/accounts/components/`: currency picker, account type, budget step, member invite |
| Q4 | Add-transaction and add-recurring duplicate form logic | One `TransactionFormComponent`, with recurring adding a schedule section |
| Q5 | `reports.service.ts` (1,482 lines), `accounts.service.ts` (894) | Most of the reports logic moves server-side with S4. Split the rest into `report-builder`, `report-cache` and `chart-mappers`; and `accounts-crud`, `account-membership` and `account-realtime` |
| Q6 | 54 `as unknown as` casts, mostly in offline-crud and sync | Discriminated union `SyncQueueEntry` keyed by `storeName`, plus Firestore `withConverter()` mappers |
| Q7 | `normalizeMembers` ×3 in functions; `memberStatusOf` and `stableNameHash` duplicated between client and functions | `functions/src/shared/members.ts`. Client/server duplicates go away when reports move server-side (S4) |
| Q8 | Template methods called with arguments: `isNameDuplicate`, `isIconUnavailable`, `getPaidByName`, `sourceLabel`, … | `computed()` lookup `Set`/`Map`s, or pure pipes |
| Q9 | Groups hardcode `currency: 'INR'`; groups-list sums balances across groups | Create groups in the creator's account currency; show totals per currency |
| Q10 | `group-detail` copies service signals into local signals via `effect()` | `computed()` / `linkedSignal()` |
| Q11 | `app.spec.ts` is the CLI scaffold and fails (no providers) | Provide mocks for Auth and Firestore, or delete it |
| Q12 | 16 components still import all of `CommonModule` for one pipe or `ngTemplateOutlet` | Import `DatePipe`, `CurrencyPipe`, `NgTemplateOutlet` individually |
| Q13 | `icon-sprite.service.ts` sets `innerHTML` | Parse with `DOMParser('image/svg+xml')` |

---

## 4. Suggested order

1. **Hard guards (§0):** budget alert, Functions spend cap, `maxInstances`, artifact policy.
2. **S5 rules fix and S6 messages:** minutes each, free.
3. **S1, S2, S8:** callable idempotency and validation. All in one file: `group-transactions.ts`.
4. **C1:** delta sync for transactions. This is the biggest read saving, so do it before user count grows.
5. **S4 and C3:** server-owned balances, reports and group balances. This also covers S3, S10 and most of C2.
6. **C2:** cron rewrite. Mostly deletions once step 5 lands.
7. **S7:** App Check, monitor first, then enforce.
8. **S9, C4, Q-items:** opportunistically.

**Before each deploy:**
- run `firebase emulators:start` and test rules with `@firebase/rules-unit-testing`;
- check the Firestore **Usage** tab the next day to confirm reads went down.
