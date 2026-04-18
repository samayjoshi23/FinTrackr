import { NotifierDuration, NotifierPosition } from '../shared/components/notifier/types';

export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyCc1c8a34rzJsoYc84vuSY9E9Ko8I36Moo',
    authDomain: 'fintrackr-e7734.firebaseapp.com',
    projectId: 'fintrackr-e7734',
    storageBucket: 'fintrackr-e7734.firebasestorage.app',
    messagingSenderId: '300103064560',
    appId: '1:300103064560:web:f0112747f57677f5d99b35',
    measurementId: 'G-LRNSETP3XK',
    /** Replace with your Web Push VAPID key from Firebase Console → Project Settings → Cloud Messaging */
    vapidKey: '',
  },
  notifier: {
    durationMs: NotifierDuration.SHORT,
    position: NotifierPosition.BOTTOM_CENTER,
  },
};
