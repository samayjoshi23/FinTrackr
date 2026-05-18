import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { addDoc, collection, Firestore, serverTimestamp } from '@angular/fire/firestore';
import { Icon } from '../../../../shared/components/icon/icon';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { environment } from '../../../../environment/environment';

interface FeedbackPayload {
  message: string;
  rating: number;
  userId: string | null;
  userEmail: string | null;
  createdAt: unknown;
}

@Component({
  selector: 'app-about',
  imports: [CommonModule, Icon, FormsModule],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly notifier = inject(NotifierService);

  readonly appVersion = environment.appVersion;

  feedbackMessage = signal('');
  feedbackRating = signal(0);
  submittingFeedback = signal(false);

  readonly ratingStars = [1, 2, 3, 4, 5];

  onBack() {
    void this.router.navigateByUrl('/user/settings');
  }

  setRating(star: number) {
    this.feedbackRating.set(star);
  }

  openGitHub() {
    window.open('https://github.com/samayjoshi', '_blank', 'noopener');
  }

  openPortfolio() {
    window.open('https://samayjoshi.dev', '_blank', 'noopener');
  }

  async onShareApp() {
    const shareData: ShareData = {
      title: 'LogMyMudra',
      text: 'Track your finances, split group expenses, and manage recurring payments — all in one app.',
      url: window.location.origin,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.origin);
        this.notifier.success('App link copied to clipboard!');
      }
    } catch {
      // user cancelled share — no-op
    }
  }

  async onSubmitFeedback(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    if (!this.feedbackMessage().trim()) {
      this.notifier.error('Please enter your feedback.');
      return;
    }

    this.submittingFeedback.set(true);
    try {
      const user = this.auth.currentUser;
      const payload: FeedbackPayload = {
        message: this.feedbackMessage().trim(),
        rating: this.feedbackRating(),
        userId: user?.uid ?? null,
        userEmail: user?.email ?? null,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(this.firestore, 'feedback'), payload);

      this.feedbackMessage.set('');
      this.feedbackRating.set(0);
      form.resetForm();
      this.notifier.success('Thank you for your feedback!');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not submit feedback. Please try again.');
    } finally {
      this.submittingFeedback.set(false);
    }
  }
}
