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
} from './types';


export default defineSchema({
  // Collections table - groups texts by difficulty level or potentially other topics
  collections: defineTable({
    name: v.string(), // e.g., "A1", "B2", "Essential"
    textCount: v.number(), // Number of texts in this collection
  }).index('by_name', ['name']),

  // Texts table - stores the original texts/sentences
  texts: defineTable({
    datasetSentenceId: v.optional(v.number()), // Unique ID from the dataset (optional for user-created)
    text: v.string(),
    language: v.string(), // e.g., "en" for English
    romanizedText: v.optional(v.string()), // Latin transliteration for non-Latin scripts
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
    tenseAspect: v.optional(v.string()), // simple_present / past_continuous / etc.
    sentenceType: v.optional(v.string()), // declarative / interrogative / imperative / exclamatory
    literalFigurative: v.optional(v.string()), // literal / figurative
  })
    .index('by_text', ['text'])
    .index('by_datasetSentenceId', ['datasetSentenceId'])
    .index('by_collection_and_rank', ['collectionId', 'collectionRank'])
    .index('by_collection_and_userCreated_and_rank', ['collectionId', 'userCreated', 'collectionRank'])
    .index('by_collection_and_userId_and_rank', ['collectionId', 'userId', 'collectionRank']),

  // Translations table - stores translations of texts
  translations: defineTable({
    textId: v.id('texts'),
    targetLanguage: v.string(), // e.g., "es" for Spanish
    translatedText: v.string(),
    romanizedText: v.optional(v.string()), // Latin transliteration for non-Latin scripts
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
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'language'])
    .index('by_text_and_language_and_voiceName', [
      'textId',
      'language',
      'voiceName',
    ]),

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
    step: v.number(), // Current step in onboarding (1-5)
    reviewMode: v.optional(reviewModeValidator),
    currentLevel: v.optional(currentLevelValidator),
    targetLanguages: v.optional(v.array(v.string())),
    baseLanguages: v.optional(v.array(v.string())),
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
  courseSettings: defineTable({
    courseId: v.id('courses'),
    initialReviewCount: v.number(), // How many times a card is shown before FSRS scheduling
    activeCollectionId: v.optional(v.id('collections')),
    cardsToAddBatchSize: v.optional(v.number()), // How many cards to add at once
    autoAddCards: v.optional(v.boolean()), // Auto-add cards when none are due

    // Audio playback settings
    autoPlayAudio: v.optional(v.boolean()), // Auto-play audio when card is shown
    autoAdvance: v.optional(v.boolean()), // Auto-advance after audio finishes
    languageRepetitions: v.optional(v.record(v.string(), v.number())), // e.g. { "en": 2, "es": 2 }
    languageRepetitionPauses: v.optional(v.record(v.string(), v.number())), // per-language pause between repeats (seconds)
    pauseBaseToBase: v.optional(v.number()), // seconds between different base languages
    pauseBaseToTarget: v.optional(v.number()), // seconds between base and target sections
    pauseTargetToTarget: v.optional(v.number()), // seconds between different target languages
    pauseBeforeAutoAdvance: v.optional(v.number()), // seconds to wait before auto-advancing to next card
    showProgressBar: v.optional(v.boolean()), // whether to show the audio progress bar
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
    schedulingMode: v.optional(v.union(v.literal('learn_new'), v.literal('learnAndReview'))), // 'learnAndReview' (default) or 'learn_new'
    fullReviewTargetAudioMode: v.optional(
      v.union(v.literal('always'), v.literal('afterSubmit'), v.literal('never')),
    ), // When to play target audio in full review mode
    chatCollectionId: v.optional(v.id('collections')), // Per-course collection for chat-approved texts
    customCollectionId: v.optional(v.id('collections')), // Per-course collection for manually entered texts
    activeCustomCollectionIds: v.optional(v.array(v.id('collections'))), // Selected custom collections for auto-add
  }).index('by_courseId', ['courseId']),

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
    collectionId: v.optional(v.id('collections')), // Reference to the source collection (absent for user-created cards)
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
  })
    .index('by_deckId', ['deckId'])
    .index('by_deckId_and_dueDate', ['deckId', 'dueDate'])
    .index('by_deckId_and_textId', ['deckId', 'textId'])
    .index('by_textId', ['textId'])
    .index('by_deckId_and_isHidden_and_isMastered_and_dueDate', [
      'deckId',
      'isHidden',
      'isMastered',
      'dueDate',
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
    totalReviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number() })),
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number() })),
    timeMsByMode: v.optional(v.object({ audio: v.number(), full: v.number() })),
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

  // Collection progress table - tracks cards added per collection/course
  collectionProgress: defineTable({
    userId: v.string(), // Links to auth user
    courseId: v.id('courses'), // Reference to the course
    collectionId: v.id('collections'), // Reference to the collection
    cardsAdded: v.number(), // Count of cards added from this collection
    cardsLearned: v.optional(v.number()), // Count of cards with first review completed
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
    .index('by_textId', ['textId']),

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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number() })),
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number() })),
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
    reviewsByMode: v.optional(v.object({ audio: v.number(), full: v.number() })),
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
