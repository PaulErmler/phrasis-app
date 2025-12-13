import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    .index("by_user_and_status", ["userId", "status"]),
});
