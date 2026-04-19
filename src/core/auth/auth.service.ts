import {
  DestroyRef,
  Injectable,
  Injector,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  GoogleAuthProvider,
  UserProfile,
  createUserWithEmailAndPassword,
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
import { date } from '../date';

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

  readonly user$ = user(this.auth);
  userProfile = signal<UserProfile | null>(null);

  constructor() {
    this.googleProvider.setCustomParameters({ prompt: 'select_account' });
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

    this.setUserProfile();
    this.initNotifications(credential.user.uid);
    return credential.user;
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
    this.initNotifications(credential.user.uid);
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
    this.initNotifications(credential.user.uid);
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
    this.initNotifications(credential.user.uid);
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

  async logout() {
    await signOut(this.auth);
    await this.syncService.clearAllData();
    await this.notificationService.clearAll();
    localStorage.removeItem('userProfile');
    localStorage.removeItem('userId');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  /** Fire-and-forget: initialise notifications + FCM token after login. */
  private initNotifications(userId: string): void {
    void this.notificationService.init(userId);
    void this.fcmService.initForUser(userId);
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

  /** Merges fields into the cached Firestore user doc under `userProfile`. */
  private patchCachedUserProfile(uid: string, partial: Record<string, unknown>): void {
    const raw = localStorage.getItem('userProfile');
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (p['uid'] !== uid) return;
      Object.assign(p, partial);
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
    this.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(async (user) => {
      if (user) {
        const userProfile = await runInInjectionContext(this.injector, () =>
          this.getUserProfile(user.uid),
        );
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        // Do not persist ID tokens or refresh tokens in localStorage (XSS surface).
        // Use Firebase Auth (currentUser.getIdToken()) and the auth interceptor instead.
      }
    });
  }
}
