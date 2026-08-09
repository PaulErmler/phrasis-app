import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  learningStyleValidator,
  pushPlatformValidator,
  currentLevelValidator,
  reviewModeValidator,
  cardApprovalStatusValidator,
  schedulingModeValidator,
  studyContentFilterValidator,
  autoRateThresholdsValidator,
  reviewRatingValidator,
  cardSchedulingSnapshotFields,
  cardRadioSnapshotFields,
  cardFreeStudySnapshotFields,
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
  featureStateValidator,
  reviewsByModeValidator,
  translationEntriesValidator,
} from './types';


// Field validators for the `courseSettings` table. Extracted so that queries
// returning a full `courseSettings` document can share the shape with the
// schema and avoid drift.
export const courseSettingsFields = {
  courseId: v.id('courses'),
  initialReviewCount: v.number(), // How many times a card is shown before FSRS scheduling
  activeCollectionId: v.optional(v.id('collections')),
  cardsToAddBatchSize: v.optional(v.number()), // How many cards to add at once
  autoAddCards: v.optional(v.boolean()), // Auto-add cards when none are due

  // Audio playback settings
  highlightWords: v.optional(v.boolean()), // Karaoke-style word highlighting during audio playback. Default OFF — only `=== true` enables it. Most languages now have `supportsKaraoke: false` in lib/languages.ts; this user-level switch is the secondary opt-in for the ones that do support it.
  autoPlayAudio: v.optional(v.boolean()), // Auto-play audio when card is shown
  autoAdvance: v.optional(v.boolean()), // Auto-advance after audio finishes
  languageRepetitions: v.optional(v.record(v.string(), v.number())), // e.g. { "en": 2, "es": 2 }
  languageRepetitionPauses: v.optional(v.record(v.string(), v.number())), // per-language pause between repeats (seconds)
  languagePlaybackSpeeds: v.optional(v.record(v.string(), v.number())), // e.g. { "en": 1.0, "es": 0.9 }; range PLAYBACK_SPEED_MIN-PLAYBACK_SPEED_MAX (see lib/constants/audioPlayback); missing = 1.0. Pitch-preserved via HTMLMediaElement.preservesPitch for single clips and SoundTouchJS for the merged WAV.
  pauseBaseToBase: v.optional(v.number()), // seconds between different base languages
  pauseBaseToTarget: v.optional(v.number()), // seconds between base and (after) target sections
  pauseTargetToTarget: v.optional(v.number()), // seconds between different target languages (both before- and after-base groups)
  pauseBeforeAutoAdvance: v.optional(v.number()), // seconds to wait before auto-advancing to next card
  // Writing ("full") mode counterparts of the audio-playback settings above.
  // The unsuffixed fields remain authoritative for audio/Shadowing mode (and
  // radio); writing mode resolves `*Full ?? unsuffixed ?? DEFAULT_*`, so
  // undefined means "same as audio" for unmigrated docs. See
  // docs/migrations/per-mode-settings-backfill.md.
  highlightWordsFull: v.optional(v.boolean()),
  autoPlayAudioFull: v.optional(v.boolean()),
  languageRepetitionsFull: v.optional(v.record(v.string(), v.number())),
  languageRepetitionPausesFull: v.optional(v.record(v.string(), v.number())),
  languagePlaybackSpeedsFull: v.optional(v.record(v.string(), v.number())),
  pauseBaseToBaseFull: v.optional(v.number()),
  pauseBaseToTargetFull: v.optional(v.number()),
  pauseTargetToTargetFull: v.optional(v.number()),
  pauseBeforeAutoAdvanceFull: v.optional(v.number()),
  // Transcribe writing style: its own copy of the playback settings, so
  // Translate and Transcribe tweak independently. Resolution chain:
  // `*Transcribe ?? *Full ?? unsuffixed ?? DEFAULT_*` — undefined means
  // "same as Translate". Only the settings transcribe actually uses get a
  // copy (target reps/pauses/speeds, target↔target pause, auto-play,
  // highlighting); base-group pauses and auto-advance don't apply there.
  highlightWordsTranscribe: v.optional(v.boolean()),
  autoPlayAudioTranscribe: v.optional(v.boolean()),
  languageRepetitionsTranscribe: v.optional(v.record(v.string(), v.number())),
  languageRepetitionPausesTranscribe: v.optional(v.record(v.string(), v.number())),
  languagePlaybackSpeedsTranscribe: v.optional(v.record(v.string(), v.number())),
  pauseTargetToTargetTranscribe: v.optional(v.number()),
  // Transcribe writing style: independent settings for the post-submit target
  // replay (the pre-submit prompt uses the `*Transcribe` records above).
  // Missing entry = 1 repetition at the prompt speed.
  transcribeAfterRepetitions: v.optional(v.record(v.string(), v.number())),
  transcribeAfterRepetitionPauses: v.optional(v.record(v.string(), v.number())),
  transcribeAfterPlaybackSpeeds: v.optional(v.record(v.string(), v.number())),
  // Target-before-base ("Practice Listening") vs target-after-base ("Practice Speaking").
  // At least one must be enabled; the client enforces this. Defaults reproduce the
  // historical base→target sequence (after on, before off).
  playTargetBeforeBase: v.optional(v.boolean()), // play target language(s) before base ("Practice Listening", default off)
  playTargetAfterBase: v.optional(v.boolean()), // play target language(s) after base ("Practice Speaking", default on)
  // Independent settings for the before-base target group (the after-base group reuses
  // languageRepetitions / languageRepetitionPauses / languagePlaybackSpeeds).
  targetBeforeRepetitions: v.optional(v.record(v.string(), v.number())), // reps per target lang, before-base group
  targetBeforeRepetitionPauses: v.optional(v.record(v.string(), v.number())), // between-rep pause per target lang, before-base group
  targetBeforePlaybackSpeeds: v.optional(v.record(v.string(), v.number())), // playback speed per target lang, before-base group; clamped PLAYBACK_SPEED_MIN-MAX
  pauseTargetToBase: v.optional(v.number()), // seconds between the before-base target group and the base group (mirror of pauseBaseToTarget)
  // "Only new": with BOTH Practice Listening and Practice Speaking on, play
  // target-before-base ("Practice Listening") only on a card's initial N reviews,
  // then graduate it to target-after-base ("Practice Speaking"). Only takes
  // effect when both are on; with Speaking off it's treated as ∞ (Listening
  // always plays) and the sub-setting is hidden in the UI.
  // 0 / undefined = always (∞, the default); 1-10 = limit. The review count is
  // preReviewCount + FSRS reps in audio mode, and max(that, radioPlayCount)
  // in radio mode (radio plays don't bump the FSRS review count).
  targetBeforeOnlyNewReps: v.optional(v.number()),
  // Practice Listening duration strategy — when a card graduates from
  // Listening (target-before-base) to Speaking-only:
  //   'onlyNew'    — after the card's first targetBeforeOnlyNewReps reviews;
  //   'untilGood'  — after targetBeforeUntilGoodReps FSRS good/easy ratings
  //                  (pre-review "Understood" doesn't count, see
  //                  cards.goodReviewCount);
  //   'continuous' — never (Listening plays on every review).
  // Unset = legacy docs from before the strategy existed; resolveAudioSettings
  // infers it from targetBeforeOnlyNewReps (>0 → 'onlyNew', else 'continuous',
  // matching the old "0/undefined = ∞" convention). Each strategy keeps its
  // own X so switching back and forth is lossless.
  targetBeforeListeningStrategy: v.optional(
    v.union(
      v.literal('onlyNew'),
      v.literal('untilGood'),
      v.literal('continuous'),
    ),
  ),
  targetBeforeUntilGoodReps: v.optional(v.number()), // 1-10, default 1 (no ∞ — that's 'continuous')
  // Writing mode: show the target translation above the input on a card's
  // first N reviews so the user copy-types it ("Abschreiben"); the unassisted
  // test starts afterwards. Unset = true (on). The rep window mirrors
  // targetBeforeOnlyNewReps: 0 = always show (∞), 1-10 = first N reviews
  // (preReviewCount + FSRS reps), default 1.
  showTranslationOnNew: v.optional(v.boolean()),
  showTranslationOnlyNewReps: v.optional(v.number()),
  showProgressBar: v.optional(v.boolean()), // whether to show the audio progress bar
  progressDisplayEnabled: v.optional(v.boolean()), // celebrate every PROGRESS_DISPLAY_INTERVAL reviews (default true)
  hideTargetLanguages: v.optional(v.boolean()), // blur target language text by default
  autoRevealLanguages: v.optional(v.boolean()), // unblur target text when its audio starts playing
  hideBaseLanguages: v.optional(v.boolean()), // blur base language text by default (default off)
  autoRevealBaseLanguages: v.optional(v.boolean()), // unblur base text when its audio starts playing
  hideBaseLanguagesFull: v.optional(v.boolean()), // writing mode: blur base language text by default (default: on in Transcribe, off in Translate; independent of the audio-mode hideBaseLanguages)
  autoRevealBaseOnSubmit: v.optional(v.boolean()), // writing mode: unblur base text once all translations are submitted (default on; sub-setting of hideBaseLanguagesFull)
  showRomanization: v.optional(v.boolean()), // show Latin transliteration below non-Latin script text
  // Language order overrides
  baseLanguageOrder: v.optional(v.array(v.string())), // ordered ISO codes for base languages
  targetLanguageOrder: v.optional(v.array(v.string())), // ordered ISO codes for target languages
  // Instant proceed on rating (per mode)
  instantProceedAudio: v.optional(v.boolean()), // auto-advance when rating is clicked (audio mode, default false)
  instantProceedFull: v.optional(v.boolean()), // auto-advance when rating is clicked (full mode, default true)
  // Review mode
  reviewMode: v.optional(reviewModeValidator), // 'audio' (default) or 'full'
  // Daily study-time goal in minutes. Seeded from the user's onboarding
  // answer when the course is created by `completeOnboarding`. Lives
  // here rather than `userSettings` because the goal is per-course
  // (different courses can have different pacing targets).
  dailyTimeGoalMinutes: v.optional(v.number()),
  // Scheduling mode
  // 'learnAndReview' (default), 'learn_new', or 'radio' — the single free-play
  // mode: round-robin through the whole deck, no FSRS. Free play has two faces
  // chosen by `reviewMode` (Radio while listening, Free Study while typing),
  // each with its own card rotation; the face is derived, never stored. See
  // `freePlayFace` in convex/types.ts.
  schedulingMode: v.optional(schedulingModeValidator),
  fullReviewTargetAudioMode: v.optional(
    v.union(v.literal('always'), v.literal('afterSubmit'), v.literal('never')),
  ), // When to play target audio in full review mode
  // Writing-mode input style: 'translate' (default — base audio plays, user
  // types the translation) or 'transcribe' (target audio plays alone, user
  // types what they hear). Ignored in audio mode.
  writingInputMode: v.optional(
    v.union(v.literal('translate'), v.literal('transcribe')),
  ),
  // Writing mode: drop punctuation from the accuracy score, so a missing
  // comma or full stop costs nothing. Unset = false = punctuation counts
  // (at PUNCT_WEIGHT, see lib/textCompare/score.ts).
  ignorePunctuation: v.optional(v.boolean()),
  // Writing mode: preselect the FSRS rating from the typed answer's accuracy
  // instead of always defaulting to "good". Unset = true (on by default); the
  // rating is only ever preselected, never auto-submitted.
  autoRateFromAccuracy: v.optional(v.boolean()),
  // Accuracy breakpoints for the above. Unset = DEFAULT_AUTO_RATE_THRESHOLDS
  // in lib/autoRating.ts (50 / 80).
  autoRateThresholds: v.optional(autoRateThresholdsValidator),
  // Show which collection each card came from (e.g. "A1.2") as a pill in the
  // card header while learning. Unset = false = hidden.
  showCardOrigin: v.optional(v.boolean()),
  chatCollectionId: v.optional(v.id('collections')), // Per-course collection for chat-approved texts
  customCollectionId: v.optional(v.id('collections')), // Per-course collection for manually entered texts
  activeCustomCollectionIds: v.optional(v.array(v.id('collections'))), // Selected custom collections for auto-add
  reconciledDatasetId: v.optional(v.id('datasets')), // Dataset version this course's progress has been cutover to (idempotency gate for datasetMigration_cutoverUser)
  // Source-of-content filter — see studyContentFilterValidator in types.ts.
  studyContentFilter: v.optional(studyContentFilterValidator),
  // Current "between celebrations" bucket id. Rotated by the client on
  // celebration dismiss (via `setCurrentSessionId`). Stored server-side so
  // the bucket survives the user closing the learn view OR moving to a
  // different device — `getNewWordsForCelebration` then keeps counting words
  // toward the same milestone instead of restarting from zero on each remount.
  currentSessionId: v.optional(v.string()),
} as const;

