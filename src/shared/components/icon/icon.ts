import { CommonModule } from '@angular/common';
import { booleanAttribute, Component, Input } from '@angular/core';

@Component({
  selector: 'ico',
  imports: [CommonModule],
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  /** Same-origin sprite; `<use>` must reference this file so icons work without relying on inline symbols in index.html. */
  readonly spriteUrl = 'assets/icons/sprite.svg';

  @Input() name!: string;
  @Input() size: string = 'md';
  /** Continuous rotation (e.g. loading indicator). */
  @Input({ transform: booleanAttribute }) spin = false;
}
