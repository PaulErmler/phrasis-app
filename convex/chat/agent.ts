import { Agent, createTool } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { stepCountIs } from "ai";
import { gateway } from "ai";
import { z } from "zod";

// Define the createFlashcard tool - creates approval request, doesn't immediately create
export const createFlashcardTool = createTool({
  description: "Create a flashcard to help the student remember a word, phrase, or concept. This will ask the user for approval before creating.",
  args: z.object({
    text: z.string().describe("The flashcard content (always a phrase)"),
    note: z.string().describe("Additional note or explanation about the flashcard"),
  }),
  handler: async (_ctx, _args): Promise<string> => {
    // Return a simple acknowledgment
    // The UI will handle displaying the confirmation
    return "I've prepared a flashcard for you to review.";
  },
});

export const agent: Agent = new Agent(components.agent, {
  name: "Language Teacher",
  languageModel: gateway("gemini-2.5-flash"),
  
  instructions: `
  You are a friendly language teacher assistant. Explain grammar and vocabulary and create spanish flashcards for the user. Do not ask for permission to create flashcards and just create them. 
  Make sure to only create flashcards for sentences not explanations or concepts. If the user asked you for a concept, create example sentences that show this concept in action. 
  `,
  stopWhen: stepCountIs(10), // Limit tool call steps
  tools: {
    createFlashcard: createFlashcardTool,
  },
});

