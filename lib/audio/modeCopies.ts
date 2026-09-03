// Relative, not `@/`: this module is imported by Convex server code
// (features/courses.ts), whose bundler resolves relative paths only. The
// schema type comes from the generated data model rather than the learning
// components' re-export of it, so the backend never reaches into
// `components/`.
import type { Doc } from '../../convex/_generated/dataModel';

type CourseSettings = Doc<'courseSettings'>;

/**
 * The write-side half of the per-mode settings rule. `resolveModeSetting`
 * (lib/audio/mergeAudio.ts) owns which copy a mode READS; this owns which
 * copies exist to be written, and lives in its own module because both a
 * browser component and a Convex mutation need it and `mergeAudio` pulls in
 * Web Audio.
 */
export type ModeCopySuffix = 'Full' | 'Transcribe' | 'Radio';

/** The suffixes of `Base` that name a real column: `${Base}${suffix}` is in the schema. */
type SchemaCopiesOf<Base extends string> = {
  [S in ModeCopySuffix]: `${Base}${S}` extends keyof CourseSettings ? S : never;
}[ModeCopySuffix];

/**
 * Which per-mode copies actually exist in the schema, per writable playback
 * field. A mode whose copy is missing falls through to the next one in its own
 * chain, mirroring `resolveModeSetting` on the read side. Without this,
 * transcribe would write `pauseBaseToBaseTranscribe`, which is not a field.
 */
export const MODE_COPIES = {
  highlightWords: ['Full', 'Transcribe', 'Radio'],
  autoPlayAudio: ['Full', 'Transcribe'],
  languageRepetitions: ['Full', 'Transcribe', 'Radio'],
  languageRepetitionPauses: ['Full', 'Transcribe', 'Radio'],
  languagePlaybackSpeeds: ['Full', 'Transcribe', 'Radio'],
  pauseBaseToBase: ['Full', 'Radio'],
  pauseBaseToTarget: ['Full', 'Radio'],
  pauseTargetToTarget: ['Full', 'Transcribe', 'Radio'],
  pauseBeforeAutoAdvance: ['Full', 'Radio'],
  playTargetBeforeBase: ['Radio'],
  playTargetAfterBase: ['Radio'],
  targetBeforeRepetitions: ['Radio'],
  targetBeforeRepetitionPauses: ['Radio'],
  targetBeforePlaybackSpeeds: ['Radio'],
  pauseTargetToBase: ['Radio'],
  targetBeforeOnlyNewReps: ['Radio'],
  targetBeforeUntilGoodReps: ['Radio'],
  targetBeforeListeningStrategy: ['Radio'],
  // Partial, not Record: the point is that every key listed IS a real
  // CourseSettings field, not that every field is listed. Each suffix is
  // checked as well: `SchemaCopiesOf<K>` keeps only the suffixes whose
  // `${K}${suffix}` column exists, so a copy the schema doesn't have fails
  // to compile here instead of being written as a dead field.
} as const satisfies {
  [K in keyof CourseSettings & string]?: readonly SchemaCopiesOf<K>[];
};

/** Base field names that have at least one per-mode copy. */
export type ModeCopyBaseField = keyof typeof MODE_COPIES;

/** Each mode's write chain, most specific first. Radio branches off audio and
 *  never reaches a writing copy, matching `resolveModeSetting`. */
export const MODE_WRITE_CHAIN = {
  audio: [],
  full: ['Full'],
  transcribe: ['Transcribe', 'Full'],
  radio: ['Radio'],
} as const satisfies Record<
  'audio' | 'full' | 'transcribe' | 'radio',
  readonly ModeCopySuffix[]
>;

/**
 * Every field name one setting's value can be stored under: the shared field
 * plus each per-mode copy the schema actually has.
 *
 * Server-side validation reads this so a clamp written for a setting covers
 * its copies automatically — the alternative is a `key === 'x' || key ===
 * 'xRadio'` cascade that grows an arm, silently, per new copy.
 */
export function modeCopyKeys<K extends ModeCopyBaseField>(
  base: K,
): readonly [K, ...`${K}${ModeCopySuffix}`[]] {
  return [
    base,
    ...MODE_COPIES[base].map((suffix) => `${base}${suffix}`),
  ] as readonly [K, ...`${K}${ModeCopySuffix}`[]];
}
