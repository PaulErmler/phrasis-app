import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { Doc } from './_generated/dataModel';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
} from '../lib/constants/audioPlayback';
import {
  postProcessTranslation,
  USER_PROVIDED_TRANSLATION_SOURCE,
} from '../lib/languages';

// App-wide migrations via @convex-dev/migrations: batched, resumable, with
// state tracking so completed migrations are skipped on re-run. `runAll` is
// chained after every deploy (`npx convex deploy ... && npx convex run
// migrations:runAll --prod`); append new migrations to its list.
//
// The hand-rolled batch jobs in convex/migrations/ predate this component and
// stay as-is (they're parameterized/one-off dashboard tools, not deploy-time
// backfills).
export const migrations = new Migrations<DataModel>(components.migrations);

/** Generic runner: npx convex run migrations:run '{"fn": "migrations:<name>"}' */
export const run = migrations.runner();

/**
 * Backfill for the per-mode playback-settings split (see
 * docs/migrations/per-mode-settings-backfill.md).
 *
 * Deployment does NOT depend on it — writing modes read
 * `*Transcribe ?? *Full ?? <audio field> ?? DEFAULT_*` — but once it has run,
 * the `?? <audio field>` compatibility branch for the `*Full` set becomes
 * dead code. Per-field `undefined` guards keep it idempotent; user writes are
 * never overwritten. The `*Transcribe` / `transcribeAfter*` fields are
 * deliberately NOT stamped: Transcribe shipped after the split, so inheriting
 * from the `*Full` set is its intended default, not a compatibility shim.
 */
export const perModeSettingsBackfill = migrations.define({
  table: 'courseSettings',
  migrateOne: (_ctx, doc) => {
    const patch: Partial<Doc<'courseSettings'>> = {};

    // Writing-mode ("full") copies of the audio playback settings, stamped
    // from the doc's current effective audio values.
    if (doc.highlightWordsFull === undefined && doc.highlightWords !== undefined) {
      patch.highlightWordsFull = doc.highlightWords;
    }
    if (doc.autoPlayAudioFull === undefined) {
      patch.autoPlayAudioFull = doc.autoPlayAudio ?? DEFAULT_AUTO_PLAY;
    }
    if (doc.languageRepetitionsFull === undefined && doc.languageRepetitions !== undefined) {
      patch.languageRepetitionsFull = doc.languageRepetitions;
    }
    if (doc.languageRepetitionPausesFull === undefined && doc.languageRepetitionPauses !== undefined) {
      patch.languageRepetitionPausesFull = doc.languageRepetitionPauses;
    }
    if (doc.languagePlaybackSpeedsFull === undefined && doc.languagePlaybackSpeeds !== undefined) {
      patch.languagePlaybackSpeedsFull = doc.languagePlaybackSpeeds;
    }
    if (doc.pauseBaseToBaseFull === undefined) {
      patch.pauseBaseToBaseFull = doc.pauseBaseToBase ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
    }
    if (doc.pauseBaseToTargetFull === undefined) {
      patch.pauseBaseToTargetFull = doc.pauseBaseToTarget ?? DEFAULT_PAUSE_BASE_TO_TARGET;
    }
    if (doc.pauseTargetToTargetFull === undefined) {
      patch.pauseTargetToTargetFull = doc.pauseTargetToTarget ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
    }
    if (doc.pauseBeforeAutoAdvanceFull === undefined) {
      patch.pauseBeforeAutoAdvanceFull = doc.pauseBeforeAutoAdvance ?? DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE;
    }

    // Freeze today's Practice Listening defaults for existing users (new
    // courses get Listening ON / only-new 1 stamped at insert time in
    // convex/db/courseSettings.ts).
    if (doc.playTargetBeforeBase === undefined) patch.playTargetBeforeBase = false;
    if (doc.playTargetAfterBase === undefined) patch.playTargetAfterBase = true;
    if (doc.targetBeforeOnlyNewReps === undefined) patch.targetBeforeOnlyNewReps = 0; // 0 = ∞ (always)

    return Object.keys(patch).length > 0 ? patch : undefined;
  },
});

/**
 * Apply the translation post-processing step (default: strip trailing '_'
 * runs — see `postProcessTranslation` in lib/languages.ts) to all existing
 * machine-generated translation rows, covering both `translatedText` and the
 * derived `romanizedText` (Buckwalter-style romanizers map '_' through).
 *
 * User-provided rows are skipped — the step only ever applies to machine
 * output, mirroring the write paths.
 *
 * Deliberately does NOT touch audio: a trailing-underscore diff is
 * punctuation-only, so existing audio stays valid (the same `soundsSame`
 * rule the live retranslation/edit paths use), and direct patches here
 * trigger no ensure-sweep — `audioRecordings` stores no source text.
 */
export function stripTrailingUnderscoresPatch(
  doc: Pick<
    Doc<'translations'>,
    'targetLanguage' | 'translatedText' | 'romanizedText' | 'translationSource'
  >,
): Partial<Doc<'translations'>> | undefined {
  if (doc.translationSource === USER_PROVIDED_TRANSLATION_SOURCE) {
    return undefined;
  }
  const patch: Partial<Doc<'translations'>> = {};
  const text = postProcessTranslation(doc.targetLanguage, doc.translatedText);
  if (text !== doc.translatedText) patch.translatedText = text;
  // The empty-string "tried, failed" sentinel maps to itself and is left
  // alone; only real romanizations can change.
  if (doc.romanizedText !== undefined) {
    const roman = postProcessTranslation(doc.targetLanguage, doc.romanizedText);
    if (roman !== doc.romanizedText) patch.romanizedText = roman;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export const stripTrailingUnderscores = migrations.define({
  table: 'translations',
  migrateOne: (_ctx, doc) => stripTrailingUnderscoresPatch(doc),
});

/** Everything a deploy needs, in order. Completed migrations are skipped. */
export const runAll = migrations.runner([
  internal.migrations.perModeSettingsBackfill,
  internal.migrations.stripTrailingUnderscores,
]);
