import { v, Infer } from 'convex/values';
import { TTS_PROVIDERS } from '../lib/languages';

export const learningStyleValidator = v.union(
  v.literal('casual'),
  v.literal('focused'),
  v.literal('advanced'),
);

export const schedulingPhaseValidator = v.union(
  v.literal('preReview'),
  v.literal('review'),
);

export const currentLevelValidator = v.union(
  v.literal('beginner'),
  v.literal('elementary'),
  v.literal('intermediate'),
  v.literal('upper_intermediate'),
  v.literal('advanced'),
  v.literal('proficient'),
);

// FSRS scheduling state (inner object, wrap with v.optional / v.union as needed)
export const fsrsStateValidator = v.object({
  due: v.number(),
  stability: v.number(),
  difficulty: v.number(),
  elapsedDays: v.number(),
  scheduledDays: v.number(),
  learningSteps: v.number(),
  reps: v.number(),
  lapses: v.number(),
  state: v.number(), // 0=New, 1=Learning, 2=Review, 3=Relearning
  lastReview: v.number(),
});

// Card content validators (used in scheduling and deck query return types)
export const translationValidator = v.object({
  language: v.string(),
  text: v.string(),
  isBaseLanguage: v.boolean(),
  isTargetLanguage: v.boolean(),
  romanization: v.optional(v.string()),
  /** IPA transcription (espeak-ng); same display semantics as romanization. */
  ipa: v.optional(v.string()),
  /**
   * Bracketed furigana (lib/furigana.ts format), rendered as ruby over the
   * sentence rather than as a line under it.
   */
  furigana: v.optional(v.string()),
  /**
   * The user's stored AI-feedback accepted alternatives for this card +
   * language (writingAlternatives table, max WRITING_ALTERNATIVES_MAX).
   * Only populated by getCardForReview — alternatives are card-scoped, so
   * text-scoped queries (decks/library) never carry them. The writing card
   * diffs against the closest of primary + alternatives and lists the rest
   * with their own annotations + audio.
   */
  alternatives: v.optional(
    v.array(
      v.object({
        text: v.string(),
        romanization: v.optional(v.string()),
        ipa: v.optional(v.string()),
        furigana: v.optional(v.string()),
        audioUrl: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  ),
  /**
   * True iff an LLM retranslation is currently in flight for this language:
   * a non-stale row exists in `llmTranslationClaims` for (textId, lang) AND
   * a `translatedText` is already on file (so it's a *re*translation, not
   * the first-time translation of a brand-new card). Drives the warning-
   * color "Retranslating" pill in the card header. Keyed off the LLM claim
   * (not on "audio missing") so it does NOT fire when the user clicks
   * "regenerate audio". That flow has no LLM phase.
   */
  retranslating: v.optional(v.boolean()),
});

export const audioRecordingValidator = v.object({
  language: v.string(),
  voiceName: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
  // Word-level timings from Azure Fast Transcription, captured during TTS validation.
  // The schema field is `v.optional(v.array(...))` so DB rows can be `undefined`,
  // but this validator is stricter: `null | array` only. Callers building a
  // response from a raw audioRecordings row MUST coerce `undefined → null`
  // (`row.wordTimings ?? null`), or this validator will reject the response.
  wordTimings: v.union(
    v.array(
      v.object({
        word: v.string(),
        start: v.number(),
        end: v.number(),
      }),
    ),
    v.null(),
  ),
  // TTS validation status: 'unknown' while a synthesis attempt is in flight
  // (or between retries), 'validated' once transcription matched, 'unvalidated'
  // for languages without STT support or when all retries mismatched. Surfaced
  // so the "Retranslating" pill in the learning view can stay visible while
  // ttsQuality === 'unknown' (the audio row exists but the audio it points
  // to may still be a not-yet-validated synthesis). Nullable for rows that
  // pre-date this field or for placeholders.
  ttsQuality: v.union(v.string(), v.null()),
});

export const reviewModeValidator = v.union(
  v.literal('audio'),
  v.literal('full'),
);

// 'radio' is the single *free play* scheduling mode. The endless, FSRS-free
// round-robin through the whole deck. Which of its two faces you get is
// derived from `reviewMode`, not stored: see `freePlayFace` below.
export const schedulingModeValidator = v.union(
  v.literal('learn_new'),
  v.literal('learnAndReview'),
  v.literal('radio'),
);

// Writing mode: accuracy breakpoints that map a typed answer's score to an
// FSRS rating. Percent points (0-100 integers), lower-inclusive. A score of
// exactly `hard` rates "hard", a score of exactly `good` rates "good". `easy`
// is optional and currently never written by the UI (the control ships with
// three bands); when unset the top band is "good".
// Invariant enforced on write: 0 <= hard <= good <= (easy ?? 100) <= 100.
export const autoRateThresholdsValidator = v.object({
  hard: v.number(),
  good: v.number(),
  easy: v.optional(v.number()),
});

// Source-of-content filter. `undefined` and 'both' behave identically (no filter).
// 'custom' = study/auto-add only cards from collections with origin !== 'premade' (custom + chat).
// 'course' = study/auto-add only cards from collections with origin === 'premade'.
export const studyContentFilterValidator = v.union(
  v.literal('custom'),
  v.literal('course'),
  v.literal('both'),
);

// The six grades a card review can receive: stillLearning/understood in the
// preReview phase, again/hard/good/easy once the card is FSRS-scheduled.
export const reviewRatingValidator = v.union(
  v.literal('stillLearning'),
  v.literal('understood'),
  v.literal('again'),
  v.literal('hard'),
  v.literal('good'),
  v.literal('easy'),
);

// The card fields that `reviewCard` mutates (scheduling state). Single source
// of truth shared by the `cards` table definition and the `reviewLogs.prevCard`
// undo snapshot so the two can never drift.
export const cardSchedulingSnapshotFields = {
  dueDate: v.number(), // Timestamp for spaced repetition scheduling (driven by scheduler)
  schedulingPhase: schedulingPhaseValidator,
  preReviewCount: v.number(), // How many pre-review rounds completed
  fsrsState: v.optional(fsrsStateValidator), // Populated when card enters FSRS review phase
  isGraduated: v.optional(v.boolean()), // One-way flag: true once card graduates from initial learning (FSRS state >= Review)
  lastReviewedAt: v.optional(v.number()), // Timestamp of last review (pre-review, FSRS, and radio plays)
  goodReviewCount: v.optional(v.number()), // # of FSRS good/easy ratings (pre-review "understood" excluded). Drives the "until rated good" Practice-Listening strategy. Undefined = 0 for pre-field cards.
} as const;

// The writing-track counterpart of the scheduling fields above, active only
// while a course has `separateModeTracking` enabled. When the split is on,
// Writing-mode reviews read/write ONLY these fields and Shadowing keeps using
// the shared set above; when it is off (default) both modes use the shared
// set and these lie dormant. The writing track has no pre-review phase
// (Writing mode always forces FSRS via `forceReviewPhase`), hence no
// schedulingPhase/preReviewCount here. Shared by the `cards` table and the
// `reviewLogs.prevWriting` undo snapshot. All optional: unset means "never
// seeded". Writing-track due queries must exclude undefined `writingDueDate`
// via a `.gte('writingDueDate', 0)` lower bound.
export const cardWritingSchedulingFields = {
  writingDueDate: v.optional(v.number()),
  writingFsrsState: v.optional(fsrsStateValidator),
  writingIsGraduated: v.optional(v.boolean()), // One-way flag, same semantics as isGraduated (FSRS state >= Review)
  writingLastReviewedAt: v.optional(v.number()),
  writingGoodReviewCount: v.optional(v.number()),
} as const;

// Which per-card schedule a review reads/writes: the shared (audio/legacy)
// fields or the writing-track fields. Derived, never stored on courseSettings:
// 'writing' iff `separateModeTracking` is on AND `reviewMode === 'full'`.
export const schedulingTrackValidator = v.union(
  v.literal('shared'),
  v.literal('writing'),
);
export type SchedulingTrack = Infer<typeof schedulingTrackValidator>;

/** The schedule a review touches, given the course's settings. */
export function schedulingTrackFromSettings(settings: {
  separateModeTracking?: boolean;
  reviewMode?: ReviewMode;
}): SchedulingTrack {
  return settings.separateModeTracking === true &&
    (settings.reviewMode ?? 'audio') === 'full'
    ? 'writing'
    : 'shared';
}

// The card fields free play mutates in its LISTENING face (minus
// `lastReviewedAt`, which lives in the scheduling set above). Shared by the
// `cards` table and the `reviewLogs.prevRadio` undo snapshot.
export const cardRadioSnapshotFields = {
  radioRoundCounter: v.optional(v.number()), // Radio mode: # of times this card has been played in radio mode. Lowest counter plays next; new cards default to 0 so they play first. Optional for backward compat — undefined treated as 0.
  radioOrderKey: v.optional(v.number()), // Radio mode: random tiebreak within equal `radioRoundCounter`. Re-rolled on each play so the round-robin order shuffles every loop and never matches the review (`dueDate`-driven) order. Optional for backward compat.
  radioPlayCount: v.optional(v.number()), // Radio mode: true count of radio plays (+1 per play, NOT subject to radioRoundCounter's catch-up jump). Drives the "Only new" Practice-Listening limit. Optional/undefined for pre-existing cards — treated as the card's review count (preReviewCount + FSRS reps) so they don't reset to "new".
} as const;

// Free Study's rotation state. The writing-face counterpart of the radio
// fields above, deliberately separate so the two faces shuffle and track
// independently (listening to a card must not count as having typed it).
// Shared by the `cards` table and the `reviewLogs.prevFreeStudy` undo
// snapshot. Same undefined-first index semantics as radio: no backfill,
// unplayed cards sort first.
export const cardFreeStudySnapshotFields = {
  freeStudyRoundCounter: v.optional(v.number()), // Rotation position; lowest plays next, undefined treated as 0.
  freeStudyOrderKey: v.optional(v.number()), // Random tiebreak within equal counters, re-rolled on each play.
  freeStudyPlayCount: v.optional(v.number()), // True +1-per-play count ("has this card been studied here yet?"). Unlike radioPlayCount it seeds from 0, not the review count — it has no Practice-Listening consumer.
} as const;

export const ttsQualityValidator = v.union(
  v.literal('unknown'),
  v.literal('validated'),
  v.literal('unvalidated'),
);

// Single source of truth for the provider list is `TTS_PROVIDERS` in
// lib/languages.ts; this validator (for stored `audioRecordings.ttsProvider`)
// is built from it so the two can't drift. Indexed access keeps the exact
// string-literal union for `Infer`. 'gemini' = Gemini 3.1 Flash TTS and
// 'minimax' = MiniMax Speech 2.8 Turbo, both via OpenRouter's /audio/speech
// endpoint (distinct from 'google' = Cloud Chirp3).
// 'elevenlabs' (index 1) and 'azure' (index 2) are retired providers retained
// only so historical stored values still validate, neither is dispatchable
// (Azure Speech remains in use for STT only; see convex/lib/stt).
export const ttsProviderValidator = v.union(
  v.literal(TTS_PROVIDERS[0]),
  v.literal(TTS_PROVIDERS[1]),
  v.literal(TTS_PROVIDERS[2]),
  v.literal(TTS_PROVIDERS[3]),
  v.literal(TTS_PROVIDERS[4]),
);

export const voiceGenderValidator = v.union(
  v.literal('male'),
  v.literal('female'),
);

/**
 * TTS scheduling priority. 'interactive' work is (or will imminently be) on a
 * user's screen: cards in their deck, an audio-icon click, the placement
 * sentence in front of them. 'background' work warms content nobody is
 * waiting on (collection previews, deferred placement batches, admin
 * warmups, bulk custom-card import). Interactive jobs run in `ttsPool`; background jobs run in the
 * low-parallelism `ttsWarmPool` and only take rate-limit tokens that are
 * free immediately (see workpools.ts / rateLimitReserve.ts), so a signup
 * burst of warm jobs can no longer queue ahead of the audio the user is
 * staring at. Absent means 'interactive': deprioritizing is opt-in at the
 * warm call sites.
 */
export const ttsPriorityValidator = v.union(
  v.literal('interactive'),
  v.literal('background'),
);
export type TtsPriority = Infer<typeof ttsPriorityValidator>;

/**
 * LLM translation scheduling priority. Same classification rule as
 * `ttsPriorityValidator`, applied to the translation itself rather than the
 * audio it triggers: 'background' is work nobody is waiting on (the onboarding
 * translation warmup, the admin chart-language warmup), everything else is
 * interactive. Interactive jobs run in `llmPool`, background jobs in the
 * low-parallelism `llmWarmPool` (see workpools.ts). Absent means
 * 'interactive'.
 *
 * Deliberately a SEPARATE type from `TtsPriority` even though the literals
 * match. The two travel together through the same job args, where `priority`
 * means "the tier the audio this translation triggers should run at" and
 * `llmPriority` means "the tier this translation runs at". They diverge in
 * practice: a collection preview requests background audio for an interactive
 * translation, and `storeTranslationAndScheduleTTS` rewrites `priority`
 * mid-flight (features/decks.ts) in a way that must not touch the LLM tier.
 */
export const llmPriorityValidator = v.union(
  v.literal('interactive'),
  v.literal('background'),
);
export type LlmPriority = Infer<typeof llmPriorityValidator>;

/**
 * Narrow a loosely-typed string to a strict voice gender, or `undefined` when
 * it is neither. Use at boundaries where a `v.string()`-typed value (e.g.
 * `texts.audioSpeakerGender`, or a queued job's `audioSpeakerGender`) flows
 * into a strict `voiceGenderValidator` field such as `translations.speakerGender`.
 */
export function asVoiceGender(
  value: string | undefined,
): 'male' | 'female' | undefined {
  return value === 'male' || value === 'female' ? value : undefined;
}

export const cardApprovalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

// What the approval row proposes. Absent = 'createCard' (rows predate the
// field). 'alsoCorrect' rows reference an existing card via `cardId` and
// offer two accept paths (new card / replace) instead of one.
export const cardApprovalKindValidator = v.union(
  v.literal('createCard'),
  v.literal('alsoCorrect'),
);

// Which accept path resolved an 'alsoCorrect' approval. Stored alongside
// status 'approved' ('rejected' rows never carry one).
export const cardApprovalResolutionValidator = v.union(
  v.literal('newCard'),
  v.literal('replaced'),
  // Stored as a writingAlternatives row (card forked to user-owned, text
  // unchanged). The default accept path since alternatives exist; 'replaced'
  // remains for rows resolved before that and for the server mutation.
  v.literal('alternative'),
);

// Content provenance of a collection, denormalized onto `cards` and the
// `cardEdits` audit rows. Kept here so the three schema sites can't drift.
export const collectionOriginValidator = v.union(
  v.literal('premade'),
  v.literal('custom'),
  v.literal('chat'),
);

/**
 * The bucket space shared by the card aggregates
 * (`db/stats/cardAggregates.ts`) and `dailyStats.newCardsByOrigin`: the three
 * collection origins plus 'none' for a card that belongs to no collection
 * (legacy rows whose `collectionOrigin` was never resolved).
 *
 * Declared HERE, not next to the aggregates, so that `schema.ts` can reach it
 * without pulling `@convex-dev/aggregate` and `components` into the schema's
 * module graph. Everything below derives from this one list; adding a fifth
 * origin should mean editing this line and nothing else.
 */
export const ORIGIN_BUCKETS = ['premade', 'custom', 'chat', 'none'] as const;
export type OriginBucket = (typeof ORIGIN_BUCKETS)[number];

export const collectionOriginBucketValidator = v.union(
  collectionOriginValidator,
  v.literal('none'),
);

/**
 * Shape of `dailyStats.newCardsByOrigin`. Spelled out rather than derived from
 * `ORIGIN_BUCKETS` via `Object.fromEntries`, which would erase the per-key
 * types Convex needs; this is the single place it is spelled.
 */
export const newCardsByOriginValidator = v.object({
  premade: v.number(),
  custom: v.number(),
  chat: v.number(),
  none: v.number(),
});
export type NewCardsByOrigin = Infer<typeof newCardsByOriginValidator>;

/** Empty split to seed a row that carries none yet. */
export const ORIGIN_BUCKET_ZEROS: NewCardsByOrigin = Object.freeze({
  premade: 0,
  custom: 0,
  chat: 0,
  none: 0,
});

/**
 * Total across every bucket. Note this is NOT guaranteed to equal the row's
 * `newCards`: see the `newCardsByOrigin` comment in `schema.ts`.
 */
export function sumOriginBuckets(split: NewCardsByOrigin): number {
  return ORIGIN_BUCKETS.reduce((acc, b) => acc + split[b], 0);
}

// ============================================================================
// Card-edit audit log (convex/features/cardEditAudit.ts)
// ============================================================================

/**
 * Which gesture produced a `cardEdits` row. Kept as an explicit discriminator
 * rather than inferred from the row's shape: the three gestures have different
 * retranslation policies and are the unit later analytics will group by.
 */
export const cardEditKindValidator = v.union(
  v.literal('manual_edit'), // the Edit Card dialog (features/scheduling:editCard)
  v.literal('chat_also_correct'), // chat replace (chat/cardApprovals)
  v.literal('flag'), // the Flag button (features/scheduling:flagTranslation)
);
export type CardEditKind = Infer<typeof cardEditKindValidator>;

/**
 * Copy-on-write path `applyCardEdit` took. 'fork' means the card document was
 * replaced (new `_id`) because the underlying text is shared; 'none' is a flag,
 * which writes no text at all.
 */
export const cardEditPathValidator = v.union(
  v.literal('in_place'),
  v.literal('fork'),
  v.literal('none'),
);

/**
 * A language's role in the course AT EDIT TIME. Snapshotted rather than joined:
 * `courses.baseLanguages` / `targetLanguages` are user-editable, so a later
 * course change would silently rewrite the history of every past edit. A
 * language can sit in both arrays, hence 'both'.
 */
export const cardEditLanguageRoleValidator = v.union(
  v.literal('base'),
  v.literal('target'),
  v.literal('both'),
);
export type CardEditLanguageRole = Infer<typeof cardEditLanguageRoleValidator>;

/**
 * Lifecycle of one retranslation an edit or flag triggered. Every value maps to
 * a specific, reachable outcome in the pipeline:
 *
 *   enqueued               claim won, job handed to the workpool
 *   applied                storeTranslationAndScheduleTTS wrote the new wording
 *   applied_audio_kept     ditto, but `soundsSame` so the audio was retained
 *   skipped_capped         flagCount past FLAG_AUTO_RETRANSLATION_MAX
 *   skipped_claim_contested  another job already owned (textId, language)
 *   dropped_superseded     expectedClaimId mismatch: a reclaim won the row
 *   dropped_text_deleted   the text was cascade-deleted mid-flight
 *   refused_user_created   the user-created provenance backstop refused it
 *   fell_back_to_google    the LLM exhausted its retries; Google took over
 *   failed                 terminal: the fallback failed too
 */
export const retranslationStatusValidator = v.union(
  v.literal('enqueued'),
  v.literal('applied'),
  v.literal('applied_audio_kept'),
  v.literal('skipped_capped'),
  v.literal('skipped_claim_contested'),
  v.literal('dropped_superseded'),
  v.literal('dropped_text_deleted'),
  v.literal('refused_user_created'),
  v.literal('fell_back_to_google'),
  v.literal('failed'),
);
export type RetranslationStatus = Infer<typeof retranslationStatusValidator>;

/**
 * Why a translation job was requested. Threaded through the LLM job args so the
 * worker can branch on the REASON instead of reconstructing it from a
 * conjunction of unrelated flags (`replaceExisting` + a rules-slug allowlist),
 * which conflated the storage semantic with the user's intent and could not
 * tell "a user flagged this as wrong" from "a user retyped it as X".
 *
 * Absent means 'fill' — the value for jobs enqueued before this field existed
 * and still in flight across a deploy.
 */
export const translationReasonValidator = v.union(
  v.literal('fill'), // fill or regenerate a missing/stale language
  v.literal('flag'), // the user flagged the translation as wrong
  v.literal('curriculum_fix'), // the user retyped a curriculum translation
);
export type TranslationReason = Infer<typeof translationReasonValidator>;

/**
 * The two reasons that mean "a user is telling us this translation is wrong".
 * Both carry the user's own wording and want the previous translation in the
 * prompt; 'fill' wants neither.
 */
export function isRetranslationReason(
  reason: TranslationReason | undefined,
): boolean {
  return reason === 'flag' || reason === 'curriculum_fix';
}

// Metadata changes the chat model proposes with markAlsoCorrect, only the
// fields the new phrasing actually changes are present. Applied on the
// replace path via the applyMetadataAndPrepareCard mechanism (so a speaker
// gender change re-voices audio); the new-card path re-infers metadata.
//
// The value tuples are the single source for both this stored shape and the
// zod tool schema in chat/agent.ts (`z.enum(...)`), so the model-facing
// contract and the document validator can't drift apart. The matching
// `texts` columns stay loose strings (legacy rows predate the enums).
export const SPEAKER_GENDER_VALUES = ['male', 'female', 'neutral'] as const;
export const REGISTER_VALUES = ['formal', 'informal', 'neutral'] as const;
export const ADDRESSEE_GENDER_VALUES = [
  'male',
  'female',
  'neutral',
  'not_applicable',
] as const;
export const ADDRESSEE_NUMBER_VALUES = [
  'singular',
  'plural',
  'not_applicable',
] as const;

const literalUnion = <T extends readonly string[]>(values: T) =>
  v.union(...values.map((value: T[number]) => v.literal(value)));

export const proposedCardMetadataValidator = v.object({
  speakerGender: v.optional(literalUnion(SPEAKER_GENDER_VALUES)),
  register: v.optional(literalUnion(REGISTER_VALUES)),
  addresseeGender: v.optional(literalUnion(ADDRESSEE_GENDER_VALUES)),
  addresseeNumber: v.optional(literalUnion(ADDRESSEE_NUMBER_VALUES)),
  addressesSomeone: v.optional(v.boolean()),
});

// Per-feature quota snapshot mirrored from Autumn (usageQuotas.features
// values). Lives here (not in usage/helpers.ts, which re-exports it) so
// schema.ts can share it without importing `_generated/server`.
export type FeatureState = {
  balance: number;
  included: number;
  used: number;
  interval?: string;
  unlimited?: boolean;
};

export const featureStateValidator = v.object({
  balance: v.number(),
  included: v.number(),
  used: v.number(),
  interval: v.optional(v.string()),
  unlimited: v.optional(v.boolean()),
});

// Per-review-mode counters shared by the stats tables (courseStats
// totalReviewsByMode, dailyStats reviewsByMode/timeMsByMode, and the
// weekly/monthly/yearly reviewsByMode). Wrap with v.optional at call sites.
export const reviewsByModeValidator = v.object({
  audio: v.number(),
  full: v.number(),
  radio: v.optional(v.number()),
  freeStudy: v.optional(v.number()),
});

// Union of the per-mode stat bucket keys above ('audio' | 'full' | 'radio' |
// 'freeStudy'). Single source of truth for the stats writers' `reviewMode`
// parameters so a new mode can't be added to the validator but missed there.
export type StatsReviewMode = keyof Infer<typeof reviewsByModeValidator>;

// Which slice of a per-mode counter (reps or time) a home-card tile shows.
// Tapping a tile cycles all -> learn -> radio -> freeStudy; each tile stores
// its own choice on userSettings (`repsStatFilter`, `timeStatFilter`).
// 'learn' is the graded FSRS reviews, 'radio' and 'freeStudy' are the two
// free-play buckets above, shown separately. Unset ≡ 'all'.
export const statFilterValidator = v.union(
  v.literal('all'),
  v.literal('learn'),
  v.literal('radio'),
  v.literal('freeStudy'),
);

// `{language, text}` translation-entry list used by the cardApprovals
// table/mutations. Also the stored document shape. Do not widen; producers
// that carry provenance use `sourcedTranslationEntriesValidator` below.
export const translationEntriesValidator = v.array(
  v.object({ language: v.string(), text: v.string() }),
);

// Translation entries plus optional provenance, shared by the custom-text
// producers (`createCustomText` args, `autoFillTranslations` returns) and the
// sentence-metadata job args:
// - `regionVariant`: concrete regional sub-locale chosen for a row whose
//   `language` is a mixed-dialect code (today: `es_mixed` → e.g. `'es-US'`),
//   persisted on the translations row so downstream audio synthesis and STT
//   validation honor the variant the LLM actually produced.
// - `translationSource`: id of the LLM that produced the text, or
//   `'user-provided'` for manually-typed entries, persisted so a future
//   strategy swap can target rows by source.
// Consumers that only read `{language, text}` (the sentence-metadata job)
// still accept this shape, requiring callers to strip the extras caused a
// production ArgumentValidationError.
export const sourcedTranslationEntriesValidator = v.array(
  v.object({
    language: v.string(),
    text: v.string(),
    regionVariant: v.optional(v.string()),
    translationSource: v.optional(v.string()),
  }),
);

export type LearningStyle = Infer<typeof learningStyleValidator>;
export type StudyContentFilter = Infer<typeof studyContentFilterValidator>;
export type ReviewRating = Infer<typeof reviewRatingValidator>;
export type CurrentLevel = Infer<typeof currentLevelValidator>;
export type ReviewMode = Infer<typeof reviewModeValidator>;
export type SchedulingMode = Infer<typeof schedulingModeValidator>;
export type FsrsState = Infer<typeof fsrsStateValidator>;
export type TtsQuality = Infer<typeof ttsQualityValidator>;
export type TtsProvider = Infer<typeof ttsProviderValidator>;
export type VoiceGender = Infer<typeof voiceGenderValidator>;
export type CardApprovalStatus = Infer<typeof cardApprovalStatusValidator>;
export type CardApprovalKind = Infer<typeof cardApprovalKindValidator>;
export type CardApprovalResolution = Infer<
  typeof cardApprovalResolutionValidator
>;
export type ProposedCardMetadata = Infer<typeof proposedCardMetadataValidator>;

/**
 * Free play ('radio') is ONE scheduling mode with two faces, chosen by the
 * review mode rather than stored:
 *
 *   Shadowing (`reviewMode: 'audio'`) → "Radio":      hands-free listening loop
 *   Writing   (`reviewMode: 'full'`)  → "Free Study": user-paced typing loop
 *
 * The faces share the round-robin mechanic but keep entirely separate per-card
 * rotation state (`cards.radio*` vs `cards.freeStudy*`, one index pair each),
 * so practising a card by listening never counts as having typed it, and vice
 * versa. Switching the review-mode toggle therefore switches queue AND
 * presentation live, mid-session.
 *
 * The face is also the value stored in `reviewLogs.kind`, which is what lets
 * undo restore the right rotation snapshot.
 */
export type FreePlayFace = 'radio' | 'freeStudy';

/** The active free-play rotation, or null when not in free play. */
export function freePlayFace(
  schedulingMode: SchedulingMode,
  reviewMode: ReviewMode,
): FreePlayFace | null {
  if (schedulingMode !== 'radio') return null;
  return reviewMode === 'audio' ? 'radio' : 'freeStudy';
}
