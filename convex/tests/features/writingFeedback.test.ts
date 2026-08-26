/// <reference types="vite/client" />
import { vi } from 'vitest';

// Keep the edge runtime happy: the action imports the AI SDK + openrouter
// provider; tests drive the grader through this mock.
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: '{}' })),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => ({}),
}));

import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach } from 'vitest';
import { generateText } from 'ai';
import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import {
  parseFeedbackResponse,
  writingAnswersMatch,
  WRITING_ALTERNATIVES_MAX,
} from '../../features/writingFeedback';

const modules = import.meta.glob('/convex/**/*.ts');

const mockedGenerateText = vi.mocked(generateText);

function mockGraderReply(reply: string) {
  mockedGenerateText.mockResolvedValueOnce({
    text: reply,
    usage: { inputTokens: 100, outputTokens: 50 },
    providerMetadata: { openrouter: { id: 'gen_1', usage: { cost: 0.0002 } } },
  } as never);
}

async function seedCard(
  t: TestConvex<typeof schema>,
  opts: {
    userId?: string;
    aiFeedbackBalance?: number;
    /** Omit the ai_feedback entry entirely (account predating the feature). */
    withoutAiFeedbackEntry?: boolean;
    planId?: string;
  } = {},
) {
  const userId = opts.userId ?? 'user_A';
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'I would like a coffee, please.',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
      register: 'neutral',
    });
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'es',
      translatedText: 'Quisiera un café, por favor.',
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      dueDate: 0,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    await ctx.db.insert('usageQuotas', {
      userId,
      features: opts.withoutAiFeedbackEntry
        ? {}
        : {
            ai_feedback: {
              balance: opts.aiFeedbackBalance ?? 10,
              included: 10,
              used: 0,
              unlimited: false,
            },
          },
      lastSyncedAt: Date.now(),
      ...(opts.planId ? { planId: opts.planId } : {}),
    });
    return { cardId, textId };
  });
}

async function aiFeedbackBalance(t: TestConvex<typeof schema>, userId = 'user_A') {
  return t.run(async (ctx) => {
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    return doc?.features?.ai_feedback?.balance;
  });
}

