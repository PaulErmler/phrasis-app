import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { learningStyleValidator, currentLevelValidator } from "./types";

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
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
  
  // Collections table - groups texts by difficulty level
  collections: defineTable({
    name: v.string(), // e.g., "A1", "B2", "Essential"
    textCount: v.number(), // Number of texts in this collection
  })
    .index("by_name", ["name"]),

  // Texts table - stores the original texts/sentences
  texts: defineTable({
    datasetSentenceId: v.optional(v.number()), // Unique ID from the dataset (optional for user-created)
    text: v.string(),
    language: v.string(), // e.g., "en" for English
    userCreated: v.boolean(), // false for uploaded data, true for user-created
    userId: v.optional(v.string()), // User who created (for user-created texts)
    collectionId: v.optional(v.id("collections")), // Reference to collection
    collectionRank: v.optional(v.number()), // Rank within the collection
  })
    .index("by_text", ["text"])
    .index("by_datasetSentenceId", ["datasetSentenceId"])
    .index("by_collection_and_rank", ["collectionId", "collectionRank"]),
  
  // Translations table - stores translations of texts
  translations: defineTable({
    textId: v.id("texts"),
    targetLanguage: v.string(), // e.g., "es" for Spanish
    translatedText: v.string(),
  })
    .index("by_text_and_language", ["textId", "targetLanguage"]),
  
  // Audio recordings table - stores audio files for texts
  audioRecordings: defineTable({
    textId: v.id("texts"),
    language: v.string(), // e.g., "en-US" or "es-ES"
    storageId: v.id("_storage"), // Convex file storage reference
    url: v.string(), // URL to the audio file
  })
    .index("by_text_and_language", ["textId", "language"]),

  // User settings table - stores user preferences and onboarding status
  userSettings: defineTable({
    userId: v.string(), // Links to auth user
    hasCompletedOnboarding: v.boolean(),
    learningStyle: v.optional(learningStyleValidator),
    activeCourseId: v.optional(v.id("courses")), // Active course for the user
  }).index("by_userId", ["userId"]),

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

  // Translation requests table - async translation processing
  translationRequests: defineTable({
    userId: v.string(), // User who requested the translation
    text: v.string(), // Original text to translate
    sourceLang: v.string(), // Source language code
    targetLang: v.string(), // Target language code
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.string()), // Translated text (when completed)
    error: v.optional(v.string()), // Error message (when failed)
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"]),
});
