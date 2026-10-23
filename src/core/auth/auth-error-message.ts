import { FirebaseError } from 'firebase/app';

const COMMON_AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'Invalid email or password.',
  'auth/wrong-password': 'Invalid email or password.',
  'auth/user-not-found': 'Invalid email or password.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/email-already-in-use': 'This email is already registered.',
  'auth/weak-password': 'Password is too weak. Use a stronger password.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
};

/**
 * Maps a Firebase Auth error to a user-facing message. `overrides` lets a
 * screen reword specific codes (e.g. reset-password vs login for `user-not-found`).
 */
export function authErrorMessage(
  error: unknown,
  fallback: string,
  overrides: Record<string, string> = {},
): string {
  if (!(error instanceof FirebaseError)) return 'Something went wrong. Please try again.';
  return overrides[error.code] ?? COMMON_AUTH_ERRORS[error.code] ?? (error.message || fallback);
}
