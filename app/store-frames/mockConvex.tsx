'use client';

/**
 * A Convex client that answers a fixed set of queries with fixture data.
 *
 * Screens like the milestone celebration read their content from queries that
 * need a signed-in session. Nesting this provider inside the store-frames
 * route swaps the real client for one that returns mocked results, so the
 * screenshots never contain a real user's statistics.
 *
 * `useQueries` only ever calls `watchQuery` on the client, so that is the one
 * method that has to behave.
 */
import type { ReactNode } from 'react';
import { ConvexProvider } from 'convex/react';
import { getFunctionName } from 'convex/server';

const WORDS = [
  'quería',
  'preguntar',
  'tiempo',
  'cansado',
  'ocasión',
  'prefiero',
  'temo',
  'mañana',
  'deadline',
  'ayudar',
  'disculpe',
  'siempre',
  'mientras',
  'llamaste',
  'comida',
  'viaje',
  'estado',
  'vida',
  'país',
  'próxima',
];

const RESULTS: Record<string, unknown> = {
  'features/stats:getCardCounts': {
    new: 12,
    learning: 8,
    relearning: 3,
    review: 51,
  },
  'features/stats:getNewWordsForCelebration': {
    session: WORDS.map((display) => ({ language: 'es', display })),
    today: WORDS.map((display) => ({ language: 'es', display })),
  },
  'features/stats:getRecentWords': [
    {
      language: 'es',
      words: [
        ...WORDS,
        'entender',
        'trabajo',
        'ciudad',
        'pensar',
        'ahora',
        'todavía',
        'dinero',
        'camino',
        'salir',
        'querer',
        'bastante',
        'pequeño',
        'cerca',
        'nunca',
        'gente',
        'porque',
        'casa',
        'hablar',
      ],
    },
  ],
  'features/courses:getCourseStats': {
    totalRepetitions: 9410,
    totalTimeMs: 62 * 60 * 60 * 1000,
    totalCards: 1845,
    currentStreak: 128,
    streakFreezeCount: 2,
    streakFrozenToday: false,
    streakState: 'active',
    totalWordCount: 1204,
  },
  'features/projections:getProjections': {
    today: '2026-08-20',
    basis: 'observed',
    currentWords: 1204,
    // levelByYearEnd is the shortest indicator ("B1" over "by end of 2026").
    // The wordier ones overlap "Daily goal reached" at phone width.
    indicators: [{ kind: 'levelByYearEnd', code: 'B1', year: '2026' }],
  },
  'features/courses:getTodayStats': {
    reps: 74,
    newCards: 20,
    timeMs: 21 * 60 * 1000,
    accuracyAvg: 92,
  },
};

const emptyWatch = {
  onUpdate: () => () => {},
  localQueryResult: () => undefined,
  journal: () => undefined,
};

const mockClient = {
  watchQuery(query: unknown, _args?: unknown) {
    const name =
      typeof query === 'string' ? query : getFunctionName(query as never);
    if (!(name in RESULTS)) return emptyWatch;
    return {
      onUpdate: () => () => {},
      localQueryResult: () => RESULTS[name],
      journal: () => undefined,
    };
  },
  watchPaginatedQuery: () => emptyWatch,
  mutation: async () => undefined,
  action: async () => undefined,
  setAuth: () => {},
  clearAuth: () => {},
  connectionState: () => ({
    hasInflightRequests: false,
    isWebSocketConnected: true,
  }),
};

/** 20 levels. Numbering restarts inside each CEFR tier, so the chips read
 *  Pre-A1, A1.1, A1.2, A1.3, A2.1 and so on. */
const LEVEL_PLAN: {
  name: string;
  tier: string;
  total: number;
  added: number;
}[] = [
  { name: 'Pre-A1', tier: 'Pre-A1', total: 1200, added: 1200 },
  { name: 'A1.1', tier: 'A1', total: 1150, added: 1150 },
  { name: 'A1.2', tier: 'A1', total: 1150, added: 1150 },
  { name: 'A1.3', tier: 'A1', total: 1150, added: 980 },
  { name: 'A2.1', tier: 'A2', total: 1180, added: 640 },
  { name: 'A2.2', tier: 'A2', total: 1180, added: 0 },
  { name: 'A2.3', tier: 'A2', total: 1180, added: 0 },
  { name: 'B1.1', tier: 'B1', total: 1220, added: 0 },
  { name: 'B1.2', tier: 'B1', total: 1220, added: 0 },
  { name: 'B1.3', tier: 'B1', total: 1220, added: 0 },
  { name: 'B2.1', tier: 'B2', total: 1240, added: 0 },
  { name: 'B2.2', tier: 'B2', total: 1240, added: 0 },
  { name: 'B2.3', tier: 'B2', total: 1240, added: 0 },
  { name: 'C1.1', tier: 'C1', total: 1180, added: 0 },
  { name: 'C1.2', tier: 'C1', total: 1180, added: 0 },
  { name: 'C1.3', tier: 'C1', total: 1180, added: 0 },
  { name: 'C2.1', tier: 'C2', total: 900, added: 0 },
  { name: 'C2.2', tier: 'C2', total: 900, added: 0 },
  { name: 'C2.3', tier: 'C2', total: 900, added: 0 },
  { name: 'C2.4', tier: 'C2', total: 900, added: 0 },
];

const HOME_SUMMARY = {
  activeCollectionId: 'c-A2.1',
  levels: LEVEL_PLAN.map((l, i) => ({
    collectionId: `c-${l.name}`,
    code: l.name,
    cefrTier: l.tier,
    order: i + 1,
    displayName: l.name,
    totalTexts: l.total,
    cardsAdded: l.added,
    ignoredCount: 0,
    prioritizedCount: 0,
    browseAnchor: l.added,
    cardsLearned: Math.round(l.added * 0.8),
    cardsMastered: Math.round(l.added * 0.4),
  })),
  customCollections: [],
};

/** Preloaded-query stand-ins. `usePreloadedQuery` falls back to `_valueJSON`
 *  whenever the live query is undefined, which is what the mock client does
 *  for anything it has no fixture for. */
export const PRELOADED = {
  homeSummary: {
    _name: 'features/home:getHomeSummary',
    _argsJSON: {},
    _valueJSON: HOME_SUMMARY,
  },
  courseSettings: {
    _name: 'features/courses:getActiveCourseSettings',
    _argsJSON: {},
    _valueJSON: { reviewMode: 'audio', dailyTimeGoalMinutes: 20 },
  },
  settings: {
    _name: 'features/courses:getUserSettings',
    _argsJSON: {},
    _valueJSON: { hasCompletedOnboarding: true },
  },
  activeCourse: {
    _name: 'features/courses:getActiveCourse',
    _argsJSON: {},
    _valueJSON: { _id: 'course-1', currentLevel: 'A2' },
  },
} as const;

export function MockConvex({ children }: { children: ReactNode }) {
  return (
    <ConvexProvider client={mockClient as never}>{children}</ConvexProvider>
  );
}
