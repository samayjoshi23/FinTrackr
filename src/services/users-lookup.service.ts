import { inject, Injectable, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { collection, Firestore, getDocs, limit, query, where } from '@angular/fire/firestore';

export interface UserLookupHit {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
}

@Injectable({ providedIn: 'root' })
export class UsersLookupService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  /** All other users (excludes current user), for client-side name/email filtering. */
  readonly directoryUsers = signal<UserLookupHit[]>([]);
  readonly directoryLoaded = signal(false);
  readonly directoryLoading = signal(false);

  private loadPromise: Promise<void> | null = null;
  /** Loads all users once for client-side filtering. */
  async loadUsersDirectory(): Promise<void> {
    if (this.directoryLoaded()) return;
    this.loadPromise ??= this.fetchDirectory();
    await this.loadPromise;
  }

  private async fetchDirectory(): Promise<void> {
    this.directoryLoading.set(true);
    try {
      const snap = await getDocs(collection(this.firestore, 'users'));
      const myUid = this.auth.currentUser?.uid ?? '';
      const hits: UserLookupHit[] = [];
      for (const d of snap.docs) {
        if (d.id === myUid) continue;
        const data = d.data();
        hits.push({
          uid: d.id,
          email: String(data['email'] ?? ''),
          displayName: String(data['displayName'] ?? ''),
          photoURL: (data['photoURL'] as string | null | undefined) ?? null,
        });
      }
      this.directoryUsers.set(hits);
      this.directoryLoaded.set(true);
    } catch (e) {
      console.error('loadUsersDirectory failed', e);
      this.directoryUsers.set([]);
      this.directoryLoaded.set(false);
    } finally {
      this.directoryLoading.set(false);
      this.loadPromise = null;
    }
  }

  /** Clears cached search results. */
  resetDirectory(): void {
    this.directoryUsers.set([]);
    this.directoryLoaded.set(false);
    this.loadPromise = null;
  }

  /** Resolves a registered user by email using users/{uid}.email. */
  async findByEmail(email: string): Promise<UserLookupHit | null> {
    const norm = email.trim();
    if (!norm) return null;
    const base = collection(this.firestore, 'users');
    const candidates = Array.from(new Set([norm, norm.toLowerCase()]));
    for (const candidate of candidates) {
      const snap = await getDocs(query(base, where('email', '==', candidate), limit(1)));
      if (snap.empty) continue;
      const docSnap = snap.docs[0];
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        email: String(data['email'] ?? candidate),
        displayName: String(data['displayName'] ?? ''),
        photoURL: (data['photoURL'] as string | null | undefined) ?? null,
      };
    }
    return null;
  }
}
