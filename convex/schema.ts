import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  learningStyleValidator,
  currentLevelValidator,
  reviewModeValidator,
  fsrsStateValidator,
  cardApprovalStatusValidator,
  schedulingPhaseValidator,
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
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
  highlightWords: v.optional(v.boolean()), // Karaoke-style word highlighting during audio playback (default true)
  autoPlayAudio: v.optional(v.boolean()), // Auto-play audio when card is shown
  autoAdvance: v.optional(v.boolean()), // Auto-advance after audio finishes
  languageRepetitions: v.optional(v.record(v.string(), v.number())), // e.g. { "en": 2, "es": 2 }
  languageRepetitionPauses: v.optional(v.record(v.string(), v.number())), // per-language pause between repeats (seconds)
  languagePlaybackSpeeds: v.optional(v.record(v.string(), v.number())), // e.g. { "en": 1.0, "es": 0.9 }; range PLAYBACK_SPEED_MIN-PLAYBACK_SPEED_MAX (see lib/constants/audioPlayback); missing = 1.0. Pitch-preserved via HTMLMediaElement.preservesPitch for single clips and SoundTouchJS for the merged WAV.
  pauseBaseToBase: v.optional(v.number()), // seconds between different base languages
  pauseBaseToTarget: v.optional(v.number()), // seconds between base and target sections
  pauseTargetToTarget: v.optional(v.number()), // seconds between different target languages
  pauseBeforeAutoAdvance: v.optional(v.number()), // seconds to wait before auto-advancing to next card
  showProgressBar: v.optional(v.boolean()), // whether to show the audio progress bar
  progressDisplayEnabled: v.optional(v.boolean()), // celebrate every PROGRESS_DISPLAY_INTERVAL reviews (default true)
  hideTargetLanguages: v.optional(v.boolean()), // blur target language text by default
  autoRevealLanguages: v.optional(v.boolean()), // unblur when audio starts playing
  showRomanization: v.optional(v.boolean()), // show Latin transliteration below non-Latin script text
  // Language order overrides
  baseLanguageOrder: v.optional(v.array(v.string())), // ordered ISO codes for base languages
  targetLanguageOrder: v.optional(v.array(v.string())), // ordered ISO codes for target languages
  // Instant proceed on rating (per mode)
  instantProceedAudio: v.optional(v.boolean()), // auto-advance when rating is clicked (audio mode, default false)
  instantProceedFull: v.optional(v.boolean()), // auto-advance when rating is clicked (full mode, default true)
  // Review mode
  reviewMode: v.optional(v.union(v.literal('audio'), v.literal('full'))), // 'audio' (default) or 'full'
  // Scheduling mode
  schedulingMode: v.optional(v.union(v.literal('learn_new'), v.literal('learnAndReview'), v.literal('radio'))), // 'learnAndReview' (default), 'learn_new', or 'radio' (round-robin playback, no FSRS)
  fullReviewTargetAudioMode: v.optional(
    v.union(v.literal('always'), v.literal('afterSubmit'), v.literal('never')),
  ), // When to play target audio in full review mode
  chatCollectionId: v.optional(v.id('collections')), // Per-course collection for chat-approved texts
  customCollectionId: v.optional(v.id('collections')), // Per-course collection for manually entered texts
  activeCustomCollectionIds: v.optional(v.array(v.id('collections'))), // Selected custom collections for auto-add
  reconciledDatasetId: v.optional(v.id('datasets')), // Dataset version this course's progress has been cutover to (idempotency gate for datasetMigration_cutoverUser)
  // Source-of-content filter. `undefined` and 'both' behave identically (no filter).
  // 'custom' = study/auto-add only cards from collections with origin !== 'premade' (custom + chat).
  // 'course' = study/auto-add only cards from collections with origin === 'premade'.
  studyContentFilter: v.optional(
    v.union(v.literal('custom'), v.literal('course'), v.literal('both')),
  ),
} as const;

