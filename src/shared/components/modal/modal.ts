import { CommonModule } from '@angular/common';
import { Component, effect, input, model, signal, TemplateRef } from '@angular/core';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-modal',
  imports: [CommonModule, Icon],
  templateUrl: './modal.html',
  styleUrl: './modal.css',
})
export class Modal {
  /** Two-way bind with `[(open)]`. */
  readonly open = model(false);
  /** True while the sheet is animating out. */
  readonly closing = signal(false);

  readonly title = input<string>('');
  /** When set, renders this template instead of default projected content. */
  readonly bodyTemplate = input<TemplateRef<unknown> | null>(null);
  /** Context object for `bodyTemplate` (e.g. `{ row: item }` for `let-row="row"`). */
  readonly templateContext = input<Record<string, unknown>>({});

  readonly closable = input(true);
  readonly closeOnBackdrop = input(true);

  constructor() {
    effect(() => {
      if (this.open()) this.closing.set(false);
    });
  }

  onBackdropClick(): void {
    if (this.closeOnBackdrop()) this.beginClose();
  }

  close(): void {
    this.beginClose();
  }

  beginClose(): void {
    if (this.closing() || !this.open()) return;
    this.closing.set(true);
  }

  onPanelTransitionEnd(event: TransitionEvent): void {
    if (!this.closing()) return;
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'transform') return;
    this.open.set(false);
    this.closing.set(false);
  }
}
