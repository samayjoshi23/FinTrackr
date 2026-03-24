import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { NotifierService } from '../notifier.service';
import { environment } from '../../../../environment/environment';

@Component({
  selector: 'app-notifier',
  imports: [CommonModule],
  templateUrl: './notifier.html',
  styleUrl: './notifier.css',
})
export class Notifier {
  readonly notifier = inject(NotifierService);
  readonly position = signal<string>(environment.notifier.position);
}
