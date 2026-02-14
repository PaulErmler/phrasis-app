import { Agent, createTool } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { internal } from '../../_generated/api';
import { stepCountIs } from 'ai';
import { gateway } from 'ai';
import { z } from 'zod/v3';
import type { ToolCallOptions } from 'ai';

// Define the createFlashcard tool - creates approval request, doesn't immediately create
export const createFlashcardTool = createTool({
  description:
    'Create a flashcard to help the student remember a word, phrase, or concept. This will ask the user for approval before creating.',
  args: z.object({
    text: z.string().describe('The flashcard content (always a phrase)'),
    note: z
      .string()
      .describe('Additional note or explanation about the flashcard'),
  }),
  handler: async (ctx, args, options): Promise<string> => {
    const threadId = ctx.threadId;
    const userId = ctx.userId;
    const messageId = ctx.messageId || 'pending';

    if (!threadId || !userId) {
      return 'Missing context for creating flashcard approval.';
    }

    const optionsWithId = options as ToolCallOptions & { toolCallId?: string };
    const toolCallId = optionsWithId?.toolCallId;

    if (!toolCallId) {
      console.error('No toolCallId provided by framework');
      return 'Error: Unable to create flashcard approval without toolCallId.';
    }

    try {
      await ctx.runMutation(
        internal.features.chat.flashcardApprovals.createApprovalRequestInternal,
        {
          threadId,
          messageId,
          toolCallId,
          text: args.text,
          note: args.note,
          userId,
        },
      );

      return "I've prepared a flashcard for you to review and approve.";
    } catch (error) {
      console.error('Failed to create approval request:', error);
      return "Sorry, I couldn't create the flashcard approval. Please try again.";
    }
  },
});

export const agent: Agent = new Agent(components.agent, {
  name: 'Language Teacher',
  languageModel: gateway('gemini-2.5-flash'),

  instructions: `
  You are a friendly language teacher assistant. Explain grammar and vocabulary and create spanish flashcards for the user. Do not ask for permission to create flashcards and just create them. 
  Make sure to only create flashcards for sentences not explanations or concepts. If the user asked you for a concept, create example sentences that show this concept in action. 
  `,
  stopWhen: stepCountIs(10),
  tools: {
    createFlashcard: createFlashcardTool,
  },
});
