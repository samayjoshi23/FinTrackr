// Firebase Cloud Messaging service worker.
// Handles background push notifications when the app is not in the foreground.
// This file must stay at the root of the served origin (public/).
// The Firebase config below must match src/environment/environment.ts.

importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCc1c8a34rzJsoYc84vuSY9E9Ko8I36Moo',
  authDomain: 'fintrackr-e7734.firebaseapp.com',
  projectId: 'fintrackr-e7734',
  storageBucket: 'fintrackr-e7734.firebasestorage.app',
  messagingSenderId: '300103064560',
  appId: '1:300103064560:web:f0112747f57677f5d99b35',
});

const messaging = firebase.messaging();

// Customize background notification display.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'FinTrackr';
  const body = payload.notification?.body ?? '';
  const deepLink = payload.data?.deepLink ?? '/user/notifications';

  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    data: { url: deepLink },
    actions: payload.data?.actions
      ? JSON.parse(payload.data.actions).map((a) => ({ action: a, title: a }))
      : [],
  });
});

// Open the app (or focus existing tab) when a notification is clicked.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/user/notifications';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      }),
  );
});
