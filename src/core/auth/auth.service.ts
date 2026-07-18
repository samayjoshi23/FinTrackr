import {
  DestroyRef,
  Injectable,
  Injector,
  computed,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  GoogleAuthProvider,
  User,
  UserProfile,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  user,
} from '@angular/fire/auth';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SyncService } from '../offline/sync.service';
import { FcmService } from '../../features/notifications/fcm.service';
import { NotificationService } from '../../features/notifications/notification.service';
import { UsersLookupService } from '../../services/users-lookup.service';
import { NotificationPreferencesService } from '../../features/notifications/notification-preferences.service';
import { date } from '../date';

/**
 * Non-sensitive-preferences keys we clear on logout. Any localStorage key
 * added later that persists per-user state should be added here so the next
 * signed-in user starts clean.
 */
/**
 * Keys that `patchCachedUserProfile` is allowed to merge into the localStorage
 * cache. Any other key on the incoming partial is ignored — a prototype-safe
 * alternative to `Object.assign`.
 */
const ALLOWED_PROFILE_PATCH_KEYS: readonly string[] = [
  'isOnboarded',
  'displayName',
  'photoURL',
  'email',
  'updatedAt',
];

const LOGOUT_LOCAL_STORAGE_KEYS = [
  'userProfile',
  'userId',
  'accessToken',
  'refreshToken',
  'fintrackr-device-id',
  'fintrackr-last-login-label',
  'fintrackr-privacy-prefs',
  'fintrackr-notification-inbox-v1',
  'fintrackr-notification-prefs',
  'fintrackr-idb-recovery-guard',
];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly router = inject(Router);
  private readonly googleProvider = new GoogleAuthProvider();
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly syncService = inject(SyncService);
  private readonly fcmService = inject(FcmService);
  private readonly notificationService = inject(NotificationService);
  private readonly usersLookup = inject(UsersLookupService);
  private readonly notificationPrefs = inject(NotificationPreferencesService);

  readonly user$ = user(this.auth);
  userProfile = signal<UserProfile | null>(null);

  /** Signed-in uid: signal first, Firebase Auth as fallback (never localStorage). */
  readonly currentUid = computed(
    () => (this.userProfile()?.['uid'] as string | undefined) ?? this.auth.currentUser?.uid ?? null,
  );

  constructor() {
    this.googleProvider.setCustomParameters({ prompt: 'select_account' });

    // Global auth-state-driven notification lifecycle.
    // Runs immediately on startup (restoring an existing session) AND on every
    // sign-in / sign-out — so no page refresh is needed to get realtime updates.
    this.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((u) => {
      if (u) {
        // Re-hydrate the cached profile from Firestore on every authenticated emission
        // (login AND session restore). Recovers gracefully if localStorage was cleared.
        void this.ensureUserProfileCached(u.uid);
        void this.notificationService.init(u.uid);
        void this.notificationPrefs.init(u.uid);
        void this.fcmService.initForUser(u.uid);
      } else {
        void this.notificationService.clearAll();
      }
    });
  }

  async signupWithEmail(fullName: string, email: string, password: string) {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    const normalizedFullName = fullName.trim();

    if (normalizedFullName) {
      await updateProfile(credential.user, { displayName: normalizedFullName });
    }

    await this.upsertUserProfile({
      uid: credential.user.uid,
      email: credential.user.email ?? email,
      displayName: credential.user.displayName ?? normalizedFullName,
      photoURL: credential.user.photoURL ?? null,
      provider: 'password',
    });

    // Kick off the email-verification flow for password-provider signups.
    // Best-effort — a failure here (e.g. rate-limited, offline) doesn't block
    // signup itself; the /verify-email screen has a resend button.
    await sendEmailVerification(credential.user).catch(() => {
      /* non-fatal — user can resend from the verify screen */
    });

    this.setUserProfile();
    return credential.user;
  }

  /** Resend the verification email for the current password-provider user. */
  async resendVerificationEmail(): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) throw new Error('Not signed in.');
    await sendEmailVerification(u);
  }

  /**
   * Refresh the token / user record so `emailVerified` reflects a click on the
   * verification link (Firebase only updates it after a `reload()`).
   */
  async refreshEmailVerified(): Promise<boolean> {
    const u = this.auth.currentUser;
    if (!u) return false;
    await u.reload();
    return u.emailVerified;
  }

  /**
   * True when the user still needs to verify their email before entering the
   * app. Only password-provider users are gated — Google/SSO users have their
   * email verified by the provider on sign-in.
   */
  requiresEmailVerification(currentUser?: User | null): boolean {
    const u = currentUser ?? this.auth.currentUser;
    if (!u) return false;
    const isPasswordProvider = u.providerData.some((p) => p.providerId === 'password');
    return isPasswordProvider && !u.emailVerified;
  }

  async loginWithEmail(email: string, password: string) {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    await this.upsertUserProfile({
      uid: credential.user.uid,
      email: credential.user.email ?? email,
      displayName: credential.user.displayName ?? '',
      photoURL: credential.user.photoURL ?? null,
      provider: 'password',
    });
    this.setUserProfile();
    return credential.user;
  }

  // Sign-up/login with Google both use popup auth flow.
  async signupWithGoogle() {
    const credential = await signInWithPopup(this.auth, this.googleProvider);
    await this.upsertUserProfile({
      uid: credential.user.uid,
      email: credential.user.email ?? '',
      displayName: credential.user.displayName ?? '',
      photoURL: credential.user.photoURL ?? null,
      provider: 'google',
    });
    this.setUserProfile();
    return credential.user;
  }

  async loginWithGoogle() {
    const credential = await signInWithPopup(this.auth, this.googleProvider);
    await this.upsertUserProfile({
      uid: credential.user.uid,
      email: credential.user.email ?? '',
      displayName: credential.user.displayName ?? '',
      photoURL: credential.user.photoURL ?? null,
      provider: 'google',
    });
    this.setUserProfile();
    return credential.user;
  }

  async resetPassword(email: string) {
    await sendPasswordResetEmail(this.auth, email);
  }

  /** Updates Firebase Auth profile and merged `users/{uid}` document; refreshes `userProfile` in localStorage. */
  async updateDisplayName(displayName: string): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) throw new Error('You must be signed in.');
    const name = displayName.trim();
    if (!name) throw new Error('Enter your name.');
    await updateProfile(u, { displayName: name });
    const provider: 'password' | 'google' = u.providerData.some(
      (p) => p.providerId === 'google.com',
    )
      ? 'google'
      : 'password';
    await this.upsertUserProfile({
      uid: u.uid,
      email: u.email ?? '',
      displayName: name,
      photoURL: u.photoURL,
      provider,
    });
    const doc = await this.getUserProfile(u.uid);
    if (doc) {
      localStorage.setItem('userProfile', JSON.stringify(doc));
    }
  }

  /**
   * Full session teardown. Structured as try/finally so a failure in any step
   * (e.g. offline, permission-denied on the device-doc delete) never leaves
   * per-user state behind. Order matters:
   *   1. FCM teardown BEFORE signOut — deleteDoc needs the outgoing session.
   *   2. signOut — clears the Firebase Auth persistence layer.
   *   3. Finally block runs regardless: purge IndexedDB, in-memory signals,
   *      localStorage keys, and the SW's dynamic Firestore cache.
   *   4. Navigate to /login.
   */
  async logout() {
    const uid = this.auth.currentUser?.uid ?? null;

    try {
      await this.fcmService.teardown(uid).catch(() => {
        /* FCM optional — non-fatal */
      });
      await signOut(this.auth);
      // notificationService.clearAll() is triggered by the auth-state subscriber
      // in the constructor when user becomes null after signOut.
    } finally {
      // ── Purge every scrap of the previous session ────────────────────────
      try {
        await this.syncService.clearAllData();
      } catch {
        /* IndexedDB unavailable — non-fatal */
      }
      // Session memos not covered by clearAllData.
      this.notificationPrefs.teardown();
      this.usersLookup.resetDirectory();
      this.syncService.failedEntries.set([]);
      this.userProfile.set(null);

      for (const key of LOGOUT_LOCAL_STORAGE_KEYS) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* localStorage disabled — non-fatal */
        }
      }

      await purgeServiceWorkerFirestoreCache();

      await this.router.navigateByUrl('/login', { replaceUrl: true });
    }
  }

  async getUserProfile(uid: string) {
    const userRef = doc(this.firestore, `users/${uid}`);
    const userDoc = await getDoc(userRef);
    return userDoc.data();
  }

  /**
   * Where a signed-in user should land: main app vs onboarding flow.
   * Use after login and in route guards.
   */
  async getPostAuthHomePath(uid: string): Promise<'/user/dashboard' | '/onboarding'> {
    return (await this.checkOnboardingStatus(uid)) ? '/user/dashboard' : '/onboarding';
  }

  /**
   * Checks whether the user has completed onboarding from the Firestore user doc.
   * Offline: reads `isOnboarded` from the cached `userProfile` object (same source of truth shape).
   */
  async checkOnboardingStatus(uid: string): Promise<boolean> {
    try {
      const profile = await this.getUserProfile(uid);
      const onboarded = profile?.['isOnboarded'] === true;
      this.patchCachedUserProfile(uid, { isOnboarded: onboarded });
      return onboarded;
    } catch {
      return this.readIsOnboardedFromCachedUserProfile(uid);
    }
  }

  /**
   * Marks the user as fully onboarded in Firestore and updates cached `userProfile`.
   */
  async markOnboarded(uid: string): Promise<void> {
    const userRef = doc(this.firestore, `users/${uid}`);
    await setDoc(userRef, { isOnboarded: true, updatedAt: serverTimestamp() }, { merge: true });
    this.patchCachedUserProfile(uid, { isOnboarded: true });
  }

  /**
   * Safe accessor for the cached `userProfile` blob. Components must use this
   * instead of parsing `localStorage['userProfile']` inline — a cleared or
   * corrupt value returns `null` here instead of throwing at the call site.
   * Prefers the in-memory signal (fresher, survives cleared storage).
   */
  getCachedProfile(): Record<string, unknown> | null {
    const fromSignal = this.userProfile();
    if (fromSignal) return fromSignal as Record<string, unknown>;
    try {
      const raw = localStorage.getItem('userProfile');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  private readIsOnboardedFromCachedUserProfile(uid: string): boolean {
    const raw = localStorage.getItem('userProfile');
    if (!raw) return false;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      return p['uid'] === uid && p['isOnboarded'] === true;
    } catch {
      return false;
    }
  }

  /**
   * Merges specific fields into the cached Firestore user doc under `userProfile`.
   * Uses an explicit key allow-list rather than `Object.assign(p, partial)` —
   * closes a prototype-pollution / unexpected-key vector from a malformed
   * `partial` argument.
   */
  private patchCachedUserProfile(uid: string, partial: Record<string, unknown>): void {
    const raw = localStorage.getItem('userProfile');
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (p['uid'] !== uid) return;
      for (const key of ALLOWED_PROFILE_PATCH_KEYS) {
        if (key in partial) p[key] = partial[key];
      }
      localStorage.setItem('userProfile', JSON.stringify(p));
    } catch {
      /* ignore corrupt cache */
    }
  }

  public async upsertUserProfile(userData: {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string | null;
    provider: 'password' | 'google';
  }) {
    const userRef = doc(this.firestore, `users/${userData.uid}`);
    const existingUser = await getDoc(userRef);

    const data: Record<string, unknown> = {
      uid: userData.uid,
      email: userData.email,
      displayName: userData.displayName,
      photoURL: userData.photoURL,
      provider: userData.provider,
      updatedAt: serverTimestamp(),
      createdAt: existingUser.exists() ? existingUser.data()['createdAt'] : serverTimestamp(),
    };

    // Only set isOnboarded to false on brand-new users (never overwrite if already true)
    if (!existingUser.exists()) {
      data['isOnboarded'] = false;
      data['date'] = date().format('YYYY-MM-DD');
    }

    await setDoc(userRef, data, { merge: true });
  }

  private setUserProfile() {
    // Called right after an explicit login/signup — currentUser is already set.
    // Do not persist ID/refresh tokens in localStorage (XSS surface); the auth
    // interceptor reads them from Firebase Auth (currentUser.getIdToken()).
    const uid = this.auth.currentUser?.uid;
    if (uid) void this.cacheUserProfile(uid);
  }

  /**
   * Ensures `localStorage['userProfile']` exists and matches the signed-in uid.
   * If it is missing or stale (e.g. site data was cleared), re-fetches the user
   * document from Firestore and caches it. Safe to call on every auth emission.
   */
  private async ensureUserProfileCached(uid: string): Promise<void> {
    const raw = localStorage.getItem('userProfile');
    if (raw) {
      try {
        const cached = JSON.parse(raw) as { uid?: string };
        if (cached?.uid === uid) return; // already cached for this user
      } catch {
        /* corrupt cache — fall through and refetch */
      }
    }
    await this.cacheUserProfile(uid);
  }

  /** Fetches `users/{uid}` from Firestore and caches it in localStorage + the signal. */
  private async cacheUserProfile(uid: string): Promise<void> {
    try {
      const profile = await runInInjectionContext(this.injector, () => this.getUserProfile(uid));
      if (profile) {
        localStorage.setItem('userProfile', JSON.stringify(profile));
        this.userProfile.set(profile as UserProfile);
      }
    } catch {
      /* offline or transient — keep any existing cached copy */
    }
  }
}

/**
 * Purge the Angular SW's dynamic Firestore cache so a subsequent user on the
 * same browser cannot be served the previous user's cached response bodies.
 * (Complementary to Phase 3, which removes the dataGroup entry — this handles
 * caches created by builds before that config lands.)
 */
async function purgeServiceWorkerFirestoreCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    const targets = names.filter(
      (n) => n.includes('firestore-api') || n.includes('data:dynamic:firestore'),
    );
    await Promise.all(targets.map((n) => caches.delete(n).catch(() => false)));
  } catch {
    /* Cache Storage unavailable — non-fatal */
  }
}
