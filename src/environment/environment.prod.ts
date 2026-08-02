import { NotifierDuration, NotifierPosition } from '../shared/components/notifier/types';

export const environment = {
  production: true,
  appVersion: '1.0.0',
  firebase: {
    apiKey: 'AIzaSyCc1c8a34rzJsoYc84vuSY9E9Ko8I36Moo',
    authDomain: 'fintrackr-e7734.firebaseapp.com',
    projectId: 'fintrackr-e7734',
    storageBucket: 'fintrackr-e7734.firebasestorage.app',
    messagingSenderId: '300103064560',
    appId: '1:300103064560:web:f0112747f57677f5d99b35',
    measurementId: 'G-LRNSETP3XK',
    /** Replace with your Web Push VAPID key from Firebase Console → Project Settings → Cloud Messaging */
    vapidKey: 'BHVmj7cdCA7CTF42Hu9jlHD4R6lxuGrqogoSxQ4BZTnwHKVNk2ljvemXl5389MAONP5BU__rEFDgzeLX60bGJr4',
  },
  /**
   * reCAPTCHA v3 site key for App Check. Replace with the value from Firebase
   * Console → App Check → Register app → reCAPTCHA v3. Leave empty to skip
   * App Check (unregistered clients won't be able to reach Firestore/Storage/
   * Functions once enforcement is enabled in the console).
   */
  recaptchaSiteKey: '',
  notifier: {
    durationMs: NotifierDuration.SHORT,
    position: NotifierPosition.BOTTOM_CENTER,
  },
};
