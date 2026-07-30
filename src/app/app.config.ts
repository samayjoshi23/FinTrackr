import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  inject,
  isDevMode,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import {
  provideAppCheck,
  initializeAppCheck,
  ReCaptchaV3Provider,
} from '@angular/fire/app-check';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { provideIndexedDb } from 'ngx-indexed-db';
import { environment } from '../environment/environment';
import { authInterceptor } from '../core/interceptors/auth.interceptor';
import { indexedDbConfig } from '../core/offline/indexed-db.config';
import { IndexedDbRecoveryService } from '../core/offline/indexed-db-recovery.service';
import { StorageQuotaService } from '../core/offline/storage-quota.service';

// Note: provideStorage and provideMessaging are intentionally omitted here.
// ProfileUploadService uses firebase/storage via dynamic import (lazy).
// FcmService uses firebase/messaging via dynamic import (lazy).
// This keeps both SDKs out of the initial bundle.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Self-heal a structurally broken local IndexedDB (wrong version / missing stores)
    // BEFORE ngx-indexed-db opens it. Runs first, uses the native IndexedDB API only,
    // and reloads after deleting a broken DB so a clean one is rebuilt at the configured
    // version. See IndexedDbRecoveryService.
    provideAppInitializer(() => {
      const recovery = inject(IndexedDbRecoveryService);
      return Promise.race([
        recovery.checkAndRecover(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
    }),
    // Fire a startup storage-quota baseline. Non-blocking (`void`) — we don't
    // hold up bootstrap for the estimate. If usage is already near quota this
    // surfaces a warning banner before the user makes any writes.
    provideAppInitializer(() => {
      void inject(StorageQuotaService).check();
    }),
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // App Check must be initialized IMMEDIATELY after the Firebase app and
    // BEFORE Auth / Firestore / Functions — every downstream SDK attaches the
    // App Check token to its requests only when this provider has already
    // installed the token refresher. Registering it later is a silent no-op.
    //
    // Registration is only wired when a reCAPTCHA v3 site key is present so
    // local dev without a key still works. Deploy the key to
    // environment.prod.ts before flipping enforcement in the Firebase console.
    ...(environment.recaptchaSiteKey
      ? [
          provideAppCheck(() =>
            initializeAppCheck(undefined, {
              provider: new ReCaptchaV3Provider(environment.recaptchaSiteKey),
              isTokenAutoRefreshEnabled: true,
            }),
          ),
        ]
      : []),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideFunctions(() => getFunctions()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
    provideIndexedDb(indexedDbConfig),
  ],
};
