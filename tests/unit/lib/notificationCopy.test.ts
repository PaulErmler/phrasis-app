import { describe, it, expect } from 'vitest';

import {
  renderDailyReminder,
  resolveNotificationLocale,
  type NotificationLocale,
  type ReminderStreakState,
} from '@/lib/notificationCopy';

const LOCALES: NotificationLocale[] = ['en', 'de'];

describe('resolveNotificationLocale', () => {
  it('narrows to a supported locale and defaults to English', () => {
    expect(resolveNotificationLocale('de')).toBe('de');
    expect(resolveNotificationLocale('en')).toBe('en');
    // A locale the app no longer ships, or a never-synced preference.
    expect(resolveNotificationLocale('fr')).toBe('en');
    expect(resolveNotificationLocale(undefined)).toBe('en');
  });
});

describe('renderDailyReminder', () => {
  it('always produces non-empty title and body in both locales', () => {
    const states: ReminderStreakState[] = [
      'active',
      'pending',
      'frozen',
      'broken',
      'none',
    ];
    for (const locale of LOCALES) {
      for (const streakState of states) {
        for (const dueCount of [0, 1, 12]) {
          const out = renderDailyReminder(locale, {
            dueCount,
            streakState,
            streakDays: 5,
          });
          expect(out.title.length).toBeGreaterThan(0);
          expect(out.body.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses distinct copy per locale', () => {
    const input = {
      dueCount: 3,
      streakState: 'pending' as const,
      streakDays: 4,
    };
    const en = renderDailyReminder('en', input);
    const de = renderDailyReminder('de', input);
    expect(en.title).not.toBe(de.title);
    expect(en.body).not.toBe(de.body);
  });

  it('singularizes a single due card', () => {
    const one = renderDailyReminder('en', {
      dueCount: 1,
      streakState: 'none',
      streakDays: 0,
    });
    expect(one.body).toContain('1 card');
    expect(one.body).not.toContain('1 cards');

    const oneDe = renderDailyReminder('de', {
      dueCount: 1,
      streakState: 'none',
      streakDays: 0,
    });
    expect(oneDe.body).toContain('1 Karte');
    expect(oneDe.body).not.toContain('1 Karten');
  });

  it('mentions the streak only when it is alive but unfed today', () => {
    const atRisk = renderDailyReminder('en', {
      dueCount: 3,
      streakState: 'pending',
      streakDays: 7,
    });
    expect(atRisk.body).toContain('7-day streak');

    // Dangling a streak the user already lost reads as a taunt.
    for (const streakState of ['broken', 'none'] as const) {
      const body = renderDailyReminder('en', {
        dueCount: 3,
        streakState,
        streakDays: 0,
      }).body;
      expect(body).not.toContain('streak');
    }
  });

  it('has copy for a day with nothing due', () => {
    const en = renderDailyReminder('en', {
      dueCount: 0,
      streakState: 'pending',
      streakDays: 3,
    });
    // The sweep deliberately still sends on quiet days, so this must read as a
    // nudge rather than an empty work order.
    expect(en.body).toContain('Nothing due');
    expect(en.body).toContain('3-day streak');
  });

  it('normalizes nonsense counts instead of putting them on a lock screen', () => {
    for (const dueCount of [-4, NaN, Infinity, 2.7]) {
      const body = renderDailyReminder('en', {
        dueCount,
        streakState: 'none',
        streakDays: 0,
      }).body;
      // Ordinary sentence punctuation is fine; a leaked numeric artefact is not.
      expect(body).not.toMatch(/NaN|Infinity|-\d|\d+\.\d/);
    }
    // 2.7 floors to 2 rather than rendering a fractional card count.
    expect(
      renderDailyReminder('en', {
        dueCount: 2.7,
        streakState: 'none',
        streakDays: 0,
      }).body,
    ).toContain('2 cards');
  });
});
