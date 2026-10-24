import { Timestamp } from '@angular/fire/firestore';
import { asFirestoreDate } from './transaction-mapper';

describe('asFirestoreDate', () => {
  it('reads Timestamps and Dates', () => {
    const d = new Date(2026, 9, 5);
    expect(asFirestoreDate(Timestamp.fromDate(d))?.getTime()).toBe(d.getTime());
    expect(asFirestoreDate(d)).toBe(d);
  });

  it('reads a legacy YYYY-MM-DD string as a local calendar date', () => {
    // Recurring schedules saved by the old Add recurring form stored nextPaymentDate this way.
    const d = asFirestoreDate('2026-09-02');
    expect(d).not.toBeNull();
    expect([d!.getFullYear(), d!.getMonth(), d!.getDate()]).toEqual([2026, 8, 2]);
  });

  it('rejects anything else', () => {
    expect(asFirestoreDate(null)).toBeNull();
    expect(asFirestoreDate('next week')).toBeNull();
    expect(asFirestoreDate(new Date('invalid'))).toBeNull();
  });
});
