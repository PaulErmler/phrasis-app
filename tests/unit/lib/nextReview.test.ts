import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import { nextReviewLine, type NextReviewLine } from '@/lib/nextReview';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

// UTC+2 in September, and no DST transition inside the range used below, so
// every expectation here is about the local calendar rather than about offsets.
const TZ = 'Europe/Berlin';
const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso).getTime();

/** `nextReviewLine` from a now/target pair rather than a remaining duration. */
const lineBetween = (nowIso: string, targetIso: string) => {
  const now = at(nowIso);
  const target = at(targetIso);
  return nextReviewLine(target, target - now, TZ);
};

describe('nextReviewLine', () => {
  it('stays relative-only below an hour', () => {
    // Under an hour the countdown already answers "should I wait?", and a clock
    // time would only add noise.
    const line = lineBetween('2026-09-09T04:00:00Z', '2026-09-09T04:45:00Z');
    expect(line).toMatchObject({ key: 'nextReview', clock: null, time: '45m' });
  });

  it('adds a clock time from an hour out', () => {
    const line = lineBetween('2026-09-09T04:00:00Z', '2026-09-09T07:00:00Z');
    expect(line).toMatchObject({
      key: 'empty.nextReviewToday',
      clock: 'time',
      time: '3h',
    });
  });

  it('counts day gaps on local dates, not on elapsed milliseconds', () => {
    // 5 hours from 23:00 Berlin lands at 04:00 the next morning: "tomorrow",
    // even though it is a shorter wait than the 20-hour case below.
    expect(
      lineBetween('2026-09-09T21:00:00Z', '2026-09-10T02:00:00Z'),
    ).toMatchObject({ key: 'empty.nextReviewTomorrow', clock: 'time' });

    // 20 hours from 06:00 Berlin lands at 02:00, still only "tomorrow".
    expect(
      lineBetween('2026-09-09T04:00:00Z', '2026-09-10T00:00:00Z'),
    ).toMatchObject({ key: 'empty.nextReviewTomorrow', clock: 'time' });

    // And a 20-hour wait that does NOT cross local midnight stays "today".
    expect(
      lineBetween('2026-09-09T00:00:00Z', '2026-09-09T20:00:00Z'),
    ).toMatchObject({ key: 'empty.nextReviewToday', clock: 'time' });
  });

  it('names a weekday within the week and a date beyond it', () => {
    // 2026-09-09 is a Wednesday.
    expect(
      lineBetween('2026-09-09T10:00:00Z', '2026-09-12T02:00:00Z'),
    ).toMatchObject({ key: 'empty.nextReviewOn', clock: 'weekdayTime' });

    // Six days ahead is still placeable by weekday; a week is not.
    expect(
      lineBetween('2026-09-09T10:00:00Z', '2026-09-15T02:00:00Z'),
    ).toMatchObject({ clock: 'weekdayTime' });
    expect(
      lineBetween('2026-09-09T10:00:00Z', '2026-09-16T02:00:00Z'),
    ).toMatchObject({ key: 'empty.nextReviewOn', clock: 'dateTime' });
  });

  it('passes the countdown text and its staleness through', () => {
    const target = at('2026-09-10T02:00:00Z');
    const line = nextReviewLine(target, 14 * HOUR + 23 * 60_000 + 40_000, TZ);
    expect(line.time).toBe('14h 23m');
    // Paced by the minute at that scale, not the second.
    expect(line.staleInMs).toBe(40_001);
  });

  it('treats a target already reached as a relative zero', () => {
    // The caller normally stops before this, but the wording must not flip to a
    // stale "today at …" line if it does.
    const target = at('2026-09-09T04:00:00Z');
    expect(nextReviewLine(target, 0, TZ)).toMatchObject({
      key: 'nextReview',
      time: '0s',
      clock: null,
    });
  });
});

describe('nextReviewLine keys against the real catalogs', () => {
  // The component test mocks next-intl, and the parity test only compares en to
  // de. Neither would catch `nextReviewLine` naming a key the catalog lacks, or
  // a message wanting a placeholder the component does not pass.
  const CASES: Array<{
    key: NextReviewLine['key'];
    values: Record<string, string>;
  }> = [
    { key: 'nextReview', values: { time: '12m' } },
    { key: 'empty.nextReviewToday', values: { time: '3h', clock: '19:00' } },
    {
      key: 'empty.nextReviewTomorrow',
      values: { time: '14h 23m', clock: '04:00' },
    },
    {
      key: 'empty.nextReviewOn',
      values: { time: '3d 2h', clock: 'Sat, 04:00' },
    },
  ];

  for (const locale of ['en', 'de'] as const) {
    const messages = locale === 'en' ? en : de;
    const t = createTranslator({ locale, messages, namespace: 'LearningMode' });

    for (const { key, values } of CASES) {
      it(`renders ${key} in ${locale}`, () => {
        const text = t(key, values);
        // A missing key or a bad placeholder makes next-intl return the key path
        // or leave the brace in place rather than throw.
        expect(text).not.toContain('{');
        expect(text).not.toBe(`LearningMode.${key}`);
        for (const value of Object.values(values)) {
          expect(text).toContain(value);
        }
      });
    }
  }

  it('covers every key the helper can return', () => {
    // Guards the list above against a new variant being added to NextReviewLine
    // without a matching message.
    const covered = new Set(CASES.map((c) => c.key));
    const produced = new Set<NextReviewLine['key']>([
      nextReviewLine(at('2026-09-09T05:00:00Z'), 30 * 60_000, TZ).key,
      nextReviewLine(at('2026-09-09T12:00:00Z'), 3 * HOUR, TZ).key,
      nextReviewLine(at('2026-09-10T12:00:00Z'), 26 * HOUR, TZ).key,
      nextReviewLine(at('2026-09-12T12:00:00Z'), 74 * HOUR, TZ).key,
      nextReviewLine(at('2026-09-20T12:00:00Z'), 265 * HOUR, TZ).key,
    ]);
    for (const key of produced) expect(covered).toContain(key);
    expect(produced.size).toBe(covered.size);
  });
});
