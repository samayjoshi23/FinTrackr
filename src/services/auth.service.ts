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
import { SyncService } from '../core/offline/sync.service';
import { date } from '../core/date';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly router = inject(Router);
  private readonly googleProvider = new GoogleAuthProvider();
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly syncService = inject(SyncService);

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

  async logout() {
    await signOut(this.auth);
    // Clear IndexedDB cached data and sync queue
    await this.syncService.clearAllData();
    localStorage.removeItem('userProfile');
    localStorage.removeItem('userId');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    await this.router.navigateByUrl('/login');
  }

  async getUserProfile(uid: string) {
    const userRef = doc(this.firestore, `users/${uid}`);
    const userDoc = await getDoc(userRef);
    return userDoc.data();
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
        const idToken = await runInInjectionContext(this.injector, () => user.getIdToken());
        localStorage.setItem('accessToken', idToken ?? '');

        const refreshToken = await runInInjectionContext(this.injector, () => user.refreshToken);
        localStorage.setItem('refreshToken', refreshToken ?? '');
      }
    });
  }
}
