import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';

/**
 * Uploads profile images to Firebase Storage.
 * The firebase/storage module is loaded lazily on first upload so it
 * never contributes to the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class ProfileUploadService {
  private readonly auth = inject(Auth);

  async uploadProfilePicture(file: File): Promise<string> {
    await this.auth.authStateReady();
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('You must be signed in to upload a profile picture.');
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `profile-pictures/${user.uid}/${Date.now()}_${safeName}`;

    // Lazy-load the Storage SDK — keeps it out of the initial chunk
    const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const storage = getStorage();
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
    });

    return getDownloadURL(storageRef);
  }
}
