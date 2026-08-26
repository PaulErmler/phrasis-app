/**
 * Deterministic mock data for the store-screenshot pages
 * (app/screenshots/[screen]), impressive-but-plausible numbers for a user
 * ~4 months in. Series are seeded (no Math.random) so captures are
 * reproducible.
 */

/** Small seeded PRNG (mulberry32) so every capture renders identically. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Persona: two months of daily use, never missed a day. */
export const HERO_STATS = {
  streak: 61,
  reps: 9412,
  sentences: 843,
  words: 2038,
  timeMs: 58 * 3600_000 + 12 * 60_000,
  todayReps: 128,
  todayNewCards: 12,
  todayTimeMs: 41 * 60_000,
  todayNewWords: 24,
  accuracyPct: 93,
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last `n` days, oldest first, as ISO dates ending today. */
export function lastDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(isoDate(d));
  }
  return out;
}

/**
 * Daily activity for the stats chart + heatmap: 61 days, every single day
 * active (the persona never broke the streak), gently ramping up.
 */
export function dailySeries() {
  const rand = seededRandom(42);
  return lastDays(61).map((date, i) => {
    const ramp = 0.6 + (i / 61) * 0.7;
    const weekly = 0.8 + 0.4 * Math.sin(((i % 7) / 7) * Math.PI);
    const reps = Math.round((90 + rand() * 110) * ramp * weekly);
    return {
      date,
      reps,
      newCards: Math.round(reps * 0.09),
      timeMs: reps * 22_000,
    };
  });
}

/** Daily new words. Single language (Spanish), matching the Home course. */
export function languageDailySeries() {
  const rand = seededRandom(7);
  const days = lastDays(61);
  return days.map((date, i) => {
    const ramp = 0.6 + (i / 61) * 0.8;
    return {
      date,
      language: 'es',
      newWordsCount: Math.round((22 + rand() * 26) * ramp),
    };
  });
}

/** Aggregate the daily series into ISO-week buckets for the year view. */
export function weeklySeries() {
  const daily = dailySeries();
  const byWeek = new Map<
    string,
    { totalRepetitions: number; totalNewCards: number; totalTimeMs: number }
  >();
  for (const d of daily) {
    const dt = new Date(`${d.date}T12:00:00Z`);
    const jan1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((dt.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7,
    );
    const key = `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    const agg = byWeek.get(key) ?? {
      totalRepetitions: 0,
      totalNewCards: 0,
      totalTimeMs: 0,
    };
    agg.totalRepetitions += d.reps;
    agg.totalNewCards += d.newCards;
    agg.totalTimeMs += d.timeMs;
    byWeek.set(key, agg);
  }
  return Array.from(byWeek.entries()).map(([week, v]) => ({ week, ...v }));
}

/** Reviews by hour of day. Commute + evening peaks (hands-free story). */
export const HOURLY_DISTRIBUTION = [
  0, 0, 0, 0, 0, 2, 14, 38, 52, 24, 12, 9, 16, 11, 7, 9, 14, 31, 46, 58, 41, 22,
  8, 2,
];

export const CHAT_THREAD = {
  userQuestion: 'How do I conjugate estar for "I" and "they" in Spanish?',
  assistantAnswer:
    'For yo (I), estar becomes **estoy** — e.g. *Estoy bien*. For ellos/ellas (they) it’s **están**. Here are two cards so it sticks:',
  cards: [
    {
      base: 'Good morning, how are you?',
      target: 'Buenos días ¿cómo está usted?',
      state: 'approved' as const,
    },
    {
      base: 'Good morning everyone, how are you all?',
      target: 'Buenos días ¿cómo están?',
      state: 'pending' as const,
    },
  ],
};

export const REVIEW_CARD = {
  reviewCount: 3,
  base: { language: 'en', text: 'Could we see the menu, please?' },
  target: { language: 'es', text: '¿Podríamos ver el menú, por favor?' },
  ratingIntervals: { again: '<10m', hard: '2d', good: '6d', easy: '14d' },
};

export const TESTIMONIALS = [
  'You have essentially taken the best aspects of Anki, Glossika and Clozemaster and combined them into one. The audio-focused approach of Flexling I can do indefinitely.',
  'I’ve always wanted a hands-free way to get comprehensible input. Glossika was decent but Flexling far exceeds it.',
  'My absolute favorite feature is the ability to add custom cards. I already canceled my Glossika subscription.',
  'I’m using Flexling. It’s excellent. Highly recommended.',
  'I found Flexling a few days ago and love it. Exactly what I need!',
];
