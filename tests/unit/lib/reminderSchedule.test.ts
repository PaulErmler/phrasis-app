import { describe, it, expect } from 'vitest';

import {
  REMINDER_STEP_MINUTES,
  isValidReminderMinute,
  nextOccurrence,
  reminderMinuteOptions,
} from '@/lib/reminderSchedule';

/**
 * These tests are the only thing standing between the reminder sweep and an
 * hour of drift twice a year. Berlin is used throughout because its DST
 * transitions are well known and it is one of the app's two locales.
 */

const BERLIN = 'Europe/Berlin';
const EIGHT_AM = 8 * 60;

/** Local wall-clock "HH:MM" of an instant, for readable assertions. */
function localTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms));
}

describe('isValidReminderMinute', () => {
  it('accepts whole quarter-hours within a day', () => {
    expect(isValidReminderMinute(0)).toBe(true);
    expect(isValidReminderMinute(EIGHT_AM)).toBe(true);
    expect(isValidReminderMinute(1425)).toBe(true); // 23:45, the last slot
  });

  it('rejects off-step, out-of-range and non-finite values', () => {
    // Rejects rather than rounds — see the contract in reminderSchedule.ts.
    expect(isValidReminderMinute(487)).toBe(false);
    expect(isValidReminderMinute(1439)).toBe(false); // 23:59 is not a slot
    expect(isValidReminderMinute(1440)).toBe(false);
    expect(isValidReminderMinute(-15)).toBe(false);
    expect(isValidReminderMinute(1.5)).toBe(false);
    expect(isValidReminderMinute(NaN)).toBe(false);
    expect(isValidReminderMinute(Infinity)).toBe(false);
  });
});

describe('reminderMinuteOptions', () => {
  it('covers the whole day at the step granularity', () => {
    const options = reminderMinuteOptions();
    expect(options).toHaveLength((24 * 60) / REMINDER_STEP_MINUTES);
    expect(options[0]).toBe(0);
    expect(options.at(-1)).toBe(1425);
    // Every offered option must survive server-side validation.
    expect(options.every(isValidReminderMinute)).toBe(true);
  });
});

describe('nextOccurrence', () => {
  it('returns later the same local day when the time has not passed', () => {
    const from = Date.parse('2026-03-10T05:00:00Z'); // 06:00 Berlin
    const next = nextOccurrence(BERLIN, EIGHT_AM, from);
    expect(localTime(next, BERLIN)).toBe('08:00');
    expect(localDate(next, BERLIN)).toBe('2026-03-10');
  });

  it('rolls to the next local day once the time has passed', () => {
    const from = Date.parse('2026-03-10T09:00:00Z'); // 10:00 Berlin
    const next = nextOccurrence(BERLIN, EIGHT_AM, from);
    expect(localTime(next, BERLIN)).toBe('08:00');
    expect(localDate(next, BERLIN)).toBe('2026-03-11');
  });

  it('is always strictly in the future', () => {
    // Equal-to-now must not count, or the sweep would re-claim the same row on
    // every run and the user would be pushed every 15 minutes.
    const exactly8am = nextOccurrence(
      BERLIN,
      EIGHT_AM,
      Date.parse('2026-05-01T00:00:00Z'),
    );
    expect(nextOccurrence(BERLIN, EIGHT_AM, exactly8am)).toBeGreaterThan(
      exactly8am,
    );
  });

  it('keeps the wall-clock time across a spring-forward transition', () => {
    // Berlin loses an hour at 02:00 on 2026-03-29, so 08:00 to 08:00 is 23h,
    // and the gap from 10:00 the previous day is 21h.
    const from = Date.parse('2026-03-28T09:00:00Z'); // 10:00 Berlin
    const next = nextOccurrence(BERLIN, EIGHT_AM, from);
    expect(localTime(next, BERLIN)).toBe('08:00');
    expect(localDate(next, BERLIN)).toBe('2026-03-29');
    expect(next - from).toBe(21 * 60 * 60 * 1000);
  });

  it('keeps the wall-clock time across a fall-back transition', () => {
    // Berlin gains an hour at 03:00 on 2026-10-25, so the same span is 22h.
    const from = Date.parse('2026-10-24T09:00:00Z'); // 11:00 Berlin
    const next = nextOccurrence(BERLIN, EIGHT_AM, from);
    expect(localTime(next, BERLIN)).toBe('08:00');
    expect(localDate(next, BERLIN)).toBe('2026-10-25');
    expect(next - from).toBe(22 * 60 * 60 * 1000);
  });

  it('resolves a wall-clock time that does not exist on a spring-forward day', () => {
    // 02:30 never happens on 2026-03-29 in Berlin. Rather than throwing or
    // silently skipping the day, it lands just past the gap.
    const from = Date.parse('2026-03-28T09:00:00Z');
    const next = nextOccurrence(BERLIN, 150, from);
    expect(next).toBeGreaterThan(from);
    expect(localDate(next, BERLIN)).toBe('2026-03-29');
    expect(localTime(next, BERLIN)).toBe('03:30');
  });

  it('resolves an ambiguous wall-clock time on a fall-back day to a single instant', () => {
    // 02:30 happens twice on 2026-10-25 in Berlin; one send, not two.
    const from = Date.parse('2026-10-24T09:00:00Z');
    const next = nextOccurrence(BERLIN, 150, from);
    expect(localTime(next, BERLIN)).toBe('02:30');
    expect(localDate(next, BERLIN)).toBe('2026-10-25');
  });

  it('handles midnight, half-hour offsets and southern-hemisphere DST', () => {
    const midnight = nextOccurrence(
      BERLIN,
      0,
      Date.parse('2026-05-02T21:30:00Z'),
    );
    expect(localTime(midnight, BERLIN)).toBe('00:00');

    const kolkata = nextOccurrence(
      'Asia/Kolkata',
      7 * 60 + 15,
      Date.parse('2026-05-01T06:00:00Z'),
    );
    expect(localTime(kolkata, 'Asia/Kolkata')).toBe('07:15');

    const auckland = nextOccurrence(
      'Pacific/Auckland',
      21 * 60,
      Date.parse('2026-04-04T00:00:00Z'),
    );
    expect(localTime(auckland, 'Pacific/Auckland')).toBe('21:00');

    const utc = nextOccurrence(
      'UTC',
      9 * 60,
      Date.parse('2026-05-01T10:00:00Z'),
    );
    expect(localTime(utc, 'UTC')).toBe('09:00');
  });

  it('never drifts across a year of consecutive advances', () => {
    // The property that actually matters: repeatedly feeding the result back in
    // — exactly what the sweep does — must hold the local time steady through
    // both DST transitions rather than accumulating an offset.
    let cursor = Date.parse('2026-01-01T00:00:00Z');
    const times = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const next = nextOccurrence(BERLIN, EIGHT_AM, cursor);
      expect(next).toBeGreaterThan(cursor);
      times.add(localTime(next, BERLIN));
      cursor = next;
    }
    expect([...times]).toEqual(['08:00']);
  });
});
