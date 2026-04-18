import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideMessaging, getMessaging } from '@angular/fire/messaging';
import { getApp } from 'firebase/app';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { provideIndexedDb } from 'ngx-indexed-db';
import { environment } from '../environment/environment';
import { authInterceptor } from '../core/interceptors/auth.interceptor';
import { indexedDbConfig } from '../core/offline/indexed-db.config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    // Bind to the bucket from `environment.firebase` (avoids wrong default / bucket mismatch).
    provideStorage(() => {
      const app = getApp();
      const bucket = environment.firebase.storageBucket;
      const gsUrl = bucket.startsWith('gs://') ? bucket : `gs://${bucket}`;
      return getStorage(app, gsUrl);
    }),
    provideMessaging(() => getMessaging()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideIndexedDb(indexedDbConfig),
  ],
};
