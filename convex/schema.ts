import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
  
  sentences: defineTable({
    text: v.string(),
    language: v.string(), // e.g., "en"
  }).index("by_text", ["text"]),
  
  translations: defineTable({
    sentenceId: v.id("sentences"),
    targetLanguage: v.string(), // e.g., "es"
    translatedText: v.string(),
  }).index("by_sentence_and_language", ["sentenceId", "targetLanguage"]),
  
  audio_recordings: defineTable({
    sentenceId: v.id("sentences"),
    language: v.string(), // e.g., "en-US"
    //accent: v.optional(v.string()), // e.g., "us", "uk"
    voice: v.optional(v.string()), // e.g., "FEMALE"
    storageId: v.id("_storage"),
  }).index("by_sentence_language", ["sentenceId", "language"]),// "accent"]),

  // User authentication & preferences
  users: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),

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

  // Custom sentences created by users
  user_sentences: defineTable({
    userId: v.string(),
    english: v.string(),
    spanish: v.string(),
    difficulty: v.optional(v.number()), // 0-1, optional difficulty rating
  }).index("by_userId", ["userId"]),
});
