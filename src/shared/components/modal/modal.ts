import { CommonModule } from '@angular/common';
import { Overlay, OverlayConfig, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  TemplateRef,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Icon } from '../icon/icon';

export interface ModalShowOptions {
  onShow?: () => void;
  onHide?: () => void;
}

export interface ModalHideOptions {
  onHide?: () => void;
}

@Component({
  selector: 'app-modal',
  imports: [CommonModule, Icon],
  templateUrl: './modal.html',
  styleUrl: './modal.css',
  host: { class: 'modal-host' },
})
export class Modal {
  /** Two-way bind with `[(open)]`. */
  readonly open = model(false);
  /** True while the sheet is animating out. */
  readonly closing = signal(false);

  /** Shell portaled to the CDK overlay container (document root). */
  private readonly overlayShell = viewChild.required<TemplateRef<unknown>>('overlayShell');

  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);

  private overlayRef?: OverlayRef;
  private escSubscription?: Subscription;
  private closeFallbackTimer?: ReturnType<typeof setTimeout>;
  private pendingOnShow?: () => void;
  private pendingOnHide?: () => void;

  readonly title = input<string>('');
  /** Content from the host component (`<ng-template #x>` + `[bodyTemplate]="x"`). */
  readonly bodyTemplate = input.required<TemplateRef<unknown>>();
  readonly templateContext = input<Record<string, unknown>>({});

  readonly closable = input(true);
  readonly closeOnBackdrop = input(true);

  /** Fires after the overlay is attached (one frame after open). */
  readonly opened = output<void>();
  /** Fires after exit animation completes and the overlay is torn down. */
  readonly closed = output<void>();

  constructor() {
    effect(() => {
      if (this.open()) this.closing.set(false);
    });

    effect(() => {
      const visible = this.open() || this.closing();
      if (visible) {
        queueMicrotask(() => this.ensureOverlayAttached());
      } else {
        this.ensureOverlayDetached();
      }
    });
  }

  /**
   * Opens the modal. Optional `onShow` runs after the overlay is attached;
   * `onHide` runs when the modal finishes closing (after exit animation).
   */
  show(options?: ModalShowOptions): void {
    if (options?.onShow) this.pendingOnShow = options.onShow;
    if (options?.onHide) this.pendingOnHide = options.onHide;
    this.open.set(true);
  }

  /**
   * Starts closing the modal. Optional `onHide` runs when fully closed (same timing as `closed`).
   */
  hide(options?: ModalHideOptions): void {
    if (options?.onHide) this.pendingOnHide = options.onHide;
    this.beginClose();
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
    if (this.closeFallbackTimer) clearTimeout(this.closeFallbackTimer);
    this.closeFallbackTimer = setTimeout(() => {
      this.closeFallbackTimer = undefined;
      if (this.closing()) this.finalizeClose();
    }, 650);
  }

  private finalizeClose(): void {
    if (this.closeFallbackTimer) {
      clearTimeout(this.closeFallbackTimer);
      this.closeFallbackTimer = undefined;
    }
    this.pendingOnHide?.();
    this.pendingOnHide = undefined;
    this.open.set(false);
    this.closing.set(false);
    this.closed.emit();
  }

  onPanelTransitionEnd(event: TransitionEvent): void {
    if (!this.closing()) return;
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'transform') return;
    this.finalizeClose();
  }

  private ensureOverlayAttached(): void {
    const shell = this.overlayShell();
    if (this.overlayRef?.hasAttached()) return;

    const positionStrategy = this.overlay.position().global().top('0').left('0');

    const config = new OverlayConfig({
      hasBackdrop: false,
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.block(),
      width: '100%',
      height: '100%',
      panelClass: 'fintrackr-modal-cdk-pane',
    });

    this.overlayRef = this.overlay.create(config);

    const portal = new TemplatePortal(shell, this.vcr);
    this.overlayRef.attach(portal);

    this.escSubscription?.unsubscribe();
    this.escSubscription = this.overlayRef.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape' && this.closable()) {
        e.preventDefault();
        this.beginClose();
      }
    });

    queueMicrotask(() => {
      this.pendingOnShow?.();
      this.pendingOnShow = undefined;
      this.opened.emit();
    });
  }

  private ensureOverlayDetached(): void {
    this.escSubscription?.unsubscribe();
    this.escSubscription = undefined;
    if (this.overlayRef) {
      this.overlayRef.detach();
      this.overlayRef.dispose();
      this.overlayRef = undefined;
    }
  }
}
