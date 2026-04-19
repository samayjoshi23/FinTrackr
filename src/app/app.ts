import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { filter } from 'rxjs/operators';
import { Notifier } from '../shared/components/notifier/pages/notifier';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Notifier],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('fintrackr');

  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // If the browser back stack still reaches /login or /register while signed in, bounce home
    // (primary prevention is navigate { replaceUrl: true } after auth).
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const path = this.router.url.split('?')[0];
        if (path !== '/login' && path !== '/register') return;
        const u = this.auth.currentUser;
        if (!u) return;
        void this.authService.getPostAuthHomePath(u.uid).then((home) => {
          void this.router.navigateByUrl(home, { replaceUrl: true });
        });
      });
  }
}
