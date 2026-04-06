/** The four core FSRS card states, indexed by state number (0-3). */
export const FSRS_STATE_LABELS = ['new', 'learning', 'review', 'relearning'] as const;

export type FsrsStateLabel = (typeof FSRS_STATE_LABELS)[number];

/** Extended state labels including mastered and hidden (used for aggregate queries). */
export const EXTENDED_STATE_LABELS = [
  ...FSRS_STATE_LABELS,
  'mastered',
  'hidden',
] as const;

export type ExtendedStateLabel = (typeof EXTENDED_STATE_LABELS)[number];
