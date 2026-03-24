import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';

/**
 * Uploads profile images to Firebase Storage (same project as `environment.firebase`).
 * Returns the public download URL to store in your form / Firestore `photoURL`.
 */
@Injectable({ providedIn: 'root' })
export class ProfileUploadService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);

  async uploadProfilePicture(file: File): Promise<string> {
    await this.auth.authStateReady();
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('You must be signed in to upload a profile picture.');
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `profile-pictures/${user.uid}/${Date.now()}_${safeName}`;
    const storageRef = ref(this.storage, path);

    await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
    });

    return getDownloadURL(storageRef);
  }
}
