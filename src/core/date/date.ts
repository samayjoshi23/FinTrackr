export type DateInput = string | number | Date | undefined;

/** Minimal shape for `transactionEventDate` — avoids core → features imports. */
export type TransactionDateFields = {
  date?: string;
  createdAt?: Date | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toNative(input?: DateInput): Date {
  if (input === undefined) {
    return new Date();
  }
  if (input instanceof Date) {
    return new Date(input.getTime());
  }
  if (typeof input === 'number') {
    return new Date(input);
  }
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid date: ${input}`);
  }
  return new Date(ms);
}

/**
 * Lightweight moment-style wrapper around `Date` (local time for format / calendar parsing).
 */
export class DateTime {
  private constructor(private readonly native: Date) {}

  static from(input?: DateInput): DateTime {
    return new DateTime(toNative(input));
  }

  add(amount: number, unit: string): DateTime {
    const u = unit.endsWith('s') ? unit.slice(0, -1) : unit;
    const d = new Date(this.native.getTime());
    switch (u) {
      case 'y':
      case 'Y':
        d.setFullYear(d.getFullYear() + amount);
        break;
      case 'M':
        d.setMonth(d.getMonth() + amount);
        break;
      case 'w':
      case 'W':
        d.setDate(d.getDate() + amount * 7);
        break;
      case 'd':
      case 'D':
        d.setDate(d.getDate() + amount);
        break;
      case 'h':
      case 'H':
        d.setHours(d.getHours() + amount);
        break;
      case 'm':
        d.setMinutes(d.getMinutes() + amount);
        break;
      case 's':
      case 'S':
        d.setSeconds(d.getSeconds() + amount);
        break;
      case 'ms':
        d.setMilliseconds(d.getMilliseconds() + amount);
        break;
      default:
        throw new Error(`Unknown date add unit: ${unit}`);
    }
    return new DateTime(d);
  }

  /**
   * Supported tokens: `YYYY`, `YY`, `MM`, `DD`, `HH`, `mm`, `ss` (local timezone).
   */
  format(pattern: string): string {
    const d = this.native;
    const tokens: [string, string][] = [
      ['YYYY', String(d.getFullYear())],
      ['YY', String(d.getFullYear()).slice(-2)],
      ['MM', pad2(d.getMonth() + 1)],
      ['DD', pad2(d.getDate())],
      ['HH', pad2(d.getHours())],
      ['mm', pad2(d.getMinutes())],
      ['ss', pad2(d.getSeconds())],
    ];
    let out = pattern;
    for (const [key, val] of tokens) {
      out = out.split(key).join(val);
    }
    return out;
  }

  toDate(): Date {
    return new Date(this.native.getTime());
  }

  valueOf(): number {
    return this.native.getTime();
  }
}

/**
 * Moment-style entry: `date()` now, `date('2026-10-20')` parsed in local calendar when ISO date-only.
 */
export function date(input?: DateInput): DateTime {
  return DateTime.from(input);
}

/** Prefer explicit Firestore `date` field (`YYYY-MM-DD`), else derive from timestamp. */
export function docCalendarDate(
  data: Record<string, unknown>,
  fallbackDate: Date | null | undefined,
): string | undefined {
  const raw = data['date'];
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  if (fallbackDate) {
    return date(fallbackDate).format('YYYY-MM-DD');
  }
  return undefined;
}

/** 'YYYY-MM' for the calendar month a `Date` falls in (local time). */
export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 'YYYY-MM' for today. */
export function currentMonthKey(): string {
  return toMonthKey(new Date());
}

/** 'YYYY-MM' → `Date` at 00:00:00 on the 1st of that month (local time). */
export function startOfMonth(monthKey: string): Date {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
}

/** 'YYYY-MM' → `Date` at 23:59:59.999 on the last day of that month (local time). */
export function endOfMonth(monthKey: string): Date {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0, 23, 59, 59, 999);
}

/** 'YYYY-MM' → human label. `style: 'long'` → 'July 2026'; default 'short' → 'Jul 2026'. */
export function monthKeyLabel(monthKey: string, style: 'long' | 'short' = 'short'): string {
  const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleString('en-US', {
    month: style,
    year: 'numeric',
  });
}

/** Days remaining in the calendar month `d` falls in (0 on the last day). */
export function daysLeftInMonth(d: Date): number {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const ms = end.getTime() - d.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** `Date` → 'YYYY-MM-DD' in local calendar (matches how the app stores transaction dates). */
export function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Event instant for filters / charts: calendar day from `date`, with clock from `createdAt` when it matches that day.
 */
export function transactionEventDate(t: TransactionDateFields): Date | null {
  const raw = t.date;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    if (t.createdAt) {
      const c = new Date(t.createdAt);
      if (c.getFullYear() === y && c.getMonth() === m - 1 && c.getDate() === d) {
        return new Date(
          y,
          m - 1,
          d,
          c.getHours(),
          c.getMinutes(),
          c.getSeconds(),
          c.getMilliseconds(),
        );
      }
    }
    return new Date(y, m - 1, d);
  }
  if (t.createdAt) {
    return new Date(t.createdAt.getTime());
  }
  return null;
}
