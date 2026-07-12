"use strict";
/**
 * Denormalized user directory for email-based invite lookups.
 *
 * Mirrors `users/{uid}` into `/user-directory/{uid}` with only the fields
 * needed to resolve an email to a uid + display avatar:
 *
 *   { uid, displayName, photoURL, emailHash, updatedAt }
 *
 * `emailHash` is SHA-256(lowercased email). Rules allow any signed-in user to
 * read `/user-directory`, but the plaintext email never appears there, and the
 * hash is not range-queryable — a lookup requires the exact email to build the
 * matching hash. This preserves the invite flow with zero per-invite callable
 * invocations, replacing the previous `getDocs(collection('users'))` scan.
 *
 * Fires on every write to `/users/{uid}` — signup + occasional profile edits.
 * Well under 1M invocations/mo even at scale; effectively free vs. a callable
 * invoked once per invite attempt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserProfileWrite = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const DIRECTORY = 'user-directory';
/** SHA-256 hex digest of a lowercased, trimmed email string. */
function hashEmail(email) {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized)
        return null;
    return (0, node_crypto_1.createHash)('sha256').update(normalized).digest('hex');
}
exports.onUserProfileWrite = (0, firestore_1.onDocumentWritten)('users/{uid}', async (event) => {
    const db = (0, firestore_2.getFirestore)();
    const uid = event.params.uid;
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    const dirRef = db.collection(DIRECTORY).doc(uid);
    // Delete: remove the mirror entry.
    if (!after) {
        await dirRef.delete().catch(() => {
            /* mirror may not exist yet — non-fatal */
        });
        return;
    }
    const email = after['email'] ?? null;
    const displayName = after['displayName'] ?? null;
    const photoURL = after['photoURL'] ?? null;
    const emailHash = hashEmail(email);
    // Skip when none of the mirrored fields changed — avoids redundant writes.
    if (before) {
        const prevEmail = before['email'] ?? null;
        if (before['displayName'] === displayName &&
            before['photoURL'] === photoURL &&
            hashEmail(prevEmail) === emailHash) {
            return;
        }
    }
    await dirRef.set({
        uid,
        displayName,
        photoURL,
        emailHash,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    }, { merge: true });
});
//# sourceMappingURL=user-directory.js.map