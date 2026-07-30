# PWA Offline "This site can't be reached" — Diagnosis & Fix Planner

> Symptom: Launching the installed PWA (or reloading in the browser) while **offline**
> shows the browser's native **"This site can't be reached"** error page instead of the app shell.

---

## 1. What the error actually means

"This site can't be reached" is the **browser's** network error (e.g. `ERR_INTERNET_DISCONNECTED`).
It appears **only when nothing intercepts the navigation request**.

If the Angular service worker (`ngsw-worker.js`) were controlling the page, an offline navigation
to `/` would be served the cached `index.html` app shell — you'd see the app (or your boot loader),
**not** the browser error.

➡️ **Conclusion: when you go offline, `ngsw-worker.js` is NOT controlling the page.**
The config is fine — the problem is *registration / control*, not caching rules.

Evidence the config is correct (verified in this repo):
- [manifest.webmanifest](public/manifest.webmanifest): `start_url: "/"`, `scope: "/"` ✅
- [ngsw-config.json](ngsw-config.json): `index.html`, `*.js`, `*.css` prefetched ✅
- `dist/fintrackr/browser/ngsw.json`: `navigationUrls` positive `^\/.*$` → `/` falls back to `index.html` ✅
- [firebase.json](firebase.json): rewrites `**` → `/index.html` ✅

So one of the causes below is preventing the SW from being in control when you go offline.

---

## 2. Ranked probable causes

### 🥇 Cause A — Testing a **development build** (most common)
[src/app/app.config.ts](src/app/app.config.ts):
```ts
provideServiceWorker('ngsw-worker.js', {
  enabled: !isDevMode(),                      // ← disabled in dev
  registrationStrategy: 'registerWhenStable:30000',
}),
```
- The SW is **only enabled in production builds**. `ng serve` / development build → **no service worker at all** → zero offline support.
- If you installed the PWA from `ng serve` or a `--configuration development` build, offline will **always** fail.

**Check:** DevTools → Application → Service Workers. If there is no `ngsw-worker.js` activated, this is it.

---

### 🥈 Cause B — SW hadn't finished caching before you went offline
```ts
registrationStrategy: 'registerWhenStable:30000'
```
- Angular waits for the app to become **stable** (no pending tasks) before registering, up to a 30s timeout.
- This app keeps Zone.js **perpetually unstable** (Firestore `onSnapshot` real-time listeners, ngx-indexed-db,
  the startup loader + background sync, any `setInterval`/polling). So registration is **delayed to the full 30s**.
- The prefetch payload is **large** (multiple chunks incl. ~536 KB, ~331 KB, ~128 KB …). On first visit the SW
  must download **all** `assetGroups.app` files before it can serve them offline.
- If you go offline (or close the app) **before** registration + prefetch completes, there's no cache → browser error.
- A service worker also only **takes control on the *next* navigation** after it activates (unless it claims clients).
  First-ever visit → go offline immediately → not yet controlled → fails.

---

### 🥉 Cause C — Two service workers competing (FCM + Angular)
There are **two** service workers in play:
1. `ngsw-worker.js` — Angular SW (offline shell + caching). Registered in [app.config.ts](src/app/app.config.ts).
2. `firebase-messaging-sw.js` — FCM background push. Registered implicitly by `getToken()` in
   [src/features/notifications/fcm.service.ts](src/features/notifications/fcm.service.ts:33).

Facts:
- `firebase-messaging-sw.js` has **no `fetch` handler and caches nothing** — it cannot serve the app offline.
- [firebase.json](firebase.json) sets `Service-Worker-Allowed: /` on `firebase-messaging-sw.js`, signalling an
  intent to give it **root scope `/`**.
- `getToken(messaging, { vapidKey })` is called **without** a `serviceWorkerRegistration`, so the Firebase SDK
  auto-registers its own SW. **If it ends up controlling scope `/`, it evicts `ngsw-worker.js` from control** →
  the controlling SW then has no offline fallback → "site can't be reached".

> Note: modern Firebase SDK defaults to sub-scope `/firebase-cloud-messaging-push-scope`, which normally does
> *not* clobber `/`. But the `Service-Worker-Allowed: /` header + any prior/manual root registration can cause a
> genuine conflict. Treat this as a real risk to eliminate, especially if Cause A/B are ruled out.

---

### Cause D — Non-secure origin / stale registration
- Service workers require **HTTPS** (or `localhost`). Testing over `http://<LAN-IP>` → no SW.
- A previously installed SW (from an older build, different scope, or a manual `register('firebase-messaging-sw.js')`)
  can be **stuck controlling** the page. Old/foreign registrations must be cleared.

---

## 3. How to diagnose (do this first, in order)

Open the deployed **production** site in Chrome DevTools:

