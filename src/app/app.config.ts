import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { provideIndexedDb } from 'ngx-indexed-db';
import { environment } from '../environment/environment';
import { authInterceptor } from '../core/interceptors/auth.interceptor';
import { indexedDbConfig } from '../core/offline/indexed-db.config';

// Note: provideStorage and provideMessaging are intentionally omitted here.
// ProfileUploadService uses firebase/storage via dynamic import (lazy).
// FcmService uses firebase/messaging via dynamic import (lazy).
// This keeps both SDKs out of the initial bundle.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideIndexedDb(indexedDbConfig),
  ],
};
