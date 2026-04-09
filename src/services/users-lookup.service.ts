import { inject, Injectable } from '@angular/core';
import {
  collection,
  Firestore,
  getDocs,
  limit,
  query,
  where,
} from '@angular/fire/firestore';

export interface UserLookupHit {
  uid: string;
  email: string;
  displayName: string;
}

@Injectable({ providedIn: 'root' })
export class UsersLookupService {
  private readonly firestore = inject(Firestore);

  /**
   * Resolves a registered app user by email on `users/{uid}.email`.
   * Tries a few normalizations because Firestore equality is case-sensitive.
   */
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
      };
    }
    return null;
  }
}