describe('features/writingFeedback', () => {
  beforeEach(() => {
    mockedGenerateText.mockClear();
  });

  describe('writingAnswersMatch', () => {
    it('ignores punctuation, case, and whitespace', () => {
      expect(
        writingAnswersMatch('Quisiera un café, por favor.', 'quisiera un café por favor', 'es'),
      ).toBe(true);
    });

    it('does not absorb real typos (no edit-distance tolerance)', () => {
      expect(
        writingAnswersMatch('Quisiera un café.', 'Quisiera un cafe.', 'es'),
      ).toBe(false);
    });
  });

  describe('parseFeedbackResponse', () => {
    it('parses a fenced reply and clamps notes to two', () => {
      const parsed = parseFeedbackResponse(
        '```json\n' +
          JSON.stringify({
            verdict: 'partial',
            corrected: 'Quisiera un café, por favor.',
            notes: [
              { type: 'grammar', text: 'a' },
              { type: 'vocab', text: 'b' },
              { type: 'spelling', text: 'c' },
            ],
            altOk: false,
          }) +
          '\n```',
      );
      expect(parsed?.verdict).toBe('partial');
      expect(parsed?.notes).toHaveLength(2);
    });

    it('repairs the observed dropped-text-key malformation', () => {
      // Real Luna reply from 2026-08-25: {"type":"register":"…"} instead of
      // {"type":"register","text":"…"}.
      const parsed = parseFeedbackResponse(
        '{"verdict":"partial","corrected":"ちょっと待って。","notes":[{"type":"register":"「ください」makes the sentence polite, but the source is informal."}],"altOk":false}',
      );
      expect(parsed?.verdict).toBe('partial');
      expect(parsed?.notes[0]).toEqual({
        type: 'register',
        text: '「ください」makes the sentence polite, but the source is informal.',
      });
    });

    it('maps unknown note types to naturalness and rejects unknown verdicts', () => {
      const parsed = parseFeedbackResponse(
        JSON.stringify({
          verdict: 'minor',
          notes: [{ type: 'sarcasm', text: 'x' }],
        }),
      );
      expect(parsed?.notes[0].type).toBe('naturalness');
      expect(parseFeedbackResponse(JSON.stringify({ verdict: 'great' }))).toBeNull();
      expect(parseFeedbackResponse('not json')).toBeNull();
    });
  });

  describe('gradeWritingAnswer', () => {
    it('rejects unauthenticated', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);
      await expect(
        t.action(api.features.writingFeedback.gradeWritingAnswer, {
          cardId,
          language: 'es',
          userAnswer: 'hola',
        }),
      ).rejects.toThrow();
    });

    it('rejects answers over the card text cap', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.action(api.features.writingFeedback.gradeWritingAnswer, {
          cardId,
          language: 'es',
          userAnswer: 'a'.repeat(200),
        }),
      ).rejects.toThrow(/length/i);
    });

    it("refuses another user's card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t, { userId: 'user_B' });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.action(api.features.writingFeedback.gradeWritingAnswer, {
          cardId,
          language: 'es',
          userAnswer: 'hola',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('matches the primary locally: no quota, no LLM', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const result = await asUser.action(
        api.features.writingFeedback.gradeWritingAnswer,
        { cardId, language: 'es', userAnswer: 'quisiera un café por favor' },
      );
      expect(result).toEqual({ verdict: 'correct', matched: 'primary' });
      expect(mockedGenerateText).not.toHaveBeenCalled();
      expect(await aiFeedbackBalance(t)).toBe(10);
    });

    it('grades via the LLM, consumes quota, and stores the accepted alternative', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      mockGraderReply(
        JSON.stringify({
          verdict: 'alsoCorrect',
          corrected: 'Me gustaría un café, por favor.',
          notes: [{ type: 'register', text: 'Both are polite requests.' }],
          altOk: true,
        }),
      );

      const result = await asUser.action(
        api.features.writingFeedback.gradeWritingAnswer,
        { cardId, language: 'es', userAnswer: 'Me gustaría un café, por favor' },
      );
      expect(result.verdict).toBe('alsoCorrect');
      expect(result.savedAlternative).toBe(true);
      expect(await aiFeedbackBalance(t)).toBe(9);

      const alternatives = await t.run((ctx) =>
        ctx.db
          .query('writingAlternatives')
          .withIndex('by_cardId_and_language', (q) =>
            q.eq('cardId', cardId).eq('language', 'es'),
          )
          .collect(),
      );
      expect(alternatives).toHaveLength(1);
      expect(alternatives[0].text).toBe('Me gustaría un café, por favor.');

      // Resubmitting the stored alternative now matches locally: free.
      const repeat = await asUser.action(
        api.features.writingFeedback.gradeWritingAnswer,
        { cardId, language: 'es', userAnswer: 'me gustaría un café por favor' },
      );
      expect(repeat).toEqual({ verdict: 'correct', matched: 'alternative' });
      expect(mockedGenerateText).toHaveBeenCalledTimes(1);
      expect(await aiFeedbackBalance(t)).toBe(9);
    });

    it('does not store an alternative when altOk is false', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      mockGraderReply(
        JSON.stringify({
          verdict: 'alsoCorrect',
          corrected: 'Dame un café.',
          notes: [{ type: 'register', text: 'Much more direct than the card.' }],
          altOk: false,
        }),
      );
      const result = await asUser.action(
        api.features.writingFeedback.gradeWritingAnswer,
        { cardId, language: 'es', userAnswer: 'Dame un café' },
      );
      expect(result.verdict).toBe('alsoCorrect');
      expect(result.savedAlternative).toBe(false);
      const count = await t.run((ctx) =>
        ctx.db.query('writingAlternatives').collect(),
      );
      expect(count).toHaveLength(0);
    });

    it('returns verdict error on an unparseable grader reply', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      mockGraderReply('The answer is wrong because...');
      const result = await asUser.action(
        api.features.writingFeedback.gradeWritingAnswer,
        { cardId, language: 'es', userAnswer: 'Dame un café' },
      );
      expect(result.verdict).toBe('error');
      // Quota was consumed; the model ran, it just replied garbage.
      expect(await aiFeedbackBalance(t)).toBe(9);
    });

    it('self-heals an account whose quota doc predates the feature', async () => {
      vi.stubEnv('AUTUMN_SECRET_KEY', 'am_test_key');
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      try {
        const t = convexTest(schema, modules);
        const { cardId } = await seedCard(t, {
          withoutAiFeedbackEntry: true,
          planId: 'pro',
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        mockGraderReply(
          JSON.stringify({ verdict: 'wrong', corrected: 'Quisiera un café.', notes: [], altOk: false }),
        );
        const result = await asUser.action(
          api.features.writingFeedback.gradeWritingAnswer,
          { cardId, language: 'es', userAnswer: 'Dame un café' },
        );
        expect(result.verdict).toBe('wrong');
        // Autumn got the paid grant with a monthly reset...
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
        expect(String(url)).toContain('/balances.create');
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
          customer_id: 'user_A',
          feature_id: 'ai_feedback',
          included_grant: 20000,
          reset: { interval: 'month' },
        });
        // ...and the local mirror was granted then charged for this grade.
        expect(await aiFeedbackBalance(t)).toBe(19999);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    });

    it('rethrows USAGE_LIMIT when the self-heal cannot reach Autumn', async () => {
      // No AUTUMN_SECRET_KEY stub: getSecretKey throws inside the heal and
      // the original quota error must surface, not the heal error.
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t, { withoutAiFeedbackEntry: true });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.action(api.features.writingFeedback.gradeWritingAnswer, {
          cardId,
          language: 'es',
          userAnswer: 'Dame un café',
        }),
      ).rejects.toThrow(/USAGE_LIMIT/);
      expect(mockedGenerateText).not.toHaveBeenCalled();
    });

    it('throws USAGE_LIMIT when the balance is empty', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t, { aiFeedbackBalance: 0 });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.action(api.features.writingFeedback.gradeWritingAnswer, {
          cardId,
          language: 'es',
          userAnswer: 'Dame un café',
        }),
      ).rejects.toThrow(/USAGE_LIMIT/);
      expect(mockedGenerateText).not.toHaveBeenCalled();
    });
  });

  describe('storeAlternative', () => {
    it('dedupes against the primary and existing rows, and caps the list', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCard(t);

      const store = (text: string) =>
        t.mutation(internal.features.writingFeedback.storeAlternative, {
          userId: 'user_A',
          cardId,
          language: 'es',
          text,
          primary: 'Quisiera un café, por favor.',
        });

      expect(await store('quisiera un café por favor')).toBe(false); // = primary
      expect(await store('Me gustaría un café.')).toBe(true);
      expect(await store('me gustaría un café')).toBe(false); // duplicate

      for (let i = 0; i < WRITING_ALTERNATIVES_MAX + 2; i++) {
        await store(`Un café, por favor, variante ${i}.`);
      }
      const rows = await t.run((ctx) =>
        ctx.db
          .query('writingAlternatives')
          .withIndex('by_cardId_and_language', (q) =>
            q.eq('cardId', cardId).eq('language', 'es'),
          )
          .collect(),
      );
      expect(rows).toHaveLength(WRITING_ALTERNATIVES_MAX);
      // Oldest evicted first: the earliest surviving row is no longer the
      // first stored alternative.
      expect(rows.some((r) => r.text === 'Me gustaría un café.')).toBe(false);
    });
  });
});
