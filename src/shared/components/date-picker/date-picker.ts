import { CommonModule } from '@angular/common';
import {
  booleanAttribute,
  Component,
  effect,
  forwardRef,
  inject,
  input,
  OnDestroy,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from '../icon/icon';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local-calendar ISO date `YYYY-MM-DD`. */
export function dateToIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseIsoLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const dt = new Date(y, mo, day);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== day) return null;
  return dt;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** Week is Monday–Sunday; returns the Sunday ending the week that contains `base`. */
function endOfIsoWeek(base: Date): Date {
  const x = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const mondayOffset = (x.getDay() + 6) % 7;
  const monday = addDays(x, -mondayOffset);
  return addDays(monday, 6);
}

function addCalendarMonths(base: Date, months: number): Date {
  const day = base.getDate();
  const r = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}

export interface DatePickerDayCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

@Component({
  selector: 'app-date-picker',
  imports: [CommonModule, Icon],
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatePicker),
      multi: true,
    },
  ],
})
export class DatePicker implements ControlValueAccessor, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  readonly placeholder = input<string>('Select date');
  /** Modal header (matches picker purpose). */
  readonly modalTitle = input<string>('Date');
  /** Primary footer button label. */
  readonly confirmLabel = input<string>('Done');
  /** For `<label for="...">` association. */
  readonly hostId = input<string>('', { alias: 'id' });
  /** Hide the trailing calendar icon (e.g. when wrapped in `.field-wrapper` with its own icon). */
  readonly compactFieldIcon = input(false, { transform: booleanAttribute });

  protected readonly panelOpen = signal(false);
  protected readonly panelClosing = signal(false);
  protected readonly viewYear = signal(new Date().getFullYear());
  protected readonly viewMonth = signal(new Date().getMonth());

  protected valueIso = signal<string | null>(null);

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};
  protected disabled = false;

  /** If `transitionend` never fires, still tear down overlay + body scroll lock. */
  private closeFallbackTimer?: ReturnType<typeof setTimeout>;

  protected readonly monthLabel = computed(() => {
    const d = new Date(this.viewYear(), this.viewMonth(), 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });

  protected readonly weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

  protected readonly grid = computed(() => this.buildMonthGrid(this.viewYear(), this.viewMonth()));

  protected readonly shortcuts = computed(() => {
    const today = new Date();
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekEnd = endOfIsoWeek(base);
    const oneMonth = addCalendarMonths(base, 1);
    const threeMonths = addCalendarMonths(base, 3);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return [
      { key: 'week' as const, label: 'This week', date: weekEnd, sub: fmt(weekEnd) },
      { key: '1m' as const, label: '1 month', date: oneMonth, sub: fmt(oneMonth) },
      { key: '3m' as const, label: '3 months', date: threeMonths, sub: fmt(threeMonths) },
    ];
  });

  constructor() {
    effect(() => {
      if (this.panelOpen()) this.panelClosing.set(false);
    });

    fromEvent<KeyboardEvent>(document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ev) => {
        if (ev.key === 'Escape' && (this.panelOpen() || this.panelClosing())) {
          ev.preventDefault();
          this.beginCloseOverlay();
        }
      });
  }

  ngOnDestroy(): void {
    if (this.closeFallbackTimer) {
      clearTimeout(this.closeFallbackTimer);
      this.closeFallbackTimer = undefined;
    }
    this.unlockBodyScroll();
  }

  protected displayLabel(): string {
    const v = this.valueIso();
    if (!v) return this.placeholder();
    const d = parseIsoLocal(v);
    if (!d) return v;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  writeValue(obj: string | Date | null): void {
    if (obj == null || obj === '') {
      this.valueIso.set(null);
      return;
    }
    const iso = obj instanceof Date ? dateToIsoLocal(obj) : String(obj);
    this.valueIso.set(iso);
    const parsed = parseIsoLocal(iso);
    if (parsed) {
      this.viewYear.set(parsed.getFullYear());
      this.viewMonth.set(parsed.getMonth());
    }
  }

  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  protected openOverlay(event: Event): void {
    event.stopPropagation();
    if (this.disabled) return;
    if (this.closeFallbackTimer) {
      clearTimeout(this.closeFallbackTimer);
      this.closeFallbackTimer = undefined;
    }
    this.panelOpen.set(true);
    this.lockBodyScroll();
    const v = this.valueIso();
    const parsed = v ? parseIsoLocal(v) : null;
    if (parsed) {
      this.viewYear.set(parsed.getFullYear());
      this.viewMonth.set(parsed.getMonth());
    }
    this.onTouched();
  }

  protected beginCloseOverlay(): void {
    if (this.panelClosing() || !this.panelOpen()) return;
    this.panelClosing.set(true);
    if (this.closeFallbackTimer) clearTimeout(this.closeFallbackTimer);
    this.closeFallbackTimer = setTimeout(() => {
      this.closeFallbackTimer = undefined;
      if (this.panelClosing()) this.finalizeOverlayClose();
    }, 650);
  }

  private finalizeOverlayClose(): void {
    if (this.closeFallbackTimer) {
      clearTimeout(this.closeFallbackTimer);
      this.closeFallbackTimer = undefined;
    }
    this.panelOpen.set(false);
    this.panelClosing.set(false);
    this.unlockBodyScroll();
  }

  protected onSheetTransitionEnd(event: TransitionEvent): void {
    if (!this.panelClosing()) return;
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'transform') return;
    this.finalizeOverlayClose();
  }

  protected onBackdropClick(event: Event): void {
    if (event.target === event.currentTarget) this.beginCloseOverlay();
  }

  protected confirmClose(): void {
    this.beginCloseOverlay();
  }

  protected prevMonth(): void {
    let y = this.viewYear();
    let m = this.viewMonth() - 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    this.viewYear.set(y);
    this.viewMonth.set(m);
  }

  protected nextMonth(): void {
    let y = this.viewYear();
    let m = this.viewMonth() + 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    this.viewYear.set(y);
    this.viewMonth.set(m);
  }

  protected pickIso(iso: string): void {
    if (this.disabled) return;
    this.valueIso.set(iso);
    this.onChange(iso);
    this.onTouched();
    this.beginCloseOverlay();
  }

  protected pickShortcut(d: Date): void {
    this.pickIso(dateToIsoLocal(d));
  }

  protected isSelected(iso: string): boolean {
    return this.valueIso() === iso;
  }

  private lockBodyScroll(): void {
    document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    document.body.style.overflow = '';
  }

  private buildMonthGrid(year: number, month: number): DatePickerDayCell[] {
    const todayStr = dateToIsoLocal(new Date());
    const first = new Date(year, month, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - mondayOffset);
    const cells: DatePickerDayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const iso = dateToIsoLocal(d);
      cells.push({
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: iso === todayStr,
      });
    }
    return cells;
  }
}
