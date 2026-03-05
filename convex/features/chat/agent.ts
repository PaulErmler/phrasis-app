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
    translations: z
      .array(z.object({ language: z.string(), text: z.string() }))
      .describe(
        'Array of {language, text} pairs covering all course languages. The first entry is the card\'s primary (front) language. List base languages first, then target languages in the exact order provided in the context.',
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

    if (args.translations.length === 0) {
      throw new Error('translations must not be empty.');
    }

    await ctx.runMutation(
      internal.features.chat.cardApprovals.createApprovalRequestInternal,
      {
        threadId,
        messageId,
        toolCallId,
        translations: args.translations,
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
    extraBody: {
      provider: {
        order: ["inceptron/int4", "fireworks"],
        allow_fallbacks: true
      }
    }
    
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
- Do not include any brackets — (), [], {} — in flashcard text or notes contained in brackets.
- Always end sentences in flashcards with a period.
- When creating flashcards, create variations of the current flashcard and avoid repeating the same flashcard. 
- Make sure to always include the correct diacritics, accents etc.
- Unless the user explicitly asks for individual words, always create full sentences instead of individual words. 
- Start the chat with a response to the user and only then create flashcards. 
- There is no need to repeat the vocabulary already mentioned on the cards in the chat because the user can see the cards that get created. 
- Always respond in the language the user asked the question in. This is very important: if the user writes in German, respond in German; if in French, respond in French. Never switch to a different language mid-conversation unless the user does. And don't use another base or target language if the user has not used that language to ask the question.
- For explanations unless specified otherwise, make explanations and grammar about the target language.
- When creating cards with the createCard tool, the translations array must be an array of {language, text} objects. List base languages first, then target languages, in the exact order provided in the context.
- And lastly, do not include any reasoning about these rules or the setup with the languages in the response to the user.`,

  stopWhen: stepCountIs(15),
  tools: {
    createCard: createCardTool,
  },
});
