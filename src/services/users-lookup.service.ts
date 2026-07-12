import { inject, Injectable, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { collection, Firestore, getDocs, limit, query, where } from '@angular/fire/firestore';

export interface UserLookupHit {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
}

const DIRECTORY = 'user-directory';

/**
 * Resolves emails → user profiles for the invite flow, via the denormalized
 * `/user-directory` collection maintained by the `onUserProfileWrite` trigger.
 *
 * The directory doc contains only `{ uid, displayName, photoURL, emailHash }`.
 * Lookups require the exact email — we hash it locally with SHA-256 and query
 * `where('emailHash','==', hash)`. Rules deny broad reads (no `getDocs` on the
 * collection), so enumeration is not possible and no email PII ever crosses
 * the wire.
 *
 * Search UX: users type a full email address; on match a single hit populates
 * `directoryUsers` for the existing template markup. Substring/name search
 * over the whole user base is deliberately removed — it required exposing PII
 * and had no privacy story.
 */
@Injectable({ providedIn: 'root' })
export class UsersLookupService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  /** Latest search results (0 or 1 hits — the shape existing templates render). */
  readonly directoryUsers = signal<UserLookupHit[]>([]);
  readonly directoryLoaded = signal(false);
  readonly directoryLoading = signal(false);

  /**
   * Legacy: previously loaded the entire user collection for client-side
   * substring search. That capability is intentionally gone — the caller
   * should invoke `searchByEmail(query)` on input changes instead. Kept as a
   * no-op so existing focus / open handlers don't crash.
   */
  async loadUsersDirectory(): Promise<void> {
    return;
  }

  /**
   * Query `/user-directory` by email — expects a fully-formed address. Updates
   * `directoryUsers` with 0 or 1 hits so existing typeahead markup keeps
   * rendering.
   */
  async searchByEmail(rawQuery: string): Promise<void> {
    const email = (rawQuery ?? '').trim().toLowerCase();
    if (!email || !looksLikeEmail(email)) {
      this.directoryUsers.set([]);
      this.directoryLoaded.set(false);
      return;
    }

    this.directoryLoading.set(true);
    try {
      const hit = await this.findByEmail(email);
      const myUid = this.auth.currentUser?.uid ?? '';
      const list = hit && hit.uid !== myUid ? [hit] : [];
      this.directoryUsers.set(list);
      this.directoryLoaded.set(true);
    } catch (e) {
      console.error('Directory lookup failed', e);
      this.directoryUsers.set([]);
      this.directoryLoaded.set(false);
    } finally {
      this.directoryLoading.set(false);
    }
  }

  /** Clears the current results (called on focus-out / account-type switch). */
  resetDirectory(): void {
    this.directoryUsers.set([]);
    this.directoryLoaded.set(false);
  }

  /**
   * Resolves a registered user by their exact email address. Returns null if
   * no match or the email is not a valid address. Because the email is stored
   * only as a hash in `/user-directory`, this method returns the queried
   * email verbatim on the `UserLookupHit` (never leaking anyone else's).
   */
  async findByEmail(rawEmail: string): Promise<UserLookupHit | null> {
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!email || !looksLikeEmail(email)) return null;

    const emailHash = await sha256Hex(email);
    const snap = await getDocs(
      query(collection(this.firestore, DIRECTORY), where('emailHash', '==', emailHash), limit(1)),
    );
    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    const data = docSnap.data();
    return {
      uid: (data['uid'] as string) ?? docSnap.id,
      email,
      displayName: String(data['displayName'] ?? ''),
      photoURL: (data['photoURL'] as string | null | undefined) ?? null,
    };
  }
}

function looksLikeEmail(s: string): boolean {
  const i = s.indexOf('@');
  return i > 0 && i < s.length - 1 && s.indexOf('.', i + 1) > i + 1;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
