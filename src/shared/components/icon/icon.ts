import { CommonModule } from '@angular/common';
import { booleanAttribute, Component, inject, Input } from '@angular/core';
import { IconSpriteService } from './icon-sprite.service';

@Component({
  selector: 'ico',
  imports: [CommonModule],
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  private readonly iconSprite = inject(IconSpriteService);

  @Input() name!: string;
  @Input() size: string = 'md';
  /** Continuous rotation (e.g. loading indicator). */
  @Input({ transform: booleanAttribute }) spin = false;

  /**
   * `<use>` target. Once the sprite is inlined into the document we reference the symbol
   * same-document (`#name`) — synchronous, never races a network fetch. Until then (and
   * if inlining ever fails) we fall back to the external sprite file, preserving today's
   * behaviour. Reading the signal here re-evaluates the binding when inlining completes,
   * which also re-resolves any icon that was showing blank.
   */
  get href(): string {
    const base = this.iconSprite.inlined() ? '' : IconSpriteService.spriteUrl;
    return `${base}#${this.name}`;
  }
}