1. **Application → Service Workers**
   - Is `ngsw-worker.js` listed and **"activated and is running"**?
   - Is `firebase-messaging-sw.js` ALSO present? Note its **scope**.
   - Which one shows as the controller? (Console: `navigator.serviceWorker.controller?.scriptURL`)
2. **Application → Cache Storage**
   - Are there `ngsw:*` caches populated with `index.html`, `*.js`, `*.css`?
3. **Simulate offline the right way**
   - DevTools → Network → **Offline**, then **reload**. (More reliable than toggling OS wifi.)
   - Also test the installed PWA: launch it with wifi off.
4. **Confirm build type**
   - Was the installed/deployed bundle built with `ng build` (production) — not `ng serve`?

---

## 4. Fix plan

### Fix 1 — Always test/deploy a production build ✅ (validate Cause A)
```bash
ng build                       # defaultConfiguration = production (see angular.json)
npx firebase deploy --only hosting
# or serve the prod bundle locally to test offline:
npx http-server dist/fintrackr/browser -p 8080   # then open http://localhost:8080
```
> `localhost` is a secure context, so the SW registers even without HTTPS. Never validate offline from `ng serve`.

### Fix 2 — Register the SW immediately (mitigate Cause B)
Change the strategy so registration doesn't wait for an app that never stabilizes:
```ts
// src/app/app.config.ts
provideServiceWorker('ngsw-worker.js', {
  enabled: !isDevMode(),
  registrationStrategy: 'registerImmediately',   // was 'registerWhenStable:30000'
}),
```
- `registerImmediately` starts SW install/prefetch right away instead of after 30s.
- Educate the flow: the **first** online visit must stay open long enough to finish prefetching all chunks
  before offline works. Consider trimming the prefetch set or moving big rarely-needed chunks to
  `installMode: "lazy"` in [ngsw-config.json](ngsw-config.json) so the critical shell caches faster.

### Fix 3 — Stop FCM from clobbering the Angular SW scope (fix Cause C)
Give Firebase Messaging its **own** registration so it never competes for `/`. In
[fcm.service.ts](src/features/notifications/fcm.service.ts):
```ts
const { getMessaging, getToken, onMessage } = await import('firebase/messaging');
const messaging = getMessaging();

// Register FCM SW on a dedicated, non-root scope and hand it to getToken explicitly.
let swReg: ServiceWorkerRegistration | undefined;
if ('serviceWorker' in navigator) {
  swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/firebase-cloud-messaging-push-scope',
  });
}

const token = await getToken(messaging, {
  vapidKey: environment.firebase.vapidKey,
  serviceWorkerRegistration: swReg,     // ← keeps FCM off the '/' scope owned by ngsw
});
```
And **remove the root-scope grant** so FCM can't legally take over `/` in [firebase.json](firebase.json):
```jsonc
// DELETE this header block (or leave it only if you truly need FCM at root):
{
  "source": "/firebase-messaging-sw.js",
  "headers": [{ "key": "Service-Worker-Allowed", "value": "/" }]
}
```
> Result: `ngsw-worker.js` owns `/` (offline shell), `firebase-messaging-sw.js` owns the push sub-scope. No conflict.

### Fix 4 — Clear stale/foreign service workers during testing (Cause D)
When re-testing after changes:
- DevTools → Application → Service Workers → **Unregister** all.
- Application → Storage → **Clear site data**.
- Hard reload (twice) online to let the corrected `ngsw-worker.js` install and take control, then go offline.

---

## 5. Verification checklist

- [ ] Built with `ng build` (production) — SW file `ngsw-worker.js` present in `dist/fintrackr/browser`.
- [ ] DevTools shows `ngsw-worker.js` **activated** and is the **controller** of `/`.
- [ ] Cache Storage `ngsw:*` contains `index.html`, all `*.js`, `*.css`.
- [ ] `firebase-messaging-sw.js` (if present) is on scope `/firebase-cloud-messaging-push-scope`, **not** `/`.
- [ ] Network → Offline → **reload** ⇒ app shell renders (no browser error).
- [ ] Installed PWA launched with wifi off ⇒ app shell renders.
- [ ] Lighthouse → PWA audit: "Current page responds with a 200 when offline" passes.

---

## 6. Root-cause summary (one-liner)

The PWA config is correct, but offline fails because **`ngsw-worker.js` isn't controlling the page when you go offline** —
most likely because you tested a **dev build (SW disabled)** or went offline **before the delayed
`registerWhenStable:30000` prefetch finished**, with a **secondary risk** that the FCM service worker
(`firebase-messaging-sw.js`, which caches nothing) contends for the root scope. Fixes: test the production build,
switch to `registerImmediately`, and pin FCM to its own sub-scope.
