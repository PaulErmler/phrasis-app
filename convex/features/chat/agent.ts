import { Agent, createTool } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { internal } from '../../_generated/api';
import { stepCountIs } from 'ai';
import { z } from 'zod/v3';
import type { ToolCallOptions } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const createCardTool = createTool({
  description:
    'Create a flashcard with translations in all course languages. The user will be asked to approve before the card is added to their deck.',
  args: z.object({
    languages: z
      .array(z.string())
      .describe(
        'Array of ISO language codes, e.g. ["en", "es", "de"]. Must include all course languages.',
      ),
    translations: z
      .array(z.string())
      .describe(
        'Array of translated texts, parallel to the languages array. Same length as languages.',
      ),
    mainLanguage: z
      .string()
      .describe(
        'ISO language code of the source/original language for this card, e.g. "es"',
      ),
  }),
  handler: async (ctx, args, options): Promise<string> => {
    const threadId = ctx.threadId;
    const userId = ctx.userId;
    const messageId = ctx.messageId || 'pending';

    if (!threadId || !userId) {
      throw new Error('Missing context for creating card approval.');
    }

    const optionsWithId = options as ToolCallOptions & { toolCallId?: string };
    const toolCallId = optionsWithId?.toolCallId;

    if (!toolCallId) {
      throw new Error('No toolCallId provided by framework.');
    }

    if (args.languages.length === 0) {
      throw new Error('languages must not be empty.');
    }

    if (args.languages.length !== args.translations.length) {
      throw new Error(
        `languages (${args.languages.length}) and translations (${args.translations.length}) must have the same length.`,
      );
    }

    if (!args.languages.includes(args.mainLanguage)) {
      throw new Error(
        `mainLanguage "${args.mainLanguage}" must be one of the provided languages: ${args.languages.join(', ')}.`,
      );
    }

    await ctx.runMutation(
      internal.features.chat.cardApprovals.createApprovalRequestInternal,
      {
        threadId,
        messageId,
        toolCallId,
        languages: args.languages,
        translations: args.translations,
        mainLanguage: args.mainLanguage,
        userId,
      },
    );

    return "I've prepared a card for you to review and approve.";
  },
});

export const agent: Agent = new Agent(components.agent, {
  name: 'Language Teacher',
  languageModel: createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  })('moonshotai/kimi-k2.5'),

  instructions: `You are a friendly and knowledgeable language learning assistant.
- Always respond in the same language the user wrote their message in.
- You can help with any language-related question in any language.
- When explaining vocabulary, grammar, or concepts, proactively create multiple flashcards in a single response to help the user remember key words and example sentences. You do not need to ask permission before creating cards. Create 2-4 cards per response when relevant.
- Call the createCard tool multiple times in one response to propose several cards at once.
- Cards should contain example sentences, not abstract definitions or concepts. If the user asks about a concept, create example sentences demonstrating it.
- The text content in flashcards must NOT contain emojis.
- Provide translations for ALL of the user's course languages when creating cards. Use the exact ISO language codes provided in the context.
- Since the user has to confirm all cards, you can err on the side of simply proposing them instead of asking the user for confirmation.
- After creating cards, do NOT repeat the explanation you already gave. Only add a brief follow-up or closing remark.
- Do not include notes in brackets on the cards. 
- When creating flashcards, create variations of the currently flashcard and avoid repeating the same flashcard. 
- Make sure to always include the correct diacritics, accents etc.
- And always respond in the language the user is talking to you. This is very important. You should respond in the base language unless the user asked you in the target language.`,
  stopWhen: stepCountIs(10),
  tools: {
    createCard: createCardTool,
  },
});
