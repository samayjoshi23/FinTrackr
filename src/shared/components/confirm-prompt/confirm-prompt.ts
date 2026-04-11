import { CommonModule } from '@angular/common';
import { Component, computed, input, model, output } from '@angular/core';
import { Modal } from '../modal/modal';
import { Icon } from '../icon/icon';

export type PromptSeverity = 'info' | 'success' | 'warn' | 'danger';

@Component({
  selector: 'app-confirm-prompt',
  imports: [CommonModule, Modal, Icon],
  templateUrl: './confirm-prompt.html',
})
export class ConfirmPrompt {
  readonly open = model(false);
  readonly title = input<string>('Are you sure?');
  readonly message = input<string>('');
  readonly icon = input<string>('trash');
  readonly confirmText = input<string>('Yes');
  readonly cancelText = input<string>('Cancel');
  readonly severity = input<PromptSeverity>('warn');
  readonly confirmed = output<boolean>();

  readonly iconBgClass = computed(() => {
    switch (this.severity()) {
      case 'danger':
        return 'button-red';
      case 'warn':
        return 'button-yellow';
      case 'success':
        return 'button-amber';
      default:
        return 'button-primary';
    }
  });

  readonly confirmButtonClass = computed(() => {
    switch (this.severity()) {
      case 'danger':
        return 'button-red';
      case 'warn':
        return 'button-yellow';
      case 'success':
        return 'button-amber';
      default:
        return 'button-primary';
    }
  });

  onConfirm(): void {
    this.confirmed.emit(true);
    this.open.set(false);
  }

  onCancel(): void {
    this.confirmed.emit(false);
    this.open.set(false);
  }
}
