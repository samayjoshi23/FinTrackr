"use strict";
/**
 * Calendar helpers for Asia/Kolkata (IST), used by scheduled jobs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.istDateKey = istDateKey;
exports.istMonthKey = istMonthKey;
exports.istPreviousMonthKey = istPreviousMonthKey;
exports.istMonthLongName = istMonthLongName;
exports.istDayBoundsUtc = istDayBoundsUtc;
exports.isLastDayOfMonthIST = isLastDayOfMonthIST;
/** YYYY-MM-DD for the given instant in IST. */
function istDateKey(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
/** YYYY-MM for the given instant in IST. */
function istMonthKey(d = new Date()) {
    const key = istDateKey(d);
    return key.slice(0, 7);
}
/** Previous calendar month in IST as YYYY-MM. */
function istPreviousMonthKey(d = new Date()) {
    const key = istDateKey(d);
    const [y, m] = key.split('-').map(Number);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    return `${prev.y}-${String(prev.m).padStart(2, '0')}`;
}
/** Long month name in IST (e.g. April) — matches many budget docs. */
function istMonthLongName(d = new Date()) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        month: 'long',
    }).format(d);
}
/** Inclusive start / exclusive end of the IST calendar day for `dateKey`, as UTC Dates. */
function istDayBoundsUtc(dateKey) {
    const start = new Date(`${dateKey}T00:00:00+05:30`);
    const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, endExclusive };
}
/** True if `d` (default now) is the last day of the month in IST. */
function isLastDayOfMonthIST(d = new Date()) {
    const todayKey = istDateKey(d);
    const month = todayKey.slice(0, 7);
    const tomorrow = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    return istDateKey(tomorrow).slice(0, 7) !== month;
}
//# sourceMappingURL=time-ist.js.map