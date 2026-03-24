import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Notifier } from '../shared/components/notifier/pages/notifier';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Notifier],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('fintrackr');
}