// Full `courseSettings` document validator (includes system fields).
export const courseSettingsDocValidator = v.object({
  _id: v.id('courseSettings'),
  _creationTime: v.number(),
  ...courseSettingsFields,
});

// The subset of course settings that `updateCourseSettings`
// (convex/features/courses.ts) accepts and may patch, derived from the
// canonical field set above so the two can't drift. Omits `courseId` (a
// separate required arg there) and the fields managed by dedicated flows
// (collection wiring, dataset reconciliation, session id); `.partial()`
// because a patch supplies only the fields it changes.
// `dailyTimeGoalMinutes` is patchable (goal editors on home/settings);
// the user's original onboarding answer stays preserved on the frozen
// `onboardingProgress` row.
export const coursePatchableSettingsValidator = v
  .object(courseSettingsFields)
  .omit(
    'courseId',
    'activeCollectionId',
    'chatCollectionId',
    'customCollectionId',
    'activeCustomCollectionIds',
    'reconciledDatasetId',
    'currentSessionId',
  )
  .partial();

// Field validators for the `onboardingProgress` table. Extracted (mirroring
// `courseSettingsFields`) so the onboarding query/mutation validators in
// convex/features/courses.ts can share the shape with the schema and avoid
// drift.
export const onboardingProgressFields = {
  userId: v.string(), // Links to auth user
  step: v.number(), // Current step number in the new flow
  reviewMode: v.optional(reviewModeValidator),
  currentLevel: v.optional(currentLevelValidator),
  targetLanguages: v.optional(v.array(v.string())),
  baseLanguages: v.optional(v.array(v.string())),
  // Survey answers.
  acquisitionSource: v.optional(v.string()),
  acquisitionSourceFreeText: v.optional(v.string()),
  learningGoals: v.optional(v.array(v.string())),
  learningGoalFreeText: v.optional(v.string()),
  dailyTimeGoalMinutes: v.optional(v.number()),
  // Placement-test working state. `history` accumulates as the user answers;
  // `finalLevel` is set when the strategy reports `nextQuestionLevel() === null`.
  placementTest: v.optional(
    v.object({
      // Schema-version of the placement state. Bump
      // CURRENT_PLACEMENT_STRATEGY_VERSION in
      // app/app/onboarding/lib/placementStrategies.ts whenever the shape
      // of `history`/`strategy`/`finalLevel` changes — readers discard
      // rows whose version doesn't match (kill-switch for resuming
      // incompatible state). Optional so historical rows (written before
      // this field existed) still validate; treat missing as version 0
      // and discard on read.
      strategyVersion: v.optional(v.number()),
      strategy: v.string(), // 'bayesian' | 'binary' | 'staircase'
      history: v.array(
        v.object({ level: v.number(), knew: v.boolean() }),
      ),
      finalLevel: v.optional(v.number()),
    }),
  ),
  // Number of cards the user has rated inside the embedded first lesson.
  // Persisted so a reload mid-lesson resumes at the right card count and
  // re-seeds which staged tutorials have already fired.
  firstLessonCardsRated: v.optional(v.number()),
  // Underlying `studySessions` row id for the embedded first lesson —
  // captured on the first rated card and replayed into `useLearningMode`
  // on the next mount so X/N progress and the +N new-words hero stay
  // continuous across a mid-flow reload.
  firstLessonSessionId: v.optional(v.string()),
  // Snapshot of the embedded first-lesson session — written when the
  // lesson completes (or skipped). Keeps the stats-recap +
  // word-projection screens alive across a mid-flow reload.
  firstLessonSummary: v.optional(
    v.object({
      cardsRated: v.number(),
      sessionId: v.string(),
      dailyReviewsToday: v.number(),
      dailyTimeMsToday: v.number(),
      dailyNewWordsToday: v.number(),
    }),
  ),
  // Set by `finalizeOnboarding` (replaces the previous delete). When
  // undefined, the row is in-progress and is the only row the wizard
  // reads / writes. When set, the row is the permanent record of the
  // user's onboarding answers — `getOnboardingProgress` filters these
  // out so completed rows can't be accidentally re-edited.
  completedAt: v.optional(v.number()),
} as const;

