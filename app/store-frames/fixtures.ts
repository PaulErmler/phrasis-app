/**
 * Mocked data for the store-screenshot route. Shaped like a learner who has
 * been using Flexling for months, so the stats components render a full,
 * believable dashboard rather than a fresh-account empty state.
 *
 * Nothing here is used by the app itself. See `app/store-frames/page.tsx`.
 */
import type {
  CardTranslation,
  CardAudioRecording,
} from '@/components/app/learning/types';

export const TZ = 'Europe/Berlin';

/** A quarter-second of silence. Real audio components need a loadable URL or
 *  they render a permanent loading spinner in the screenshot. */
export const SILENT_AUDIO =
  'data:audio/wav;base64,UklGRvQHAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YdAHAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

/** Anchor date so renders are reproducible regardless of when they run. */
const TODAY = new Date('2026-08-20T09:00:00Z');

function isoDay(offsetDays: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Deterministic pseudo-random so successive renders are byte-identical. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------- cards

export const shadowCard: {
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
} = {
  sourceText: 'I have been meaning to ask you something.',
  translations: [
    {
      language: 'en',
      text: 'I have been meaning to ask you something.',
      isBaseLanguage: true,
      isTargetLanguage: false,
    },
    {
      language: 'es',
      text: 'Hace tiempo que quería preguntarte algo.',
      isBaseLanguage: false,
      isTargetLanguage: true,
    },
  ],
  audioRecordings: [
    {
      language: 'en',
      voiceName: 'en-US-Chirp3-HD-Aoede',
      url: SILENT_AUDIO,
      wordTimings: null,
      ttsQuality: 'validated',
    },
    {
      language: 'es',
      voiceName: 'es-ES-Chirp3-HD-Charon',
      url: SILENT_AUDIO,
      wordTimings: null,
      ttsQuality: 'validated',
    },
  ],
};

export const romanizedCard: {
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
} = {
  sourceText: 'Could you write it down for me?',
  translations: [
    {
      language: 'en',
      text: 'Could you write it down for me?',
      isBaseLanguage: true,
      isTargetLanguage: false,
    },
    {
      language: 'ja',
      text: '書いてもらえますか。',
      romanization: 'kaite moraemasu ka.',
      isBaseLanguage: false,
      isTargetLanguage: true,
    },
  ],
  audioRecordings: [
    {
      language: 'en',
      voiceName: 'en-US-Chirp3-HD-Aoede',
      url: SILENT_AUDIO,
      wordTimings: null,
      ttsQuality: 'validated',
    },
    {
      language: 'ja',
      voiceName: 'ja-JP-Chirp3-HD-Puck',
      url: SILENT_AUDIO,
      wordTimings: null,
      ttsQuality: 'validated',
    },
  ],
};

export const writeCard: {
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
} = {
  sourceText: 'Good morning, how are you?',
  translations: [
    {
      language: 'en',
      text: 'Good morning, how are you?',
      isBaseLanguage: true,
      isTargetLanguage: false,
    },
    {
      language: 'es',
      text: 'Buenos días, ¿cómo está?',
      isBaseLanguage: false,
      isTargetLanguage: true,
    },
  ],
  audioRecordings: [
    {
      language: 'en',
      voiceName: 'en-US-Chirp3-HD-Aoede',
      url: SILENT_AUDIO,
      wordTimings: null,
      ttsQuality: 'validated',
    },
    {
      language: 'es',
      voiceName: 'es-ES-Chirp3-HD-Charon',
      url: SILENT_AUDIO,
      wordTimings: null,
      ttsQuality: 'validated',
    },
  ],
};

// ---------------------------------------------------------------- stats

export const numbers = {
  streak: 128,
  streakState: 'active' as const,
  words: 1_204,
  reviews: 9_410,
  sentences: 1_845,
  timeMs: 62 * 60 * 60 * 1000 + 40 * 60 * 1000,
  accuracySum: 8_642,
  accuracyCount: 9_410,
  languageWordCounts: [{ language: 'es', words: 1_204 }],
  todayReps: 74,
  todayNewCards: 12,
  todayTimeMs: 21 * 60 * 1000,
  todayNewWords: 9,
  weekReps: 431,
  weekNewCards: 68,
  weekTimeMs: 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
  weekNewWords: 54,
  monthReps: 1_780,
  monthNewCards: 260,
  monthTimeMs: 9 * 60 * 60 * 1000 + 5 * 60 * 1000,
  monthNewWords: 214,
};

/** 400 days of activity, ramping up so the cumulative line has a real shape. */
export const dailyData = Array.from({ length: 400 }, (_, i) => {
  const back = 399 - i;
  const ramp = 0.35 + (i / 400) * 0.9;
  const skip = rand(i + 7) < 0.08;
  return {
    date: isoDay(back),
    reps: skip ? 0 : Math.round((14 + rand(i) * 34) * ramp),
    newCards: skip ? 0 : Math.round((2 + rand(i + 3) * 7) * ramp),
    timeMs: skip ? 0 : Math.round((5 + rand(i + 5) * 16) * ramp) * 60 * 1000,
  };
});

export const languageDailyData = dailyData.map((d) => ({
  date: d.date,
  language: 'es',
  newWordsCount: d.newCards,
}));

export const monthlyData = (() => {
  const byMonth = new Map<
    string,
    { totalRepetitions: number; totalNewCards: number; totalTimeMs: number }
  >();
  for (const d of dailyData) {
    const m = d.date.slice(0, 7);
    const acc = byMonth.get(m) ?? {
      totalRepetitions: 0,
      totalNewCards: 0,
      totalTimeMs: 0,
    };
    acc.totalRepetitions += d.reps;
    acc.totalNewCards += d.newCards;
    acc.totalTimeMs += d.timeMs;
    byMonth.set(m, acc);
  }
  return [...byMonth].map(([month, v]) => ({ month, ...v }));
})();

export const weeklyData = (() => {
  const out: {
    week: string;
    totalRepetitions: number;
    totalNewCards: number;
    totalTimeMs: number;
  }[] = [];
  for (let i = 0; i < dailyData.length; i += 7) {
    const chunk = dailyData.slice(i, i + 7);
    out.push({
      week: `2026-W${String(Math.floor(i / 7) + 1).padStart(2, '0')}`,
      totalRepetitions: chunk.reduce((s, d) => s + d.reps, 0),
      totalNewCards: chunk.reduce((s, d) => s + d.newCards, 0),
      totalTimeMs: chunk.reduce((s, d) => s + d.timeMs, 0),
    });
  }
  return out;
})();

export const heatmapData = dailyData.map((d) => ({
  date: d.date,
  reps: d.reps,
}));

/** Reviews per hour of day. Peaks in the evening, dips after lunch. */
export const hourly = [
  2, 1, 0, 0, 0, 3, 21, 68, 96, 74, 41, 33, 58, 44, 26, 31, 47, 88, 164, 191,
  142, 87, 39, 11,
];
