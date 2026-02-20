import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  learningStyleValidator,
  currentLevelValidator,
  fsrsStateValidator,
} from './types';
import { testingTables } from './testing/schema';

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
    userCreated: v.boolean(), // false for uploaded data, true for user-created
    userId: v.optional(v.string()), // User who created (for user-created texts)
    collectionId: v.optional(v.id('collections')), // Reference to collection
    collectionRank: v.optional(v.number()), // Rank within the collection
  })
    .index('by_text', ['text'])
    .index('by_datasetSentenceId', ['datasetSentenceId'])
    .index('by_collection_and_rank', ['collectionId', 'collectionRank']),

  // Translations table - stores translations of texts
  translations: defineTable({
    textId: v.id('texts'),
    targetLanguage: v.string(), // e.g., "es" for Spanish
    translatedText: v.string(),
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'targetLanguage']),

  // Audio recordings table - stores audio files for texts
  audioRecordings: defineTable({
    textId: v.id('texts'),
    language: v.string(), // Base language code (e.g., "en", "es", "de")
    voiceName: v.string(), // Full voice identifier (e.g., "en-US-Chirp3-HD-Leda")
    storageId: v.id('_storage'), // Convex file storage reference
  })
    .index('by_textId', ['textId'])
    .index('by_text_and_language', ['textId', 'language']),

  // User settings table - stores user preferences and onboarding status
  userSettings: defineTable({
    userId: v.string(), // Links to auth user
    hasCompletedOnboarding: v.boolean(),
    learningStyle: v.optional(learningStyleValidator),
    activeCourseId: v.optional(v.id('courses')), // Active course for the user
  }).index('by_userId', ['userId']),

  // Onboarding progress table - stores temporary onboarding data until completion
  onboardingProgress: defineTable({
    userId: v.string(), // Links to auth user
    step: v.number(), // Current step in onboarding (1-6)
    learningStyle: v.optional(learningStyleValidator),
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
    // Language order overrides
    baseLanguageOrder: v.optional(v.array(v.string())), // ordered ISO codes for base languages
    targetLanguageOrder: v.optional(v.array(v.string())), // ordered ISO codes for target languages
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
    collectionId: v.id('collections'), // Reference to the source collection
    dueDate: v.number(), // Timestamp for spaced repetition scheduling (driven by scheduler)
    isMastered: v.boolean(), // Whether the card has been mastered
    isHidden: v.boolean(), // Whether the card is hidden from review
    isFavorite: v.optional(v.boolean()), // Whether the card is marked as a favorite
    schedulingPhase: v.string(), // "preReview" | "review"
    preReviewCount: v.number(), // How many pre-review rounds completed
    fsrsState: v.optional(fsrsStateValidator), // Populated when card enters FSRS review phase
  })
    .index('by_deckId', ['deckId'])
    .index('by_deckId_and_dueDate', ['deckId', 'dueDate'])
    .index('by_deckId_and_textId', ['deckId', 'textId'])
    .index('by_deckId_and_isHidden_and_isMastered_and_dueDate', [
      'deckId',
      'isHidden',
      'isMastered',
      'dueDate',
    ]),

  // Course stats table - tracks learning statistics per course
  courseStats: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    totalRepetitions: v.number(),
    totalTimeMs: v.number(),
    totalCards: v.number(),
    currentStreak: v.number(),
    lastActivityDate: v.optional(v.string()), // "YYYY-MM-DD" in user's local timezone
  }).index('by_userId_and_courseId', ['userId', 'courseId']),

  // Collection progress table - tracks cards added per collection/course
  collectionProgress: defineTable({
    userId: v.string(), // Links to auth user
    courseId: v.id('courses'), // Reference to the course
    collectionId: v.id('collections'), // Reference to the collection
    cardsAdded: v.number(), // Count of cards added from this collection
    lastRankProcessed: v.optional(v.number()), // Last collectionRank processed (for efficient pagination)
  })
    .index('by_userId_and_courseId', ['userId', 'courseId'])
    .index('by_userId_and_courseId_and_collectionId', [
      'userId',
      'courseId',
      'collectionId',
    ]),

  // Testing-only tables (testFlashcards, flashcardApprovals, translationRequests, ttsRequests)
  ...testingTables,
});
