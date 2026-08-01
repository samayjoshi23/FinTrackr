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
  // Some Android WebView / non-secure contexts expose `crypto` without `subtle`.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256HexJs(input);
}

// FIPS 180-4 SHA-256, output matches Node's createHash('sha256').digest('hex').
function sha256HexJs(input: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >>> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

  const W = new Uint32Array(64);
  const rr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(W[i - 15], 7) ^ rr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rr(W[i - 2], 17) ^ rr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
}
