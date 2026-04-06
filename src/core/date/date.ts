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
