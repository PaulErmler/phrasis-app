import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { learningStyleValidator, currentLevelValidator } from "./types";

export default defineSchema({
  // User's learning cards (FSRS)
  cards: defineTable({
    userId: v.string(),
    sentenceId: v.id("sentences"),
    targetLanguage: v.string(), // e.g., "es" for Spanish - the language being learned
    // FSRS state
    state: v.string(), // "new" | "learning" | "review" | "relearning"
    difficulty: v.number(), // 0-1, difficulty factor
    stability: v.number(), // 0+, in days
    elapsedDays: v.number(), // days since last review
    scheduledDays: v.number(), // days until next review
    reps: v.number(), // total reviews
    lapses: v.number(), // times forgotten
    lastReview: v.optional(v.number()), // timestamp
    nextReview: v.optional(v.number()), // timestamp (due date)
    // Initial learning phase (before FSRS)
    initialLearningPhase: v.boolean(), // true = in initial learning, false = FSRS active
    initialReviewCount: v.number(), // 0-4, times seen in initial phase
    lastInitialReviewTime: v.optional(v.number()), // timestamp of last initial review
  }).index("by_userId", ["userId"])
    .index("by_userId_targetLanguage", ["userId", "targetLanguage"])
    .index("by_userId_nextReview", ["userId", "nextReview"])
    .index("by_userId_initialLearning", ["userId", "initialLearningPhase"])
    .index("by_userId_targetLanguage_nextReview", ["userId", "targetLanguage", "nextReview"])
    .index("by_userId_targetLanguage_initialLearning", ["userId", "targetLanguage", "initialLearningPhase"]),

  card_reviews: defineTable({
    userId: v.string(),
    cardId: v.id("cards"),
    sentenceId: v.id("sentences"),
    rating: v.string(), // "again" | "hard" | "good" | "easy"
    elapsedSeconds: v.number(), // time spent on card
    reviewedAt: v.number(),
  }).index("by_userId", ["userId"])
    .index("by_cardId", ["cardId"]),


  testFlashcards: defineTable({
    text: v.string(),           // Flashcard content
    note: v.string(),           // Additional note
    date: v.number(),           // Timestamp
    randomNumber: v.number(),   // Random number
    userId: v.string(),         // User who owns the flashcard
  }),
  
  flashcardApprovals: defineTable({
    threadId: v.string(),       // Thread where approval was requested
    messageId: v.string(),      // Message containing the tool call
    toolCallId: v.string(),     // ID of the tool call
    text: v.string(),           // Proposed flashcard text
    note: v.string(),           // Proposed flashcard note
    userId: v.string(),         // User who needs to approve
    status: v.string(),         // "pending", "approved", "rejected"
    createdAt: v.number(),      // When the approval was requested
    processedAt: v.optional(v.number()), // When it was approved/rejected
  })
    .index("by_message", ["messageId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_toolCallId", ["toolCallId"])
    .index("by_thread_and_user", ["threadId", "userId"]),
  

  sentences: defineTable({
    datasetSentenceId: v.number(), // Unique ID from the dataset
    text: v.string(),
    language: v.string(), // e.g., "en"
    deck: v.string(), // Difficulty level: A1, A2, B1, B2, C1, C2
    deckRank: v.number(), // Rank within the deck
    difficulty: v.string(), // Difficulty as a string (e.g., "A1")
    topic1: v.optional(v.string()), // Primary topic
    topic2: v.optional(v.string()), // Secondary topic
  }).index("by_text", ["text"])
    .index("by_datasetSentenceId", ["datasetSentenceId"])
    .index("by_deck", ["deck", "deckRank"])
    .index("by_difficulty", ["difficulty"]),
  
  // Custom sentences created by users
  user_sentences: defineTable({
    userId: v.string(),
    english: v.string(),
    spanish: v.string(),
    difficulty: v.optional(v.number()), // 0-1, optional difficulty rating
  }).index("by_userId", ["userId"]),


  translations: defineTable({
    sentenceId: v.id("sentences"),
    targetLanguage: v.string(), // e.g., "es"
    translatedText: v.string(),
  }).index("by_sentence_and_language", ["sentenceId", "targetLanguage"]),
  
  audio_recordings: defineTable({
    sentenceId: v.id("sentences"),
    language: v.string(), // e.g., "en-US"
    accent: v.optional(v.string()), // e.g., "us", "uk"
    voice: v.optional(v.string()), // e.g., "FEMALE"
    storageId: v.id("_storage"),
  }).index("by_sentence_language", ["sentenceId", "language"]),
  // User authentication & preferences
  users: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),

  //////////// User Settings & Preferences //////////
   // User settings table - stores user preferences and onboarding status
  userSettings: defineTable({
    userId: v.string(), // Links to auth user
    hasCompletedOnboarding: v.boolean(),
    learningStyle: v.optional(learningStyleValidator),
    activeCourseId: v.optional(v.id("courses")), // Active course for the user
  }).index("by_userId", ["userId"]),

  user_preferences: defineTable({
    userId: v.string(), // better-auth userId
    // Language settings
    sourceLanguage: v.string(), // e.g., "en" for English (learning from)
    targetLanguage: v.string(), // e.g., "es" for Spanish (translating to)
    // Autoplay delays (language-agnostic)
    autoplayDelaySourceToTarget: v.number(), // milliseconds (delay after source language audio)
    autoplayDelayTargetToNext: v.number(), // milliseconds (delay after target language audio)
    // Initial learning phase preferences
    maxInitialLearningCards: v.number(), // max cards in initial phase at once (default 10)
    initialLearningReviewsRequired: v.number(), // times to review before FSRS (default 4)
    initialLearningPriorityCoefficientReviewCount: v.number(), // weight for (required - current) (default 1.0)
    initialLearningPriorityCoefficientMinutes: v.number(), // weight for minutes since last review (default 0.1)
    initialLearningAutoplay: v.boolean(), // enable autoplay during initial learning (default false)
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  //////////// Onboarding & Courses //////////

  // Onboarding progress table - stores temporary onboarding data until completion
  onboardingProgress: defineTable({
    userId: v.string(), // Links to auth user
    step: v.number(), // Current step in onboarding (1-6)
    learningStyle: v.optional(learningStyleValidator),
    currentLevel: v.optional(currentLevelValidator),
    targetLanguages: v.optional(v.array(v.string())),
    baseLanguages: v.optional(v.array(v.string())),
  }).index("by_userId", ["userId"]),


  // Courses table - stores user language learning courses
  courses: defineTable({
    userId: v.string(), // Links to auth user
    baseLanguages: v.array(v.string()), // ISO codes (e.g., ["en"])
    targetLanguages: v.array(v.string()), // ISO codes (e.g., ["es", "fr"])
    currentLevel: v.optional(currentLevelValidator), // User's current level in this course
  }).index("by_userId", ["userId"]),


  /////////// Request Tables ///////////

  // Card import requests (track background imports)
  card_import_requests: defineTable({
    userId: v.string(),
    count: v.number(),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
    status: v.string(), // "pending" | "completed" | "failed"
    error: v.optional(v.string()),
  }).index("by_userId_status", ["userId", "status"]),

  // Audio generation requests (capture user intent, schedule action)
  audio_requests: defineTable({
    userId: v.string(),
    text: v.string(),
    language: v.string(),
    status: v.string(), // "pending" | "completed" | "failed"
    audioRecordingId: v.optional(v.id("audio_recordings")),
    audioUrl: v.optional(v.string()), // Convex storage URL when completed
  }).index("by_userId_status", ["userId", "status"])
    .index("by_text_language", ["text", "language"]),

  // Translation requests (capture user intent, schedule action)
  translation_requests: defineTable({
    userId: v.string(),
    sourceText: v.string(),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    status: v.string(), // "pending" | "completed" | "failed"
    translatedText: v.optional(v.string()),
  }).index("by_userId_status", ["userId", "status"])
    .index("by_sourceText_languages", ["sourceText", "sourceLanguage", "targetLanguage"]),

  // CSV files storage for sentence data
  csv_files: defineTable({
    name: v.string(), // e.g., "Essential", "A1", "A2"
    fileId: v.id("_storage"),
    uploadedAt: v.number(),
    userID: v.optional(v.string()),
  }).index("by_name", ["name"]),

});
