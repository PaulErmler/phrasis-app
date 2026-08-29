import type { Doc } from '@/convex/_generated/dataModel';

// ============================================================================
// Shared constants
// ============================================================================

export const DEFAULT_BATCH_SIZE = 5;

// ============================================================================
// Shared types for card data returned by Convex queries
// ============================================================================

/** One stored accepted alternative, with its own generated content. */
export interface CardTranslationAlternative {
  text: string;
  romanization?: string;
  ipa?: string;
  furigana?: string;
  audioUrl?: string | null;
}

export interface CardTranslation {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
  /** IPA transcription (espeak-ng); same display semantics as romanization. */
  ipa?: string;
  /**
   * Bracketed furigana (lib/furigana.ts format). Rendered as ruby OVER the
   * sentence text by ClickableWords, not as an annotation line under it.
   */
  furigana?: string;
  /**
   * AI-feedback accepted alternatives for this card + language (max
   * WRITING_ALTERNATIVES_MAX). Writing mode diffs against the closest of
   * primary + alternatives and lists the others under the answer with
   * their own annotations + audio.
   */
  alternatives?: CardTranslationAlternative[];
  /**
   * True while an LLM retranslation is in flight for this language
   * (server-driven, keyed off `llmTranslationClaims`). Excludes the
   * "regenerate audio" flow, which has no LLM phase. Drives the warning-
   * color "Retranslating" pill in the card header.
   */
  retranslating?: boolean;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface CardAudioRecording {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: WordTiming[] | null;
  /**
   * TTS validation state mirrored from the server. 'unknown' while a synthesis
   * attempt is in flight; 'validated' or 'unvalidated' once the loop finishes.
   * Drives the retranslating-pill logic in the server query. Clients
   * generally don't need to read it directly.
   */
  ttsQuality: string | null;
}

/**
 * The `courseSettings` document, as returned by
 * `api.features.courses.getActiveCourseSettings`. Derived from the schema
 * (`courseSettingsFields` in convex/schema.ts) via the generated `Doc` type —
 * type-only, nothing from the server enters the client bundle — so this can
 * never drift from the validator again. Field semantics and defaults are
 * documented on the schema.
 *
 * The per-mode playback fields resolve along
 * `*Transcribe ?? *Full ?? unsuffixed ?? DEFAULT_*`; that chain is
 * implemented once, in `resolveModeSetting` / `resolveAudioSettings`
 * (lib/audio/mergeAudio.ts) — resolve through those, never inline.
 */
export type CourseSettings = Doc<'courseSettings'>;

/**
 * Writing-mode accuracy for the card currently on screen, aggregated across
 * target languages. Emitted whenever the submitted texts change.
 *
 * Two different numbers, for two different jobs:
 *  - `avg*` is the recorded stat. It keeps the meaning it has always had (mean
 *    across languages) and callers only persist it once `allSubmitted` is true,
 *    so a half-answered card contributes nothing.
 *  - `min*` drives the auto-rating. The weakest language should decide when the
 *    card comes back: a perfect Spanish answer must not mask a failed
 *    Japanese one: and it is available as soon as anything is submitted.
 *
 * Both punctuation variants are always computed, independently of the learner's
 * `ignorePunctuation` setting, so stats can record both series in parallel.
 * All values are 0-100; the `*` fields are null when nothing is submitted yet.
 */
export interface WritingAccuracySummary {
  allSubmitted: boolean;
  submittedCount: number;
  targetCount: number;
  avgWithPunctuation: number | null;
  avgWithoutPunctuation: number | null;
  minWithPunctuation: number | null;
  minWithoutPunctuation: number | null;
}

/** The three accuracy figures sent to `reviewCard`, all 0-100. */
export interface ReviewAccuracyPayload {
  /** Scored under the learner's current setting. The historical series. */
  primary: number;
  /** Always punctuation-counted. */
  strict: number;
  /** Always punctuation-ignored. */
  lenient: number;
}