// Full `courseSettings` document validator (includes system fields).
export const courseSettingsDocValidator = v.object({
  _id: v.id('courseSettings'),
  _creationTime: v.number(),
  ...courseSettingsFields,
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
    // Optional during backfill; required after `runCollectionsOriginBackfill` completes.
    origin: v.optional(
      v.union(v.literal('premade'), v.literal('custom'), v.literal('chat')),
    ),
  })
    .index('by_name', ['name'])
    .index('by_datasetId_and_order', ['datasetId', 'order']),

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
  })
    .index('by_text', ['text'])
    .index('by_datasetSentenceId', ['datasetSentenceId'])
    .index('by_dataset_and_externalId', ['datasetId', 'externalId'])
    .index('by_collection_and_rank', ['collectionId', 'collectionRank'])
    .index('by_collection_and_userCreated_and_rank', ['collectionId', 'userCreated', 'collectionRank'])
    .index('by_collection_and_userId_and_rank', ['collectionId', 'userId', 'collectionRank']),

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
    // "google/gemini-3.1-flash-lite-preview-none"), "google-translate-v2"
    // for the legacy Google Translate path, "user-provided" for
    // manually-typed custom-text translations. Persisted so a future
    // strategy swap (new dataset version, new model, new prompt) can find
    // and regenerate rows produced by the prior method via a simple
    // `translationSource != currentSource` migration. Optional for
    // backward-compat with rows that landed before this field existed —
    // see `convex/migrations/backfillTranslationSource.ts`.
    translationSource: v.optional(v.string()),
    // Concrete regional variant chosen for this row when `targetLanguage` is a
    // mixed/aggregate code (today: "es_mixed"). Stored as a Google voice-locale
    // prefix such as "es-ES" or "es-US" so the audio player can call
    // `getVoiceForLanguageVariant` and synthesize with the matching accent.
    // Undefined for non-mixed languages.
    regionVariant: v.optional(v.string()),
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'targetLanguage']),

  // Audio recordings table - stores audio files for texts
  audioRecordings: defineTable({
    textId: v.id('texts'),
    language: v.string(), // Base language code (e.g., "en", "es", "de")
    voiceName: v.string(), // Full voice identifier (e.g., "en-US-Chirp3-HD-Leda")
    storageId: v.id('_storage'), // Convex file storage reference
    ttsQuality: v.optional(ttsQualityValidator), // TTS validation status
    ttsProvider: v.optional(ttsProviderValidator), // TTS provider used (missing = legacy google)
    voiceGender: v.optional(voiceGenderValidator), // Gender of the synthesized voice (missing = legacy row; falls back to curated-list lookup on read)
    speed: v.optional(v.number()), // Playback speed used at synthesis time (missing = legacy row, assume 0.9)
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
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'language'])
    .index('by_text_and_language_and_voiceName', [
      'textId',
      'language',
      'voiceName',
    ]),

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
  }).index('by_userId', ['userId']),

  // Onboarding progress table - stores temporary onboarding data until completion
  onboardingProgress: defineTable({
    userId: v.string(), // Links to auth user
    step: v.number(), // Current step number in the new flow
    reviewMode: v.optional(reviewModeValidator),
    currentLevel: v.optional(currentLevelValidator),
    targetLanguages: v.optional(v.array(v.string())),
    baseLanguages: v.optional(v.array(v.string())),
    // New onboarding-flow fields (mirrored to `userSettings` on completion).
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
  }).index('by_userId', ['userId']),

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
    collectionId: v.optional(v.id('collections')), // Reference to the source collection. Backfilled for all cards by runCardsCollectionBackfill; required after.
    // Denormalized from collections.origin at insert time. Powers the content-source filter
    // index lookups in getCardForReview. Optional during backfill; required after.
    collectionOrigin: v.optional(
      v.union(v.literal('premade'), v.literal('custom'), v.literal('chat')),
    ),
    dueDate: v.number(), // Timestamp for spaced repetition scheduling (driven by scheduler)
    isMastered: v.boolean(), // Whether the card has been mastered
    isHidden: v.boolean(), // Whether the card is hidden from review
    isFavorite: v.optional(v.boolean()), // Whether the card is marked as a favorite
    schedulingPhase: schedulingPhaseValidator,
    preReviewCount: v.number(), // How many pre-review rounds completed
    fsrsState: v.optional(fsrsStateValidator), // Populated when card enters FSRS review phase
    searchableText: v.optional(v.string()), // Denormalized source text + translations for full-text search
    searchableTextLanguages: v.optional(v.array(v.string())), // Language codes included in searchableText; used to detect staleness when course languages change
    isGraduated: v.optional(v.boolean()), // One-way flag: true once card graduates from initial learning (FSRS state >= Review)
    lastReviewedAt: v.optional(v.number()), // Timestamp of last review (pre-review and FSRS phases)
    wordsTrackedLanguages: v.optional(v.array(v.string())), // Languages for which words have been counted in stats
    audioSpeedOverrides: v.optional(v.record(v.string(), v.number())), // Per-card per-language playback speed override (range CARD_OVERRIDE_SPEED_MIN-CARD_OVERRIDE_SPEED_MAX, see lib/constants/audioPlayback). Missing entry = use general courseSettings.languagePlaybackSpeeds.
    radioRoundCounter: v.optional(v.number()), // Radio mode: # of times this card has been played in radio mode. Lowest counter plays next; new cards default to 0 so they play first. Optional for backward compat — undefined treated as 0.
    radioOrderKey: v.optional(v.number()), // Radio mode: random tiebreak within equal `radioRoundCounter`. Re-rolled on each play so the round-robin order shuffles every loop and never matches the review (`dueDate`-driven) order. Optional for backward compat.
  })
    .index('by_deckId', ['deckId'])
    .index('by_deckId_and_dueDate', ['deckId', 'dueDate'])
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
    .index('by_deckId_and_lastReviewedAt', ['deckId', 'lastReviewedAt'])
    .index('by_deckId_and_isHidden_and_lastReviewedAt', ['deckId', 'isHidden', 'lastReviewedAt'])
    .index('by_deckId_and_isHidden_and_isMastered_and_lastReviewedAt', ['deckId', 'isHidden', 'isMastered', 'lastReviewedAt'])
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
    .index('by_deckId_and_isHidden_and_isFavorite_and_lastReviewedAt', ['deckId', 'isHidden', 'isFavorite', 'lastReviewedAt'])
    .searchIndex('search_text', {
      searchField: 'searchableText',
      filterFields: ['deckId', 'isHidden', 'isMastered', 'isFavorite'],
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
    totalReviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number(), radio: v.optional(v.number()) })),
    totalAccuracySum: v.optional(v.number()),
    totalAccuracyCount: v.optional(v.number()),
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number(), radio: v.optional(v.number()) })),
    timeMsByMode: v.optional(v.object({ audio: v.number(), full: v.number(), radio: v.optional(v.number()) })),
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
  }).index('by_userId_and_courseId_and_date', ['userId', 'courseId', 'date']),

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
  })
    .index('by_userId_and_courseId', ['userId', 'courseId'])
    .index('by_userId_and_courseId_and_collectionId', [
      'userId',
      'courseId',
      'collectionId',
    ]),

  // Card approval requests from the AI chat
  cardApprovals: defineTable({
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    translations: v.array(v.object({ language: v.string(), text: v.string() })),
    userId: v.string(),
    status: cardApprovalStatusValidator,
    processedAt: v.optional(v.number()),
    textId: v.optional(v.id('texts')),
    cardId: v.optional(v.id('cards')),
  })
    .index('by_toolCallId', ['toolCallId'])
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
    .index('by_textId', ['textId'])
    .index('by_language', ['language']),

  // TTS generation claims — prevents duplicate processTTSForCard scheduling.
  // Mutations atomically check-and-insert before scheduling; Convex OCC
  // guarantees only one claim per (textId, language) wins.
  ttsGenerationClaims: defineTable({
    textId: v.id('texts'),
    language: v.string(),
    claimedAt: v.number(),
  }).index('by_text_and_language', ['textId', 'language']),

  // Global concurrency slots per TTS provider. Each row = one in-flight API
  // call. Used to stay under provider concurrency caps (e.g. ElevenLabs'
  // 3-parallel limit). Stale rows are reclaimed after SLOT_STALE_MS.
  ttsProviderSlots: defineTable({
    provider: ttsProviderValidator,
    claimedAt: v.number(),
  }).index('by_provider', ['provider']),

  // Priority/FIFO queue of pending TTS jobs. Enqueued by scheduling mutations;
  // drained by `pumpQueue` which dispatches the highest `priority` first,
  // FIFO within each level. Rows are deleted at dispatch time.
  // `priority` is optional only so a deploy can land without a one-shot
  // backfill of in-flight rows; new enqueues always set it (0 = normal,
  // 1 = active collection for the requesting user — see scheduleMissingContent).
  ttsQueue: defineTable({
    provider: ttsProviderValidator,
    args: v.object({
      textId: v.id('texts'),
      text: v.string(),
      language: v.string(),
      voiceName: v.string(),
      voiceGender: voiceGenderValidator,
      speed: v.number(),
    }),
    queuedAt: v.number(),
    priority: v.optional(v.number()),
  })
    .index('by_provider_and_queuedAt', ['provider', 'queuedAt'])
    .index('by_provider_priority_and_queuedAt', [
      'provider',
      'priority',
      'queuedAt',
    ]),

  // ── LLM translation queue (mirrors the TTS queue structure) ──────────────
  // OpenRouter rate-limits aggressively, so concurrent LLM translation calls
  // are capped at MAX_LLM_CONCURRENCY (100; active from day one, unlike the
  // dormant TTS gate). Same three-table pattern: queue + slots + claims.

  // Priority/FIFO queue of pending LLM translation jobs. Drained by
  // `pumpLlmQueue` highest-priority first, FIFO within each level. See the
  // ttsQueue comment above for the `priority` field semantics.
  llmTranslationQueue: defineTable({
    args: v.object({
      textId: v.id('texts'),
      sourceLanguage: v.string(),
      targetLanguage: v.string(),
      text: v.string(),
      audioSpeakerGender: v.optional(v.string()),
    }),
    queuedAt: v.number(),
    priority: v.optional(v.number()),
  })
    .index('by_queuedAt', ['queuedAt'])
    .index('by_priority_and_queuedAt', ['priority', 'queuedAt']),

  // Global concurrency slots — one row per in-flight LLM API call. Stale rows
  // are reclaimed after SLOT_STALE_MS so a crashed action doesn't leak slots.
  llmTranslationSlots: defineTable({
    claimedAt: v.number(),
  }),

  // Per-(textId, language) dedup claim. Atomically check-and-insert before
  // scheduling so two mutations can't enqueue the same translation twice.
  llmTranslationClaims: defineTable({
    textId: v.id('texts'),
    targetLanguage: v.string(),
    claimedAt: v.number(),
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
  // always populate it and backfillUserStats rebuilds historical data.
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
    .index('by_userId_courseId_language_word_textId',
      ['userId', 'courseId', 'language', 'word', 'textId'])
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number(), radio: v.optional(v.number()) })),
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number(), radio: v.optional(v.number()) })),
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number(), radio: v.optional(v.number()) })),
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

  // Per-user state for the retokenizeAllWords migration. Accumulated across
  // paginated `run` passes so the clear-and-rebuild chain fires exactly once
  // per user with their full course list, regardless of how many pages the
  // user's courses span. Rows are deleted as each user's chain is scheduled.
  retokenizeMigrationState: defineTable({
    userId: v.string(),
    courseIds: v.array(v.id('courses')),
  }).index('by_userId', ['userId']),

  // Usage quotas — local cache of Autumn entitlements for synchronous checks.
  // One document per user; features stored as a record keyed by feature ID.
  usageQuotas: defineTable({
    userId: v.string(),
    features: v.record(
      v.string(),
      v.object({
        balance: v.number(),
        included: v.number(),
        used: v.number(),
        interval: v.optional(v.string()),
        unlimited: v.optional(v.boolean()),
      }),
    ),
    lastSyncedAt: v.number(),
  }).index('by_userId', ['userId']),

});