// Full `onboardingProgress` document validator (includes system fields).
export const onboardingProgressDocValidator = v.object({
  _id: v.id('onboardingProgress'),
  _creationTime: v.number(),
  ...onboardingProgressFields,
});

export default defineSchema({
  // Datasets table - versioned premade content sets. A dataset is a corpus of
  // texts (whose own language lives on `texts.language`) fanned out to every
  // target language via the `translations` table — so at most one dataset is
  // `isActive: true` at a time, globally. Inactive rows remain in place for
  // rollback and historical reference.
  datasets: defineTable({
    slug: v.string(), // e.g. "ogte-curated"
    version: v.string(), // e.g. "1.0.0"
    publishedAt: v.number(),
    isActive: v.boolean(),
    manifestStorageId: v.optional(v.id('_storage')),
    description: v.optional(v.string()),
  })
    .index('by_slug_and_version', ['slug', 'version'])
    .index('by_isActive', ['isActive']),

  // Collections table - groups texts by difficulty level or potentially other topics.
  // Premade-dataset rows have `datasetId` set and carry the `code`/`cefrTier`/`order`
  // fields. Custom (user-created) collections leave those optional. Old curriculum
  // rows ("Essential", "A1"..."C2") are marked `legacy: true` after the OGTE cutover.
  collections: defineTable({
    name: v.string(), // e.g., "A1", "B2", "Essential", "L01"
    textCount: v.number(), // Number of texts in this collection
    // Premade-dataset fields (populated by uploadDataset; null for custom and legacy)
    datasetId: v.optional(v.id('datasets')),
    code: v.optional(v.string()), // "L01" … "L20"
    cefrTier: v.optional(v.string()), // "Pre-A1" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
    order: v.optional(v.number()), // 1..20 within the dataset
    displayName: v.optional(v.string()),
    legacy: v.optional(v.boolean()), // true on old Essential/A1..C2 post-cutover
    // Explicit origin tag — source of truth for the content-source filter.
    // 'premade' = dataset-uploaded; 'custom' = user-typed; 'chat' = chat-approved.
    // Backfilled for all existing rows; optional only in the validator — treat
    // as required for new writes.
    origin: v.optional(
      v.union(v.literal('premade'), v.literal('custom'), v.literal('chat')),
    ),
  })
    .index('by_name', ['name'])
    .index('by_datasetId_and_order', ['datasetId', 'order'])
    .index('by_datasetId_and_code', ['datasetId', 'code']),

  // Texts table - stores the original texts/sentences
  texts: defineTable({
    datasetSentenceId: v.optional(v.number()), // Legacy numeric Tatoeba ID — retained for back-compat
    externalId: v.optional(v.string()), // Stable cross-version ID (Tatoeba stringified or "c-<hex>")
    datasetId: v.optional(v.id('datasets')), // Premade-dataset texts only; null for user-created and legacy
    text: v.string(),
    language: v.string(), // e.g., "en" for English
    romanizedText: v.optional(v.string()), // Latin transliteration for non-Latin scripts
    // Identifier of which romanizer produced `romanizedText` (e.g.
    // "arabic-transliterate-v1", "google-v3"). Stored so a future strategy
    // swap can find + invalidate rows produced by the old method via a
    // simple `romanizationSource != currentSource` migration. Also set when
    // `romanizedText` is the empty-string "tried, failed, leave empty"
    // sentinel — bumping the source identifier on the failing method is
    // how you re-attempt those rows.
    romanizationSource: v.optional(v.string()),
    // Debounce marker for the searchableText rebuild fan-out: timestamp until
    // which a scheduled `rebuildSearchableTextForText` is already pending for
    // this text. Content stores within that window skip re-scheduling — see
    // scheduleSearchableTextRebuild in convex/features/decks.ts.
    searchableRebuildScheduledAt: v.optional(v.number()),
    userCreated: v.boolean(), // false for uploaded data, true for user-created
    userId: v.optional(v.string()), // User who created (for user-created texts)
    collectionId: v.id('collections'), // Reference to collection (required for all texts)
    collectionRank: v.number(), // Rank within the collection (required for all texts)
    // Linguistic metadata (populated from translation pipeline)
    register: v.optional(v.string()), // formal / informal / neutral
    addresseeNumber: v.optional(v.string()), // singular / plural / not_applicable
    speakerGender: v.optional(v.string()), // male / female / neutral
    audioSpeakerGender: v.optional(v.string()), // male / female — resolved voice gender after coin-flip; mirrors speakerGender when male/female
    addresseeGender: v.optional(v.string()), // male / female / neutral / not_applicable
    addressesSomeone: v.optional(v.boolean()), // true if the sentence speaks to a 2nd-person addressee. Gates whether register/addresseeGender are emitted in the translation prompt. Legacy rows: undefined falls back to addresseeNumber === 'not_applicable' as the proxy.
    referentGender: v.optional(v.string()), // 'male' | 'female' — coin-flipped per-text, constant across all target-language translations. Drives gendered-noun agreement (e.g. de Übersetzer/-in, fr traducteur/-rice).
    tenseAspect: v.optional(v.string()), // simple_present / past_continuous / etc.
    sentenceType: v.optional(v.string()), // declarative / interrogative / imperative / exclamatory
    literalFigurative: v.optional(v.string()), // literal / figurative
    // OGTE arc grouping (curation manifest). Sentences sharing the same
    // (collectionId, arcId) form a thematic sequence; the translation worker
    // pulls a sliding window of arc siblings into the LLM prompt so pronouns,
    // gender agreement, and discourse register stay consistent across the
    // arc. Undefined for legacy rows and user-created texts (custom/chat).
    arcId: v.optional(v.string()),
  })
    .index('by_datasetSentenceId', ['datasetSentenceId'])
    .index('by_dataset_and_externalId', ['datasetId', 'externalId'])
    .index('by_collection_and_rank', ['collectionId', 'collectionRank'])
    .index('by_collection_and_userCreated_and_rank', ['collectionId', 'userCreated', 'collectionRank'])
    .index('by_collection_and_userId_and_rank', ['collectionId', 'userId', 'collectionRank'])
    // Admin dashboard: enumerate a user's custom texts (userId is only set
    // on user-created rows, so premade texts never appear under a real key)
    .index('by_userId', ['userId'])
    // Sliding-window arc-context lookup: equality on (collectionId, arcId)
    // followed by `.lt('collectionRank', X).order('desc').take(5)` for the
    // preceding window and `.gt('collectionRank', X).order('asc').take(3)` for
    // the following window. Constant-cost (≤ 8 reads) regardless of arc size.
    .index('by_collection_arcId_and_rank', ['collectionId', 'arcId', 'collectionRank']),

  // Translations table - stores translations of texts
  translations: defineTable({
    textId: v.id('texts'),
    targetLanguage: v.string(), // e.g., "es" for Spanish
    translatedText: v.string(),
    romanizedText: v.optional(v.string()), // Latin transliteration for non-Latin scripts
    // Same purpose as on `texts` — identifier of the romanizer that produced
    // `romanizedText` (or attempted to and persisted the empty-string
    // sentinel). See the texts table for the migration pattern.
    romanizationSource: v.optional(v.string()),
    // Identifier of the translation method that produced `translatedText`.
    // Format: "<model-slug>-<reasoning|none>" for LLM translations (e.g.
    // "google/gemini-3.1-flash-lite-high"), "google-translate-v2"
    // for the legacy Google Translate path, "user-provided" for
    // manually-typed custom-text translations. Persisted so a future
    // strategy swap (new dataset version, new model, new prompt) can find
    // and regenerate rows produced by the prior method via a simple
    // `translationSource != currentSource` migration. Optional only in the
    // validator for backward-compat; existing rows are tagged and new writes
    // always populate it.
    translationSource: v.optional(v.string()),
    // Concrete regional variant chosen for this row when `targetLanguage` is a
    // mixed/aggregate code (today: "es_mixed"). Stored as a Google voice-locale
    // prefix such as "es-ES" or "es-US" so the audio player can call
    // `getVoiceForLanguageVariant` and synthesize with the matching accent.
    // Undefined for non-mixed languages.
    regionVariant: v.optional(v.string()),
    // Number of times a user has flagged this translation as bad. Drives the
    // automatic retranslation policy in `flagTranslation` — flags 1 and 2
    // enqueue a stronger model; flags 3+ only increment the counter for
    // later admin triage. Undefined treated as 0 for back-compat.
    flagCount: v.optional(v.number()),
    // Voice/audio speaker gender ('male' | 'female') the translation was
    // produced under — the resolved `texts.audioSpeakerGender` at write time,
    // NOT `texts.speakerGender` (which can be 'neutral' and is what the
    // translation prompt reads). Recording the voice gender is what lets
    // `scheduleMissingContent` invalidate translations whose grammar would no
    // longer agree with the card's current voice gender (e.g. when LLM
    // metadata analysis lands a definitive gender that overrides the initial
    // coin-flip). Undefined on legacy rows written before this field existed —
    // treated as "unknown, regenerate on next sweep."
    speakerGender: v.optional(voiceGenderValidator),
    // Version of the translation METHOD this row was produced under, per the
    // language's `translationVersion` in lib/languages.ts (single source of
    // truth). Bumping a language's config version makes `scheduleMissingContent`
    // treat rows with a strictly-lower stamped version as stale and regenerate
    // them lazily on next view. Optional + "undefined === current" semantics:
    // a missing stamp is NEVER treated as stale (only a number strictly < the
    // current version is), so un-backfilled rows don't mass-regenerate. Rows
    // predating the versioning system were stamped to the baseline (v1) by a
    // one-time backfill, so a later bump correctly marks them stale. User-provided / userCreated translations are
    // skipped by the regen sweep regardless.
    translationVersion: v.optional(v.number()),
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'targetLanguage']),

  // Content-addressed audio store. One row per unique
  // (language, voiceGender, regionVariant, spoken string) — every text whose
  // audio speaks that exact string points at the same asset via
  // `audioRecordings.assetId`, so identical sentences are synthesized once and
  // the blob is stored once. The asset OWNS its storage blob: regenerating
  // audio patches the asset in place (new `storageId`), upgrading every
  // pointing text at once; the asset (and blob) is deleted when the last
  // pointer goes. See convex/lib/audioAssets.ts for the key/lookup helpers.
  audioAssets: defineTable({
    // ---- content-address key ----
    language: v.string(), // Base language code (e.g., "en", "es", "de")
    voiceGender: voiceGenderValidator, // Gender-level key — voice pick within a gender is random anyway
    // Concrete dialect pin for mixed-language rows (e.g. 'es-ES' vs 'es-US'),
    // part of the key so accents never collide. Undefined for non-mixed
    // languages and source-language audio.
    regionVariant: v.optional(v.string()),
    // SHA-256 hex of the RAW spoken string (exactly what was sent to TTS — no
    // trimming/normalization; that belongs to card-edit comparison only).
    // Hashing keeps the index key bounded regardless of text length.
    spokenTextHash: v.string(),
    // The raw spoken string itself. Compared on lookup so a hash collision can
    // only cause a spurious cache miss, never wrong audio.
    spokenText: v.string(),
    // ---- owned payload ----
    storageId: v.id('_storage'),
    // Full voice identifier (e.g., "en-US-Chirp3-HD-Leda"). Also the last
    // column of `by_key`: today asset identity is GENDER-level (all lookups
    // and upserts use the 4-field prefix, so one asset exists per
    // string+gender and a regeneration replaces it whatever voice it picked
    // — that's what propagates regen to every sharer). The extra column is
    // forward-compat for a user-selectable favorite voice: switching
    // `findAudioAssetByKey`/`upsertAudioAsset` to include `.eq('voiceName',…)`
    // gives per-voice assets with no schema or index migration.
    voiceName: v.string(),
    ttsProvider: v.optional(ttsProviderValidator), // missing = legacy google
    // 'unknown' = a synthesis job is mid-flight on this asset (attempt-0 early
    // write); completed audio is 'validated'/'unvalidated' (or undefined on
    // legacy rows carried over by the backfill, which is also "completed").
    ttsQuality: v.optional(ttsQualityValidator),
    speed: v.number(),
    // Word-level timestamps from Azure Fast Transcription, captured during TTS
    // validation. Seconds relative to the audio blob. Only populated when
    // validation succeeded.
    wordTimings: v.optional(
      v.array(
        v.object({
          word: v.string(),
          start: v.number(),
          end: v.number(),
        }),
      ),
    ),
    // Version of the TTS setup (voice pool + Gemini prompt + provider) this
    // audio was produced under, per the language's `ttsVersion` in
    // lib/languages.ts. A stamped version below the language's current config
    // makes cache lookups MISS (the asset is never served to new texts), and
    // the sweep-triggered re-synthesis patches this same asset in place —
    // healing every pointing text at once. Same "undefined === current"
    // semantics as the other content-version stamps.
    ttsVersion: v.optional(v.number()),
  })
    .index('by_key', [
      'language',
      'voiceGender',
      'regionVariant',
      'spokenTextHash',
      'voiceName',
    ])
    // Reverse lookup for reference-aware blob deletes (the delayed
    // post-swap delete re-checks this index at fire time).
    .index('by_storageId', ['storageId']),

  // Audio pointer table: one row per (textId, language), pointing at the
  // shared `audioAssets` row that owns the actual audio (blob + payload).
  // Deliberately payload-free — everything about the audio itself lives on
  // the asset so an in-place asset swap reaches every pointing text at once.
  audioRecordings: defineTable({
    textId: v.id('texts'),
    language: v.string(), // Base language code (e.g., "en", "es", "de")
    assetId: v.id('audioAssets'),
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'language'])
    // Reference counting for shared assets: an asset (and its blob) is deleted
    // only when no row points at it any more.
    .index('by_assetId', ['assetId']),

  // Placement-test sentence index. The actual English source text lives in
  // `texts` (so it gets translations/audio from the standard pipelines); this
  // side table just records *which* texts belong to the placement test, at
  // which OGTE level and position. Seeded by
  // `convex/migrations/seedPlacementTestSentences.ts` from
  // `data/placement-test/english.json`.
  //
  // Per OGTE level (1..20) there are 5 positions (0..4). `level + position`
  // therefore uniquely identifies a sentence; the unique-pair guarantee is
  // enforced by the seed mutation (idempotent upsert).
  placementTestSentences: defineTable({
    level: v.number(),               // 1..20 (OGTE level)
    position: v.number(),            // 0..4 within the level
    textId: v.id('texts'),           // English source — translations + audio live here
    rarestWord: v.optional(v.string()),
    ogteId: v.optional(v.string()),  // Traceability back to the source OGTE row
  })
    .index('by_level_and_position', ['level', 'position'])
    .index('by_textId', ['textId']),

  // User settings table - stores user preferences and onboarding status
  userSettings: defineTable({
    userId: v.string(), // Links to auth user
    hasCompletedOnboarding: v.boolean(),
    learningStyle: v.optional(learningStyleValidator),
    activeCourseId: v.optional(v.id('courses')), // Active course for the user
    completedTutorials: v.optional(v.array(v.string())), // IDs of completed tutorials (e.g. "home_tour", "audio_review_intro")
    // Ordered list of card-action keys the user has surfaced on the card.
    // Whitelist + max enforced by `normalizePinnedCardActions` in
    // `lib/cardActions.ts`. Empty or undefined = use DEFAULT_PINNED_CARD_ACTIONS.
    pinnedCardActions: v.optional(v.array(v.string())),
    // Mirror of the browser's analytics-consent choice, synced by
    // `features/consent.setAnalyticsConsent`. Gates whether AI chat *content*
    // may be attached to PostHog cost events (see chat/messages.ts) — the
    // privacy policy promises "if you decline, no AI content is transmitted".
    // undefined = never synced, treated as declined. Account-scoped where the
    // browser choice is device-scoped, so the last device to sync wins.
    analyticsConsent: v.optional(v.boolean()),

    // ---- Daily reminder notification (features/notifications.ts) ----
    //
    // Account-scoped, like the reminder itself: one nudge per person per day,
    // not one per course or per device.
    //
    // `reminderTimeZone` is the first server-readable per-user timezone in the
    // app. Everything else takes `timezone` as a client argument, which a cron
    // has no way to supply — see the sweep in features/notifications.ts.
    // Refreshed opportunistically by the client on load (travel, DST rule
    // changes), so a user who never reopens the app keeps firing at their old
    // local time until they do.
    reminderEnabled: v.optional(v.boolean()),
    reminderMinuteLocal: v.optional(v.number()), // 0..1439, minutes past local midnight, multiple of REMINDER_STEP_MINUTES
    reminderTimeZone: v.optional(v.string()), // IANA, validated with isValidTimezone
    reminderLocale: v.optional(v.string()), // 'en' | 'de' — the push is localized, unlike outbound email
    // The claim key. Precomputed UTC instant of the next send, so the sweep is
    // an indexed range read over users who are actually due rather than a scan
    // of every user. Recomputed after each send, which is what keeps it
    // DST-correct (see lib/reminderSchedule.ts).
    reminderNextSendAt: v.optional(v.number()),
    // The local day the sweep last CLAIMED this row — not proof a notification
    // reached a device. Delivery happens after the claim and may still decide
    // to skip (the user studied in the meantime) or fail per-device. Named for
    // what it actually records so nothing downstream mistakes it for a receipt.
    reminderLastClaimedDate: v.optional(v.string()), // "YYYY-MM-DD" in the user's zone
  })
    .index('by_userId', ['userId'])
    // Drives the sweep. `reminderEnabled` leads so a disabled row costs
    // nothing to skip; Convex requires index fields be queried in definition
    // order, and this is only ever read as (enabled = true, nextSendAt <= now).
    .index('by_reminderEnabled_and_reminderNextSendAt', [
      'reminderEnabled',
      'reminderNextSendAt',
    ]),

  /**
   * Push delivery targets — one row per device, many per user.
   *
   * Two transports share this table because the schedule does not care which
   * one a device uses:
   *   - `web`: a Web Push subscription. `token` is the endpoint URL and `keys`
   *     holds the ECDH/auth pair needed for RFC 8291 payload encryption.
   *   - `ios` / `android`: an FCM registration token from
   *     @capacitor/push-notifications. No `keys` — FCM relays to APNs itself.
   *
   * Web Push cannot serve the store apps: the Capacitor shell points
   * `server.url` at the live site, and service workers are unavailable in an
   * iOS WKWebView, so an installed store app has no push path except FCM/APNs.
   *
   * Rows are pruned on a permanent delivery rejection (HTTP 410/404, or FCM
   * UNREGISTERED) rather than expired on a timer — subscriptions die silently
   * and the send is the only place that finds out.
   */
  pushDevices: defineTable({
    userId: v.string(), // Better Auth user._id === identity.subject
    platform: pushPlatformValidator,
    token: v.string(), // web: endpoint URL; native: FCM registration token
    keys: v.optional(
      v.object({ p256dh: v.string(), auth: v.string() }), // web only
    ),
    createdAt: v.number(),
    lastSeenAt: v.number(), // refreshed by the client's mount-time re-sync
    failureCount: v.number(), // transient failures only; permanent ones delete the row
  })
    .index('by_userId', ['userId'])
    // Upsert on re-registration and prune by the value the transport reports.
    .index('by_token', ['token']),

  // Onboarding progress table — stores the user's onboarding answers.
  //
  // Row lifecycle:
  //   - `completedAt === undefined` → in-progress; the wizard reads and
  //     debounce-writes to this row.
  //   - `completedAt` set → frozen snapshot of the user's onboarding
  //     answers. `finalizeOnboarding` flips the row from active to
  //     frozen (the previous behaviour was to delete it).
  //
  // All reads must go through `getOnboardingProgress` in
  // `convex/db/users.ts`, which filters to active rows; that helper is
  // the only safe way to look at this table.
  //
  // Languages / level / review mode / `dailyTimeGoalMinutes` are written
  // through to `courses` / `courseSettings` by `completeOnboarding` so
  // they participate in the live per-course settings surface. Everything
  // else (acquisition source, learning goals, placement-test history,
  // first-lesson summary) lives only on this row.
  // Field definitions (and their comments) live in `onboardingProgressFields`
  // above, shared with the onboarding query/mutation validators.
  onboardingProgress: defineTable(onboardingProgressFields).index('by_userId', [
    'userId',
  ]),

  // Courses table - stores user language learning courses
  courses: defineTable({
    userId: v.string(), // Links to auth user
    baseLanguages: v.array(v.string()), // ISO codes (e.g., ["en"])
    targetLanguages: v.array(v.string()), // ISO codes (e.g., ["es", "fr"])
    currentLevel: v.optional(currentLevelValidator), // User's current level in this course
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()), // Timestamp; 30-day cooldown before unarchive
  }).index('by_userId', ['userId']),

  // Course settings table — separated so changes don't trigger course re-fetches
  courseSettings: defineTable(courseSettingsFields).index('by_courseId', ['courseId']),

  // Decks table - one deck per course, auto-created
  decks: defineTable({
    courseId: v.id('courses'), // Reference to the course
    name: v.string(), // Deck name (defaults to course target languages)
    cardCount: v.number(), // Denormalized count of cards in this deck
  }).index('by_courseId', ['courseId']),

  // Cards table - links texts to decks with review metadata and scheduling state
  cards: defineTable({
    deckId: v.id('decks'), // Reference to the deck
    textId: v.id('texts'), // Reference to the text/sentence
    collectionId: v.optional(v.id('collections')), // Reference to the source collection. Backfilled for all existing cards; treat as required for new writes.
    // Denormalized from collections.origin at insert time. Powers the content-source filter
    // index lookups in getCardForReview. Backfilled for all existing cards; treat as required for new writes.
    collectionOrigin: v.optional(
      v.union(v.literal('premade'), v.literal('custom'), v.literal('chat')),
    ),
    // Scheduling + free-play rotation state mutated by reviewCard /
    // advanceFreePlayCard (one rotation per face). Shared with the `reviewLogs`
    // undo snapshots — definitions and field comments live in convex/types.ts.
    ...cardSchedulingSnapshotFields,
    ...cardRadioSnapshotFields,
    ...cardFreeStudySnapshotFields,
    isMastered: v.boolean(), // Whether the card has been mastered
    isHidden: v.boolean(), // Whether the card is hidden from review
    isFavorite: v.optional(v.boolean()), // Whether the card is marked as a favorite
    searchableText: v.optional(v.string()), // Denormalized source text + translations for full-text search
    searchableTextLanguages: v.optional(v.array(v.string())), // Language codes included in searchableText; used to detect staleness when course languages change
    wordsTrackedLanguages: v.optional(v.array(v.string())), // Languages for which words have been counted in stats
    audioSpeedOverrides: v.optional(v.record(v.string(), v.number())), // Per-card per-language playback speed override (range CARD_OVERRIDE_SPEED_MIN-CARD_OVERRIDE_SPEED_MAX, see lib/constants/audioPlayback). Missing entry = use general courseSettings.languagePlaybackSpeeds.
  })
    .index('by_deckId', ['deckId'])
    .index('by_deckId_and_textId', ['deckId', 'textId'])
    .index('by_textId', ['textId'])
    .index('by_deckId_and_isHidden_and_isMastered', ['deckId', 'isHidden', 'isMastered'])
    .index('by_deckId_and_isHidden_and_isMastered_and_dueDate', [
      'deckId',
      'isHidden',
      'isMastered',
      'dueDate',
    ])
    .index('by_deck_hidden_mastered_radioCounter_radioOrder', [
      'deckId',
      'isHidden',
      'isMastered',
      'radioRoundCounter',
      'radioOrderKey',
    ])
    .index('by_deck_hidden_mastered_studyCounter_studyOrder', [
      'deckId',
      'isHidden',
      'isMastered',
      'freeStudyRoundCounter',
      'freeStudyOrderKey',
    ])
    .index('by_deckId_and_isHidden_and_lastReviewedAt', ['deckId', 'isHidden', 'lastReviewedAt'])
    .index('by_deckId_and_isHidden_and_isMastered_and_lastReviewedAt', ['deckId', 'isHidden', 'isMastered', 'lastReviewedAt'])
    .index('by_deckId_and_isHidden_and_isFavorite_and_lastReviewedAt', ['deckId', 'isHidden', 'isFavorite', 'lastReviewedAt'])
    .index('by_deck_hidden_mastered_graduated_due', [
      'deckId',
      'isHidden',
      'isMastered',
      'isGraduated',
      'dueDate',
    ])
    // Content-source filter variants — used when courseSettings.studyContentFilter is 'custom' or 'course'.
    .index('by_deck_hidden_mastered_origin_dueDate', [
      'deckId',
      'isHidden',
      'isMastered',
      'collectionOrigin',
      'dueDate',
    ])
    .index('by_deck_hidden_mastered_origin_graduated_due', [
      'deckId',
      'isHidden',
      'isMastered',
      'collectionOrigin',
      'isGraduated',
      'dueDate',
    ])
    .index('by_deck_hidden_mastered_origin_radioCounter_radioOrder', [
      'deckId',
      'isHidden',
      'isMastered',
      'collectionOrigin',
      'radioRoundCounter',
      'radioOrderKey',
    ])
    .index('by_deck_hidden_mastered_origin_studyCounter_studyOrder', [
      'deckId',
      'isHidden',
      'isMastered',
      'collectionOrigin',
      'freeStudyRoundCounter',
      'freeStudyOrderKey',
    ])
    // Library source-filter variants — origin appended to each state-aware
    // library index so every (state × origin) combo resolves via a pure index
    // query (no post-filter). For 'custom' (= origin ∈ {'custom','chat'}) the
    // query runs twice, once per non-premade origin, and the results are
    // merged on the server.
    .index('by_deckId_isHidden_origin_lastReviewedAt', [
      'deckId',
      'isHidden',
      'collectionOrigin',
      'lastReviewedAt',
    ])
    .index('by_deckId_isHidden_mastered_origin_lastReviewedAt', [
      'deckId',
      'isHidden',
      'isMastered',
      'collectionOrigin',
      'lastReviewedAt',
    ])
    .index('by_deckId_isHidden_favorite_origin_lastReviewedAt', [
      'deckId',
      'isHidden',
      'isFavorite',
      'collectionOrigin',
      'lastReviewedAt',
    ])
    .searchIndex('search_text', {
      searchField: 'searchableText',
      filterFields: ['deckId', 'isHidden', 'isMastered', 'isFavorite', 'collectionOrigin'],
    }),

  // Course stats table - tracks learning statistics per course
  courseStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    totalRepetitions: v.number(),
    totalTimeMs: v.number(),
    totalCards: v.number(),
    currentStreak: v.number(),
    lastActivityDate: v.optional(v.string()), // "YYYY-MM-DD" in user's local timezone
    timezone: v.optional(v.string()), // IANA timezone, updated on every review
    streakFreezeCount: v.optional(v.number()),
    streakFreezeUsedDate: v.optional(v.string()),
    // Extended cumulative counters
    totalWordCount: v.optional(v.number()),
    totalChatMessages: v.optional(v.number()),
    totalChatCardsApproved: v.optional(v.number()),
    totalCardsEdited: v.optional(v.number()),
    totalCardsAddedManually: v.optional(v.number()),
    totalReviewsByMode: v.optional(reviewsByModeValidator),
    totalAccuracySum: v.optional(v.number()),
    totalAccuracyCount: v.optional(v.number()),
    // Writing accuracy split by punctuation handling, so the headline number
    // keeps its meaning when the learner toggles `ignorePunctuation`. Written
    // as a trio — both sums share one count and are only ever incremented
    // together. Rows predating this simply don't contribute.
    totalAccuracyStrictSum: v.optional(v.number()), // punctuation always counted
    totalAccuracyLenientSum: v.optional(v.number()), // punctuation always ignored
    totalAccuracyDualCount: v.optional(v.number()),
  }).index('by_userId_and_courseId', ['userId', 'courseId']),

  // Daily stats table - one document per user + course + day
  dailyStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    date: v.string(),
    reps: v.number(),
    newCards: v.number(),
    timeMs: v.number(),
    cardsReviewed: v.number(),
    // Review mode breakdown
    reviewsByMode: v.optional(reviewsByModeValidator),
    timeMsByMode: v.optional(reviewsByModeValidator),
    // Rating distribution
    ratingCounts: v.optional(v.object({
      stillLearning: v.number(), understood: v.number(),
      again: v.number(), hard: v.number(), good: v.number(), easy: v.number(),
    })),
    defaultRatingUsed: v.optional(v.number()),
    defaultRatingChanged: v.optional(v.number()),
    // Full review accuracy
    accuracySum: v.optional(v.number()),
    accuracyCount: v.optional(v.number()),
    // Same punctuation split as courseStats — see there for the rationale.
    accuracyStrictSum: v.optional(v.number()),
    accuracyLenientSum: v.optional(v.number()),
    accuracyDualCount: v.optional(v.number()),
    // Hour-of-day distribution (24-element array, index = hour 0-23)
    hourBuckets: v.optional(v.array(v.number())),
    // Card state distribution
    reviewsByCardState: v.optional(v.object({
      new: v.number(), learning: v.number(), review: v.number(), relearning: v.number(),
    })),
    // Event counters
    chatMessagesSent: v.optional(v.number()),
    chatCardsApproved: v.optional(v.number()),
    cardsEdited: v.optional(v.number()),
    cardsAddedManually: v.optional(v.number()),
    // High-water mark: today's review count when a celebration last fired.
    // A milestone only triggers when the count EXCEEDS this, and undoing a
    // review never lowers it — so undo + re-review can't replay a celebration.
    lastCelebratedAtCount: v.optional(v.number()),
  })
    .index('by_userId_and_courseId_and_date', ['userId', 'courseId', 'date'])
    // Admin dashboard: per-day DAU scan across all users
    .index('by_date', ['date']),

  // Review log table — one entry per card review / radio play, capped at
  // UNDO_DEPTH newest entries per (user, course) by logReview's trim. Each
  // entry snapshots the card state the review overwrote plus the keys needed
  // to reverse its stat increments, powering the learn-mode undo button.
  // Snapshot-based because reviews aren't recomputable: dueDate carries
  // random jitter and ts-fsrs transitions aren't invertible.
  reviewLogs: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    cardId: v.id('cards'),
    reviewedAt: v.number(),
    timezone: v.string(), // timezone the review's stats were recorded under
    // 'review' for the FSRS modes; for free play this carries the FACE
    // ('radio' = listening, 'freeStudy' = typing), which both selects the
    // rotation snapshot below and scopes the undo stack.
    kind: v.union(v.literal('review'), v.literal('radio'), v.literal('freeStudy')),
    date: v.string(), // "YYYY-MM-DD" day key of the stats rows the review incremented; week/month/year keys derived
    // Study context at review time. Undo only applies while the CURRENT
    // course settings match — the undoable stack is the newest-first
    // consecutive run of matching entries, so entries logged under another
    // mode/face/filter block everything older beneath them.
    schedulingMode: schedulingModeValidator,
    studyContentFilter: studyContentFilterValidator,

    // kind === 'review': pre-review card scheduling state (shared field set
    // with the cards table — see convex/types.ts). undefined = field was absent.
    prevCard: v.optional(v.object(cardSchedulingSnapshotFields)),
    // kind === 'review': stat increments to reverse, keyed as computed at
    // review time (hour bucket, resolved mode, languages) since they are not
    // recomputable later.
    statsReversal: v.optional(
      v.object({
        hourOfDay: v.number(),
        rating: reviewRatingValidator,
        reviewModeForStats: reviewModeValidator, // resolved (?? 'audio') — dailyStats buckets use this
        reviewModeRaw: v.optional(reviewModeValidator), // as passed — courseStats/weekly/monthly/yearly gate on presence
        wasFirstReview: v.boolean(), // pre-patch schedulingPhase === 'preReview' && preReviewCount === 0
        wasDefaultRating: v.optional(v.boolean()),
        accuracy: v.optional(v.number()),
        accuracyStrict: v.optional(v.number()), // present iff the dual trio was written
        accuracyLenient: v.optional(v.number()),
        reviewDepth: v.optional(v.number()), // reviewDepthAccuracy bucket, only when accuracy present
        languages: v.array(v.string()), // course languages whose per-language stats were incremented
        collectionId: v.optional(v.id('collections')),
      }),
    ),

    // kind === 'radio': pre-play listening-face rotation state (shared field
    // set with the cards table) + lastReviewedAt, which the advance also stamps.
    prevRadio: v.optional(
      v.object({
        ...cardRadioSnapshotFields,
        lastReviewedAt: v.optional(v.number()),
      }),
    ),

    // kind === 'freeStudy': pre-play writing-face rotation state, mirroring
    // prevRadio for the typing round-robin.
    prevFreeStudy: v.optional(
      v.object({
        ...cardFreeStudySnapshotFields,
        lastReviewedAt: v.optional(v.number()),
      }),
    ),
  }).index('by_userId_and_courseId', ['userId', 'courseId']),

  // Collection progress table - per (user, course, collection) monotonic
  // counters used by the home view. Counters are strictly monotonic: incremented
  // on insert / first review / first mastery, NEVER decremented on delete or
  // demaster. The semantics are "cumulative work the user has done in this
  // collection," not "current card holdings."
  collectionProgress: defineTable({
    userId: v.string(), // Links to auth user
    courseId: v.id('courses'), // Reference to the course
    collectionId: v.id('collections'), // Reference to the collection
    cardsAdded: v.number(), // Monotonic — cards ever added from this collection
    cardsLearned: v.optional(v.number()), // Monotonic — cards ever reviewed at least once
    cardsMastered: v.optional(v.number()), // Monotonic — cards ever mastered
    // Credit rolled forward at OGTE cutover (legacy `cardsAdded` from the
    // mapped legacy CEFR collection). Widens the home-view denominator so the
    // user sees `X/(textCount + legacyCarryAdded)` and doesn't feel like
    // they're starting from scratch on the first level of each new tier.
    legacyCarryAdded: v.optional(v.number()),
    lastRankProcessed: v.optional(v.number()), // Last collectionRank processed (for efficient pagination)
    // Live counts of this user's collectionTextMarks rows for this collection,
    // by mark type. NOT monotonic (unlike the counters above): incremented and
    // decremented in the same transaction as every mark-row write, so
    // `remaining = textCount - cardsAdded - ignoredCount` stays O(1) for every
    // consumer that already reads this row. Absent = 0.
    prioritizedCount: v.optional(v.number()),
    ignoredCount: v.optional(v.number()),
  })
    .index('by_userId_and_courseId', ['userId', 'courseId'])
    .index('by_userId_and_courseId_and_collectionId', [
      'userId',
      'courseId',
      'collectionId',
    ]),

  // Per-(user, course, text) browse marks from the collection preview.
  // 'prioritized' texts are drained FIRST by addCardsFromCollection (in rank
  // order, independent of the sequential frontier); 'ignored' texts are
  // skipped by the sequential scan and count toward collection completion.
  // 'readd' is internal-only (never set directly by the client): un-marking a
  // text the frontier already passed flips its row to 'readd' instead of
  // deleting it, so the text stays discoverable (browse injection) and
  // addable (drained like 'prioritized', after it) without rolling the
  // frontier back. Counter-neutral — not part of prioritizedCount/ignoredCount.
  // Marks exist only for texts WITHOUT a card — every add path clears the
  // mark in the same transaction that inserts the card.
  collectionTextMarks: defineTable({
    userId: v.string(), // Links to auth user
    courseId: v.id('courses'),
    collectionId: v.id('collections'), // Denormalized from the text
    textId: v.id('texts'),
    mark: v.union(
      v.literal('prioritized'),
      v.literal('ignored'),
      v.literal('readd'),
    ),
    collectionRank: v.number(), // Denormalized from the text (rank-ordered drain)
  })
    .index('by_userId_and_courseId_and_textId', ['userId', 'courseId', 'textId'])
    // Abbreviated (full field spelling exceeds Convex's 64-char index-name cap):
    // fields are [userId, courseId, collectionId, mark, collectionRank].
    .index('by_user_course_collection_mark_rank', [
      'userId',
      'courseId',
      'collectionId',
      'mark',
      'collectionRank',
    ]),

  // Card approval requests from the AI chat
  cardApprovals: defineTable({
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    translations: translationEntriesValidator,
    userId: v.string(),
    status: cardApprovalStatusValidator,
    processedAt: v.optional(v.number()),
    textId: v.optional(v.id('texts')),
    cardId: v.optional(v.id('cards')),
    // Languages whose text the user hand-edited via EditApprovalDialog
    // (updateApprovalTranslations). On approval these entries are stored
    // VERBATIM and tagged user-provided — machine post-processing
    // (postProcessTranslation) must never touch user-typed text.
    userEditedLanguages: v.optional(v.array(v.string())),
  })
    .index('by_thread_and_user', ['threadId', 'userId']),

  // TTS mismatches — stores audio that failed validation for later analysis
  ttsMismatches: defineTable({
    textId: v.id('texts'),
    language: v.string(),
    voiceName: v.string(),
    storageId: v.id('_storage'),
    expectedText: v.string(),
    transcribedText: v.string(),
    attempt: v.number(), // 1-based attempt number
  })
    .index('by_textId', ['textId']),

  // TTS generation claims — prevents duplicate processTTSForCard scheduling.
  // Mutations atomically check-and-insert before scheduling; Convex OCC
  // guarantees only one claim per (textId, language) wins. The claim lives
  // from enqueue until the pool job's onComplete deletes it; `claimedAt`
  // staleness is only a catastrophic backstop (see TTS_CLAIM_STALE_MS).
  ttsGenerationClaims: defineTable({
    textId: v.id('texts'),
    language: v.string(),
    claimedAt: v.number(),
    // Workpool work id of the pool job holding this claim. Set by the enqueue
    // (same transaction); the job's onComplete only releases the claim when
    // its workId matches, so a stale-reclaimed claim can't be deleted by the
    // superseded job's completion. Optional: claims created for non-pool work
    // (word-timing backfills) and legacy rows carry none.
    workId: v.optional(v.string()),
  }).index('by_text_and_language', ['textId', 'language']),

  // Per-(textId, language) dedup claim. Atomically check-and-insert before
  // scheduling so two mutations can't enqueue the same translation twice.
  // Lives from enqueue until the pool job's onComplete deletes it (the
  // Google-fallback handoff re-points `workId` at the fallback job first).
  llmTranslationClaims: defineTable({
    textId: v.id('texts'),
    targetLanguage: v.string(),
    claimedAt: v.number(),
    // Workpool work id of the pool job holding this claim — see the
    // ttsGenerationClaims.workId comment.
    workId: v.optional(v.string()),
  }).index('by_text_and_language', ['textId', 'targetLanguage']),

  // Daily per-language stats
  dailyLanguageStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    date: v.string(),
    language: v.string(),
    reps: v.number(),
    newCards: v.number(),
    timeMs: v.number(),
    newWordsCount: v.number(),
  })
    .index('by_userId_and_courseId_and_date', ['userId', 'courseId', 'date'])
    .index('by_userId_and_courseId_and_language_and_date', ['userId', 'courseId', 'language', 'date']),

  // Unique words per user per course per language.
  // courseId is optional only to accommodate pre-migration rows; new writes
  // always populate it.
  userWords: defineTable({
    userId: v.string(),
    courseId: v.optional(v.id('courses')),
    language: v.string(),
    // Normalized (lowercased, NFC) form — used as the uniqueness key.
    word: v.string(),
    // Preferred display form, preserving original casing from source text
    // (e.g. German nouns stay capitalized). Optional to accommodate
    // pre-migration rows; new writes always populate it.
    displayWord: v.optional(v.string()),
    // Client-minted session id stamped on insert so we can partition the
    // celebration screen's word list into "this session" vs "earlier today".
    // Read by `getNewWordsForCelebration` via the language index — a session
    // id only ever matters alongside the auth context that created it.
    sessionId: v.optional(v.string()),
  })
    .index('by_userId_and_courseId_and_language_and_word',
      ['userId', 'courseId', 'language', 'word'])
    .index('by_userId_and_courseId_and_language',
      ['userId', 'courseId', 'language'])
    .searchIndex('search_word', {
      searchField: 'word',
      filterFields: ['userId', 'courseId', 'language'],
    }),

  // Junction table: links each tracked word to the texts it appeared in.
  // Capped at 30 texts per word to bound storage and write costs.
  userWordTexts: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    language: v.string(),
    word: v.string(), // normalized (lowercase, NFC) — matches userWords.word
    textId: v.id('texts'),
  })
    .index('by_userId_courseId_language_word',
      ['userId', 'courseId', 'language', 'word'])
    .index('by_userId_courseId_textId',
      ['userId', 'courseId', 'textId']),

  // All-time per-language totals
  languageStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    language: v.string(),
    totalRepetitions: v.number(),
    totalNewCards: v.number(),
    totalTimeMs: v.number(),
    totalWords: v.number(),
  })
    .index('by_userId_and_courseId', ['userId', 'courseId'])
    .index('by_userId_and_courseId_and_language', ['userId', 'courseId', 'language']),

  // Weekly stats (ISO 8601 weeks)
  weeklyStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    week: v.string(), // "YYYY-Www"
    totalRepetitions: v.number(),
    totalNewCards: v.number(),
    totalTimeMs: v.number(),
    activeDays: v.number(),
    reviewsByMode: v.optional(reviewsByModeValidator),
  })
    .index('by_userId_and_courseId_and_week', ['userId', 'courseId', 'week'])
    .index('by_userId_and_courseId', ['userId', 'courseId']),

  // Monthly stats
  monthlyStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    month: v.string(), // "YYYY-MM"
    totalRepetitions: v.number(),
    totalNewCards: v.number(),
    totalTimeMs: v.number(),
    activeDays: v.number(),
    activeWeeks: v.number(),
    reviewsByMode: v.optional(reviewsByModeValidator),
  })
    .index('by_userId_and_courseId_and_month', ['userId', 'courseId', 'month'])
    .index('by_userId_and_courseId', ['userId', 'courseId']),

  // Yearly stats
  yearlyStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    year: v.string(), // "YYYY"
    totalRepetitions: v.number(),
    totalNewCards: v.number(),
    totalTimeMs: v.number(),
    activeDays: v.number(),
    activeWeeks: v.number(),
    activeMonths: v.number(),
    reviewsByMode: v.optional(reviewsByModeValidator),
  })
    .index('by_userId_and_courseId_and_year', ['userId', 'courseId', 'year'])
    .index('by_userId_and_courseId', ['userId', 'courseId']),

  // Accuracy by review depth
  reviewDepthAccuracy: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    reviewNumber: v.number(),
    accuracySum: v.number(),
    count: v.number(),
  })
    .index('by_userId_and_courseId', ['userId', 'courseId'])
    .index('by_userId_and_courseId_and_reviewNumber', ['userId', 'courseId', 'reviewNumber']),

  // Usage quotas — local cache of Autumn entitlements for synchronous checks.
  // One document per user; features stored as a record keyed by feature ID.
  usageQuotas: defineTable({
    userId: v.string(),
    features: v.record(v.string(), featureStateValidator),
    lastSyncedAt: v.number(),
    // Current Autumn product (plan), captured during sync. Optional — rows
    // synced before this field existed (or users with no product) have none.
    planId: v.optional(v.string()),
    planName: v.optional(v.string()),
    planStatus: v.optional(v.string()),
    // When the billing state first became past due (ms). Set on the
    // transition into past_due, kept while it lasts, cleared on recovery.
    // There is deliberately NO grace window: while this field is set,
    // `assertBillingCurrent` (usage/helpers.ts) fails every quota-consuming
    // mutation and the dunning dialog hard-blocks the UI. The timestamp
    // itself only feeds the dialog's "overdue since {date}" copy; its
    // presence is the single source of truth for the block.
    pastDueSince: v.optional(v.number()),
    // Stripe-hosted page for the outstanding invoice (from Autumn's
    // ?expand=invoices). The overdue dialog's primary CTA — paying this is
    // what actually settles the debt; the billing portal only swaps cards.
    pastDueInvoiceUrl: v.optional(v.string()),
  }).index('by_userId', ['userId']),

  // E2E-only planStatus overrides, applied inside syncAllFeatures when the
  // deployment has E2E_TEST_HOOKS=1 (dev/test only — see usage/testing.ts).
  // Needed because a genuine past_due can't be produced synchronously in
  // Stripe test mode (verified July 2026: a failed attach charge voids the
  // invoice and drops the products instead of going past_due).
  billingTestOverrides: defineTable({
    userId: v.string(),
    planStatus: v.string(),
  }).index('by_userId', ['userId']),

  // E2E-only capture of transactional auth emails (verification / password
  // reset) and the scheduled welcome email. While the deployment has
  // E2E_TEST_HOOKS=1, lib/authEmails.ts + lib/welcomeEmail.ts write here
  // INSTEAD of sending real mail, so Playwright can follow the links
  // (features/authEmailTesting.ts).
  //
  // The flag protects only mail sent DURING the run. The deferred sends
  // (welcome ~24h, signup notification ~20min) fire after global-teardown has
  // removed it, so what keeps fake @flexling.com addresses from bouncing real
  // sends is `isE2EFixtureAddress` in lib/authEmails.ts, not this table.
  /**
   * E2E capture of daily reminder pushes (features/notificationTesting.ts).
   * Written only while `E2E_TEST_HOOKS=1`, in place of a real push send.
   */
  testPushMessages: defineTable({
    userId: v.string(),
    title: v.string(),
    body: v.string(),
    deviceCount: v.number(), // how many devices the send would have fanned out to
    capturedAt: v.number(),
  }).index('by_userId', ['userId']),

  testAuthEmails: defineTable({
    email: v.string(), // recipient, lowercase
    kind: v.union(v.literal('verify'), v.literal('reset'), v.literal('welcome')),
    url: v.optional(v.string()), // reset link ('reset' emails)
    otp: v.optional(v.string()), // verification code ('verify' emails)
    subject: v.string(),
  }).index('by_email', ['email']),

  // Admin allowlist for the /app/admin dashboard. The gate (requireAdmin in
  // convex/admin/lib.ts) requires BOTH fields to match the caller's Better
  // Auth user. Manage rows via `npx convex run admin/manage:setAdmin` (or the
  // dashboard function runner), which resolves the userId from the email.
  admins: defineTable({
    email: v.string(), // Better Auth user email, lowercase
    userId: v.string(), // Better Auth user._id === identity.subject
  })
    .index('by_email', ['email'])
    .index('by_userId', ['userId']),

  // App-owned mirror of Better Auth users (email/name live in the betterAuth
  // component tables, which can't be indexed/searched from app queries).
  // Kept in sync by user triggers in convex/auth.ts; historical rows were
  // seeded by a one-time backfill. Powers the admin user list/search.
  userProfiles: defineTable({
    userId: v.string(), // Better Auth user._id === identity.subject
    email: v.string(),
    name: v.string(),
    image: v.optional(v.string()),
    createdAt: v.number(), // Better Auth user.createdAt (signup time; _creationTime is the mirror-row time)
    searchText: v.string(), // `${email} ${name}`.toLowerCase()
  })
    .index('by_userId', ['userId'])
    .index('by_email', ['email'])
    .index('by_createdAt', ['createdAt'])
    .searchIndex('search_users', { searchField: 'searchText' }),

});
