/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { PROGRESS_DISPLAY_INTERVAL } from '../../../lib/constants/learning';
import { llmPool } from '@/convex/lib/workpools';
import { CLAIM_STALE_MS } from '../../features/llmTranslationQueue';
import { resolveAudioPayload } from '../../lib/audioAssets';
import { scheduleMissingContent } from '../../features/decks';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';
import { liveTranslation } from '../../db/translationReads';

const modules = import.meta.glob('/convex/**/*.ts');

// Tests here enqueue content work whose scheduled chains fire on 0ms timers.
// Drain them inside the test context so their logs don't race vitest teardown.
drainSchedulerAfterEach();

// The workpools are module-mocked globally (tests/convexTestSetup.ts, outside convex/ on purpose, see vitest.config.ts). The
// flagTranslation tests assert against the LLM pool's enqueue calls; each
// call's third argument is the worker's fnArgs.
const llmEnqueues = () =>
  vi.mocked(llmPool.enqueueAction).mock.calls.map(
    (c) =>
      c[2] as {
        textId: Id<'texts'>;
        targetLanguage: string;
        ruleOverride?: string;
        replaceExisting?: boolean;
        userSuggestedTranslation?: string;
      },
  );
beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
});

async function seedCardWithCourseAndStats(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert('courseStats', {
      userId: 'user_A',
      courseId,
      totalRepetitions: 0,
      totalTimeMs: 0,
      totalCards: 0,
      currentStreak: 0,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hola mundo',
      language: 'es',
      userCreated: true,
      userId: 'user_A',
      collectionId,
      collectionRank: 1,
    });
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'en',
      translatedText: 'Hello world',
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: Date.now() - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    return { cardId, courseId, deckId, textId };
  });
}

async function seedCardWithCourse(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hola',
      language: 'es',
      userCreated: true,
      userId: 'user_A',
      collectionId,
      collectionRank: 1,
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: Date.now() - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    return { cardId, courseId, deckId, textId };
  });
}

describe('features/scheduling', () => {
  describe('getCardForReview', () => {
    it('returns null unauthenticated', async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.scheduling.getCardForReview, {});
      expect(res).toBeNull();
    });

    it('returns null with no active course', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res).toBeNull();
    });

    it("returns due card for user's active deck", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?._id).toBe(cardId);
      expect(res?.sourceText).toBe('Hola');
    });

    it('honors an explicit client `now` for the due bound and the derived today', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      // At a `now` before the card's dueDate, nothing is due.
      const dueDate = await t.run(
        async (ctx) => (await ctx.db.get(cardId))!.dueDate,
      );
      expect(
        await asUser.query(api.features.scheduling.getCardForReview, {
          now: dueDate - 60_000,
        }),
      ).toBeNull();

      // At a fixed historical `now` past the dueDate the card IS served, and
      // the dailyReviewsToday side-channel reads the dailyStats row for that
      // instant's calendar date, not the server clock's.
      const fixedNow = Date.UTC(2024, 0, 15, 12, 0, 0);
      await t.run(async (ctx) => {
        await ctx.db.patch(cardId, { dueDate: fixedNow - 1000 });
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: '2024-01-15',
          reps: 6,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 6,
          reviewsByMode: { audio: 4, full: 2, radio: 0 },
        });
      });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {
        timezone: 'UTC',
        now: fixedNow,
      });
      expect(res?._id).toBe(cardId);
      expect(res?.dailyReviewsToday).toBe(6);
    });

    it('returns dailyReviewsToday = 0 when timezone is omitted (opt-out)', async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCardWithCourse(t);
      // Even if today's row has plenty of active reviews, omitting `timezone`
      // makes the caller opt out of the count side-channel. The field must
      // be 0 so test callers (and the layout warm-up) don't accidentally
      // depend on it.
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: today,
          reps: 7,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 7,
          reviewsByMode: { audio: 5, full: 2, radio: 0 },
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?.dailyReviewsToday).toBe(0);
    });

    it("returns audio + full from today's dailyStats when timezone is provided (excludes radio)", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCardWithCourse(t);
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: today,
          reps: 12,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 12,
          reviewsByMode: { audio: 4, full: 3, radio: 5 },
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {
        timezone: 'UTC',
      });
      expect(res?.dailyReviewsToday).toBe(7);
    });

    it('returns dailyReviewsToday = 0 when no dailyStats row exists yet today', async () => {
      const t = convexTest(schema, modules);
      await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {
        timezone: 'UTC',
      });
      expect(res?.dailyReviewsToday).toBe(0);
    });
  });

  describe('getCardForReview: card payload assembly', () => {
    /**
     * Seed a due card with fine-grained control over the course language
     * pair, the source text's romanization, the translation rows, and which
     * languages have an audio row. The knobs `buildCardResult` reads.
     */
    async function seedPayloadCard(
      t: TestConvex<typeof schema>,
      opts: {
        baseLanguages?: string[];
        targetLanguages?: string[];
        sourceLanguage?: string;
        sourceText?: string;
        sourceRomanization?: string;
        translations?: Array<{
          targetLanguage: string;
          translatedText: string;
          romanizedText?: string;
        }>;
        audioLanguages?: string[];
      } = {},
    ) {
      const {
        baseLanguages = ['en'],
        targetLanguages = ['es'],
        sourceLanguage = 'es',
        sourceText = 'Hola mundo',
        sourceRomanization,
        translations = [
          { targetLanguage: 'en', translatedText: 'Hello world' },
        ],
        audioLanguages = ['en', 'es'],
      } = opts;
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages,
          targetLanguages,
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: sourceText,
          language: sourceLanguage,
          ...(sourceRomanization !== undefined
            ? { romanizedText: sourceRomanization }
            : {}),
          // A "complete" card includes an IPA transcription (part of
          // hasMissingContent since the annotations refactor), and furigana
          // where the language gets it (ja).
          ipaText: `ipa-${sourceLanguage}`,
          ...(sourceLanguage === 'ja' ? { furiganaText: 'ふりがな' } : {}),
          userCreated: true,
          userId: 'user_A',
          collectionId,
          collectionRank: 1,
        });
        const translationIds: Record<string, Id<'translations'>> = {};
        for (const tr of translations) {
          translationIds[tr.targetLanguage] = await ctx.db.insert(
            'translations',
            {
              textId,
              ipaText: `ipa-${tr.targetLanguage}`,
              ...(tr.targetLanguage === 'ja'
                ? { furiganaText: 'ふりがな' }
                : {}),
              ...tr,
            },
          );
        }
        const audioIds: Record<string, Id<'audioRecordings'>> = {};
        for (const lang of audioLanguages) {
          const storageId = await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])]),
          );
          audioIds[lang] = (
            await insertAudioFixture(ctx, {
              textId,
              language: lang,
              voiceName: `${lang}-voice`,
              storageId,
              ttsQuality: 'validated',
              ttsProvider: 'google',
              voiceGender: 'female',
            })
          ).rowId;
        }
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        return { cardId, textId, courseId, translationIds, audioIds };
      });
    }

    it('returns translations[] in de-duped base→target order with source-entry semantics', async () => {
      const t = convexTest(schema, modules);
      // "de" appears in BOTH base and target → de-duped to one entry that
      // keeps its base-list position. Source "es" enters via the target list.
      await seedPayloadCard(t, {
        baseLanguages: ['en', 'de'],
        targetLanguages: ['es', 'de'],
        sourceLanguage: 'es',
        sourceText: 'Hola mundo',
        sourceRomanization: 'oh-la moon-doh',
        translations: [
          {
            targetLanguage: 'en',
            translatedText: 'Hello world',
            romanizedText: 'heh-loh',
          },
          { targetLanguage: 'de', translatedText: 'Hallo Welt' },
        ],
        audioLanguages: ['en', 'de', 'es'],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?.translations).toEqual([
        {
          language: 'en',
          text: 'Hello world',
          isBaseLanguage: true,
          isTargetLanguage: false,
          romanization: 'heh-loh',
          ipa: 'ipa-en',
          retranslating: false,
        },
        {
          language: 'de',
          text: 'Hallo Welt',
          isBaseLanguage: true,
          isTargetLanguage: true,
          ipa: 'ipa-de',
          retranslating: false,
        },
        {
          // Source entry: text comes from texts.text (no translations row),
          // romanization from texts.romanizedText, ipa from texts.ipaText.
          language: 'es',
          text: 'Hola mundo',
          isBaseLanguage: false,
          isTargetLanguage: true,
          romanization: 'oh-la moon-doh',
          ipa: 'ipa-es',
          retranslating: false,
        },
      ]);
      // audioRecordings mirrors the same language order, one entry per language.
      expect(res?.audioRecordings.map((a) => a.language)).toEqual([
        'en',
        'de',
        'es',
      ]);
      for (const a of res?.audioRecordings ?? []) {
        expect(a.url).not.toBeNull();
        expect(a.voiceName).toBe(`${a.language}-voice`);
      }
      expect(res?.hasMissingContent).toBe(false);
    });

    it('hydrates accepted alternatives with sentinel annotations hidden', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedPayloadCard(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('writingAlternatives', {
          userId: 'user_A',
          cardId,
          language: 'es',
          text: 'Hola mundo entero',
          // '' is the attempted-and-failed sentinel: the payload must omit
          // the key entirely rather than hand the client an empty line.
          romanizedText: '',
          ipaText: 'ipa-alt',
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      const esEntry = res?.translations.find((tr) => tr.language === 'es');
      expect(esEntry?.alternatives).toEqual([
        { text: 'Hola mundo entero', ipa: 'ipa-alt' },
      ]);
    });

    describe('retranslating pill gate', () => {
      it('shows the pill for a fresh claim over a non-empty translation', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedPayloadCard(t);
        await t.run(async (ctx) => {
          await ctx.db.insert('llmTranslationClaims', {
            textId,
            targetLanguage: 'en',
            claimedAt: Date.now(),
          });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        const en = res?.translations.find((tr) => tr.language === 'en');
        expect(en?.retranslating).toBe(true);
      });

      it('hides the pill for a fresh claim when the translated text is still empty', async () => {
        // First-time translations also hold a claim, no prior text means no
        // "Retranslating" pill. The gate is `translatedText.length > 0`.
        const t = convexTest(schema, modules);
        const { textId } = await seedPayloadCard(t, {
          translations: [{ targetLanguage: 'en', translatedText: '' }],
        });
        await t.run(async (ctx) => {
          await ctx.db.insert('llmTranslationClaims', {
            textId,
            targetLanguage: 'en',
            claimedAt: Date.now(),
          });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        const en = res?.translations.find((tr) => tr.language === 'en');
        expect(en?.retranslating).toBe(false);
      });

      it('hides the pill when the claim is stale', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedPayloadCard(t);
        await t.run(async (ctx) => {
          await ctx.db.insert('llmTranslationClaims', {
            textId,
            targetLanguage: 'en',
            claimedAt: Date.now() - CLAIM_STALE_MS - 60_000,
          });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        const en = res?.translations.find((tr) => tr.language === 'en');
        expect(en?.retranslating).toBe(false);
      });

      it('never shows the pill on the source-language entry, even with a fresh claim', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedPayloadCard(t);
        await t.run(async (ctx) => {
          await ctx.db.insert('llmTranslationClaims', {
            textId,
            targetLanguage: 'es',
            claimedAt: Date.now(),
          });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        const es = res?.translations.find((tr) => tr.language === 'es');
        expect(es?.retranslating).toBe(false);
      });
    });

    describe('hasMissingContent', () => {
      it("fires on a missing translation alone, whose entry gets text: ''", async () => {
        const t = convexTest(schema, modules);
        // Audio present for both languages, no romanization language in the
        // course. The absent en translation row is the only gap.
        await seedPayloadCard(t, {
          translations: [],
          audioLanguages: ['en', 'es'],
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        const en = res?.translations.find((tr) => tr.language === 'en');
        expect(en?.text).toBe('');
        expect(res?.audioRecordings.every((a) => a.url !== null)).toBe(true);
        expect(res?.hasMissingContent).toBe(true);
      });

      it('fires on a missing audio url alone', async () => {
        const t = convexTest(schema, modules);
        // Translation present, no romanization language. The missing en
        // audio row is the only gap. getAudioForText still emits an entry
        // for it, with every resolved field null.
        await seedPayloadCard(t, { audioLanguages: ['es'] });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        const en = res?.translations.find((tr) => tr.language === 'en');
        expect(en?.text).toBe('Hello world');
        expect(res?.audioRecordings.find((a) => a.language === 'en')).toEqual({
          language: 'en',
          voiceName: null,
          url: null,
          wordTimings: null,
          ttsQuality: null,
        });
        expect(res?.hasMissingContent).toBe(true);
      });

      it('fires on missing romanization alone for a ROMANIZATION_LANGUAGES member', async () => {
        const t = convexTest(schema, modules);
        // ja needs romanization; its translation row lacks romanizedText.
        // Translation + audio are complete, so that's the only gap.
        const { translationIds } = await seedPayloadCard(t, {
          baseLanguages: ['ja'],
          targetLanguages: ['es'],
          translations: [
            { targetLanguage: 'ja', translatedText: 'こんにちは' },
          ],
          audioLanguages: ['ja', 'es'],
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        let res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?.hasMissingContent).toBe(true);

        // Filling in the romanization is what flips the flag off. Proving
        // it was the romanization cause, not translation or audio.
        await t.run(async (ctx) => {
          await ctx.db.patch(translationIds.ja, {
            romanizedText: 'konnichiwa',
          });
        });
        res = await asUser.query(api.features.scheduling.getCardForReview, {});
        expect(res?.hasMissingContent).toBe(false);
        const ja = res?.translations.find((tr) => tr.language === 'ja');
        expect(ja?.romanization).toBe('konnichiwa');
      });
    });
  });

  describe('masterCard / hideCard / toggleFavoriteCard', () => {
    it('rejects unauthenticated masterCard', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.masterCard, { cardId }),
      ).rejects.toThrow();
    });

    it('marks a card as mastered', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.masterCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isMastered).toBe(true);
    });

    it('unmasters a previously mastered card', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.masterCard, { cardId });
      await asUser.mutation(api.features.scheduling.unmasterCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isMastered).toBe(false);
    });

    it('rejects unauthenticated unmasterCard', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.unmasterCard, { cardId }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card on unmasterCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expect(
        asOther.mutation(api.features.scheduling.unmasterCard, { cardId }),
      ).rejects.toThrow();
    });

    it('hides a card', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.hideCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isHidden).toBe(true);
    });

    it('unhides a previously hidden card', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.hideCard, { cardId });
      await asUser.mutation(api.features.scheduling.unhideCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isHidden).toBe(false);
    });

    it('rejects unauthenticated unhideCard', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.unhideCard, { cardId }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card on unhideCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expect(
        asOther.mutation(api.features.scheduling.unhideCard, { cardId }),
      ).rejects.toThrow();
    });

    it('toggles favorite', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.toggleFavoriteCard, {
        cardId,
      });
      const after = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(after?.isFavorite).toBe(true);
      await asUser.mutation(api.features.scheduling.toggleFavoriteCard, {
        cardId,
      });
      const after2 = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(after2?.isFavorite).toBe(false);
    });

    it("rejects access to another user's card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expect(
        asOther.mutation(api.features.scheduling.hideCard, { cardId }),
      ).rejects.toThrow();
    });
  });

  describe('deleteCardPermanently', () => {
    it('rejects unauthenticated deleteCardPermanently', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.deleteCardPermanently, { cardId }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card on deleteCardPermanently", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expect(
        asOther.mutation(api.features.scheduling.deleteCardPermanently, {
          cardId,
        }),
      ).rejects.toThrow();
      // Card row survives the rejected attempt.
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card).not.toBeNull();
    });

    it('permanently removes the card row and cascade-cleans an orphaned user-created text', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card).toBeNull();
      // The text is user-created (custom) and no other card references it, so it
      // is cascade-cleaned along with any translations/audio (orphan cleanup).
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text).toBeNull();
    });

    it('keeps a shared (premade) text on deleteCardPermanently', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithCourse(t);
      // A shared/premade text (userCreated: false) must never be cascade-deleted
      // Other users' cards may reference it.
      await t.run(async (ctx) => ctx.db.patch(textId, { userCreated: false }));
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      expect(await t.run(async (ctx) => ctx.db.get(cardId))).toBeNull();
      expect(await t.run(async (ctx) => ctx.db.get(textId))).not.toBeNull();
    });

    it('keeps a user-created text still referenced by another card', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, deckId } = await seedCardWithCourse(t);
      // A second card on the same text means it is NOT orphaned.
      await t.run(async (ctx) => {
        const first = await ctx.db.get(cardId);
        await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId: first!.collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      expect(await t.run(async (ctx) => ctx.db.get(cardId))).toBeNull();
      // Still referenced by the second card → text survives.
      expect(await t.run(async (ctx) => ctx.db.get(textId))).not.toBeNull();
    });

    it("cascade-deletes the orphan's translations + audio rows but keeps a blob shared with a surviving text", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, deckId } = await seedCardWithCourse(t);

      // Seed the orphaned text with a real translation + audio row, and a SECOND
      // surviving text (with its own card so it isn't orphaned) whose audio
      // reuses the SAME storageId. The editCard copy-by-storageId shape. The
      // cascade must delete the orphan's rows but keep the shared blob alive.
      const { trId, audioId, sharedBlob, otherTextId, otherAudioId } =
        await t.run(async (ctx) => {
          const trId = await ctx.db.insert('translations', {
            textId,
            targetLanguage: 'es',
            translatedText: 'Hola',
          });
          const sharedBlob = await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])]),
          );
          const { assetId: sharedAssetId, rowId: audioId } =
            await insertAudioFixture(ctx, {
              textId,
              language: 'es',
              voiceName: 'es-test-voice',
              storageId: sharedBlob,
              voiceGender: 'female',
            });
          // Second text + card sharing the same blob.
          const otherTextId = await ctx.db.insert('texts', {
            text: 'Hola dos',
            language: 'es',
            userCreated: true,
            userId: 'user_A',
            collectionId: (await ctx.db.get(textId))!.collectionId,
            collectionRank: 2,
          });
          await ctx.db.insert('cards', {
            deckId,
            textId: otherTextId,
            collectionId: (await ctx.db.get(textId))!.collectionId,
            collectionOrigin: 'premade',
            dueDate: Date.now() - 1000,
            isMastered: false,
            isHidden: false,
            schedulingPhase: 'preReview',
            preReviewCount: 0,
          });
          // Second text shares the same ASSET (the post-narrow sharing shape).
          const { rowId: otherAudioId } = await insertAudioFixture(ctx, {
            textId: otherTextId,
            language: 'es',
            storageId: sharedBlob,
            assetId: sharedAssetId,
          });
          return { trId, audioId, sharedBlob, otherTextId, otherAudioId };
        });

      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });

      await t.run(async (ctx) => {
        // Orphaned text + its translation + its audio row are gone.
        expect(await ctx.db.get(textId)).toBeNull();
        expect(await ctx.db.get(trId)).toBeNull();
        expect(await ctx.db.get(audioId)).toBeNull();
        // The surviving text and its audio row remain.
        expect(await ctx.db.get(otherTextId)).not.toBeNull();
        expect(await ctx.db.get(otherAudioId)).not.toBeNull();
        // Shared blob survives. The surviving text's row still references it.
        expect(await ctx.storage.getUrl(sharedBlob)).not.toBeNull();
      });
    });

    it('getCardForReview skips a deleted card and returns null when nothing is left', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res).toBeNull();
    });

    it("decrements the deck's cardCount, flooring at 0 on a drifted-low counter", async () => {
      const t = convexTest(schema, modules);
      const { cardId, deckId } = await seedCardWithCourse(t); // seeds cardCount: 1
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      // Counter maintained by `deleteCard` in the same transaction.
      expect((await t.run(async (ctx) => ctx.db.get(deckId)))?.cardCount).toBe(
        0,
      );

      // Drifted-low counter (pre-repair state): delete clamps at 0 instead
      // of going negative.
      const secondCardId = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A2',
          textCount: 0,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Adiós',
          language: 'es',
          userCreated: true,
          userId: 'user_A',
          collectionId,
          collectionRank: 1,
        });
        return ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
      });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId: secondCardId,
      });
      expect((await t.run(async (ctx) => ctx.db.get(deckId)))?.cardCount).toBe(
        0,
      );
    });
  });

  describe('editCard: Path B (shared/dataset text)', () => {
    /**
     * Seed a card backed by a *shared* (not user-owned) text so editCard
     * takes the "create new textId, copy unchanged content" branch. Includes
     * a pre-existing audioRecordings row for the source language with every
     * schema field populated so we can assert they all survive the copy.
     */
    async function seedSharedCardWithAudio(t: TestConvex<typeof schema>) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['sv'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        // Shared dataset text (NOT user-owned) → editCard takes Path B.
        const textId = await ctx.db.insert('texts', {
          text: 'Hej',
          language: 'sv',
          userCreated: false,
          audioSpeakerGender: 'female',
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello',
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const { rowId: audioId } = await insertAudioFixture(ctx, {
          textId,
          language: 'sv',
          // Use the current Swedish provider (Gemini) so the row survives the
          // precedence sweep on the copied textId. `gemini` sits at the top of
          // lib/ttsPrecedence.ts (it overrides google/azure/elevenlabs and
          // nothing overrides it), so a google/azure row here would be deleted
          // and regenerated. The test's intent is to verify the copy shares
          // the asset (payload travels with it), not the regen logic.
          voiceName: 'Kore',
          storageId,
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'female',
          speed: 0.9,
          wordTimings: [{ word: 'Hej', start: 0, end: 0.5 }],
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            card_edits: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, audioId, storageId };
      });
    }

    it('copies all audio fields for unchanged languages when Path B creates a new textId', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await seedSharedCardWithAudio(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      // Change only the English translation. Source "sv" is untouched, so its
      // audio row must be copied onto the new textId with all fields intact.
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      // Path B creates a new card pointing at a new textId. Find it by
      // scanning cards and picking the one whose textId changed.
      const allCards = await t.run(async (ctx) =>
        ctx.db.query('cards').collect(),
      );
      const replacement = allCards.find((c) => c.textId !== oldTextId);
      expect(replacement, 'a replacement card should exist').toBeTruthy();
      const newTextId = replacement!.textId;
      const audio = await t.run(async (ctx) => {
        const row = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', newTextId).eq('language', 'sv'),
          )
          .first();
        return row ? resolveAudioPayload(ctx, row) : null;
      });
      // The copy shares the asset, so the resolved payload is identical.
      expect(
        audio,
        'audio row was not copied for unchanged language',
      ).toBeTruthy();
      expect(audio?.voiceName).toBe('Kore');
      expect(audio?.ttsQuality).toBe('validated');
      expect(audio?.ttsProvider).toBe('gemini');
      expect(audio?.voiceGender).toBe('female');
      expect(audio?.speed).toBe(0.9);
      expect(audio?.wordTimings).toEqual([{ word: 'Hej', start: 0, end: 0.5 }]);
    });

    it('keeps the card id and every progress field across a Path B edit', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await seedSharedCardWithAudio(t);
      // "Until rated Good" listening progress + per-card speed overrides +
      // per-mode time averages. The old replace path had to hand-carry each
      // of these; the in-place patch preserves them (and the id, so rows
      // that reference the card — like reviewHistory — stay attached) by
      // construction.
      const historyId = await t.run(async (ctx) => {
        await ctx.db.patch(cardId, {
          goodReviewCount: 3,
          audioSpeedOverrides: { sv: 0.8 },
          reviewTimeStats: { audio: { avgMs: 4200, count: 6 } },
        });
        const card = await ctx.db.get(cardId);
        return ctx.db.insert('reviewHistory', {
          userId: 'user_A',
          courseId: (await ctx.db.get(card!.deckId))!.courseId,
          cardId,
          reviewedAt: Date.now() - 1000,
          date: '2026-08-26',
          timezone: 'UTC',
          track: 'shared',
          phase: 'preReview',
          rating: 'understood',
          prevDueDate: card!.dueDate,
          newDueDate: card!.dueDate + 1,
          prevPreReviewCount: 0,
          wasDefaultRating: false,
          wasFirstReview: true,
          phaseTransitioned: false,
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const allCards = await t.run(async (ctx) =>
        ctx.db.query('cards').collect(),
      );
      const edited = allCards.find((c) => c.textId !== oldTextId);
      expect(
        edited,
        'the edited card should point at the forked text',
      ).toBeTruthy();
      // Same document, not a replacement.
      expect(edited!._id).toBe(cardId);
      expect(edited!.goodReviewCount).toBe(3);
      expect(edited!.audioSpeedOverrides).toEqual({ sv: 0.8 });
      // Same no-backfill rationale as the counters above: an edit must not
      // reset the per-card time-spent running averages.
      expect(edited!.reviewTimeStats).toEqual({
        audio: { avgMs: 4200, count: 6 },
      });
      // reviewHistory rows reference the card by id, so with the id stable
      // the card's permanent history stays attached across the edit.
      const history = await t.run(async (ctx) => ctx.db.get(historyId));
      expect(history?.cardId).toBe(cardId);
      expect(
        await t.run(async (ctx) => ctx.db.get(history!.cardId)),
      ).not.toBeNull();
    });

    it('copies audio for a punctuation-only edit (sounds identical) but not for an audible one', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await seedSharedCardWithAudio(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      // "Hej" → "Hej!". The source text is a changed language for the
      // text write (new textId stores "Hej!") but sounds identical, so its
      // audio must be copied like an unchanged language. "en" changes
      // audibly and gets no copy.
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej!' },
          { language: 'en', text: 'Hello there my friend' },
        ],
        timezone: 'UTC',
      });

      const allCards = await t.run(async (ctx) =>
        ctx.db.query('cards').collect(),
      );
      const replacement = allCards.find((c) => c.textId !== oldTextId);
      expect(replacement, 'a replacement card should exist').toBeTruthy();
      const newTextId = replacement!.textId;

      const newText = await t.run(async (ctx) => ctx.db.get(newTextId));
      expect(newText?.text).toBe('Hej!');

      const svAudio = await t.run(async (ctx) => {
        const row = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', newTextId).eq('language', 'sv'),
          )
          .first();
        return row ? resolveAudioPayload(ctx, row) : null;
      });
      expect(
        svAudio,
        'punctuation-only sv edit must keep (copy) its audio',
      ).toBeTruthy();
      expect(svAudio?.wordTimings).toEqual([
        { word: 'Hej', start: 0, end: 0.5 },
      ]);

      const enAudio = await t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', newTextId).eq('language', 'en'),
          )
          .first(),
      );
      expect(enAudio, 'audibly-changed en must not carry audio').toBeNull();
    });

    it('carries translationSource on unchanged rows and tags edited rows as user-provided', async () => {
      // Seed a Path-B card whose existing en translation was produced by an
      // LLM stage. Editing the source `sv` (not `en`) keeps `en` unchanged,
      // so the logical-copy must carry the existing tag onto the new
      // textId. Add a second target (`de`) and edit it inline to prove the
      // edited branch overwrites to `'user-provided'`.
      const ORIGINAL_EN_SOURCE = 'google/gemini-3.1-flash-lite-preview-none';
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['sv', 'de'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hej',
          language: 'sv',
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello',
          translationSource: ORIGINAL_EN_SOURCE,
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'de',
          translatedText: 'Hallo',
          translationSource: ORIGINAL_EN_SOURCE,
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            card_edits: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId };
      });

      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          // sv (source) changes → forces Path B (new textId).
          { language: 'sv', text: 'Hejsan' },
          // en unchanged → logical-copy must carry the existing tag over.
          { language: 'en', text: 'Hello' },
          // de edited → must be retagged as user-provided.
          { language: 'de', text: 'Hallöchen' },
        ],
        timezone: 'UTC',
      });

      const allCards = await t.run(async (ctx) =>
        ctx.db.query('cards').collect(),
      );
      const replacement = allCards.find((c) => c.textId !== oldTextId);
      expect(
        replacement,
        'Path B should produce a replacement card',
      ).toBeTruthy();
      const newTextId = replacement!.textId;

      const newTranslations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', newTextId))
          .collect(),
      );
      const byLang = Object.fromEntries(
        newTranslations.map((tr) => [tr.targetLanguage, tr.translationSource]),
      );
      expect(byLang.en).toBe(ORIGINAL_EN_SOURCE);
      expect(byLang.de).toBe('user-provided');
    });

    it('preserves radioPlayCount (and radioRoundCounter) across a Path B edit', async () => {
      // The card is patched in place (Path B only re-points its text row),
      // so the radio play-count survives and the "Only new" graduation
      // doesn't reset on edit.
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await seedSharedCardWithAudio(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(cardId, {
          radioPlayCount: 12,
          radioRoundCounter: 3,
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hejsan' }, // source change → Path B
          { language: 'en', text: 'Hello' },
        ],
        timezone: 'UTC',
      });

      const allCards = await t.run(async (ctx) =>
        ctx.db.query('cards').collect(),
      );
      const replacement = allCards.find((c) => c.textId !== oldTextId);
      expect(replacement, 'a replacement card should exist').toBeTruthy();
      expect(replacement?.radioPlayCount).toBe(12);
      expect(replacement?.radioRoundCounter).toBe(3);
    });

    /**
     * Editing ONE language of a premade card hands the user a user-owned copy
     * whose OTHER languages keep the machine `translationSource` they were
     * generated with. That copy is a custom card by every definition, so a
     * later speaker-gender resolution must not rewrite the languages the user
     * didn't touch, which is what the provenance guard now prevents.
     *
     * The gender is patched directly rather than by re-running the metadata
     * step: `resolveCardSpeakerGenders` seeds its coin flip from the textId,
     * which is random per run, so inducing real drift would make this flaky.
     */
    it('protects machine-sourced languages carried onto the user-owned copy', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['sv'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hej',
          language: 'sv',
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        // Machine-translated, unstamped. The shape the sweep used to delete.
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello',
          translationSource: 'google/gemini-3.1-flash-lite-high',
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId,
          language: 'en',
          voiceName: 'Kore',
          storageId,
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'male',
          wordTimings: [{ word: 'Hello', start: 0, end: 0.5 }],
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            card_edits: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId };
      });

      // Edit only the Swedish source → the English translation is carried over
      // untouched onto the new user-owned text.
      await t
        .withIdentity({ subject: 'user_A' })
        .mutation(api.features.scheduling.editCard, {
          cardId,
          translations: [
            { language: 'sv', text: 'Hejsan' },
            { language: 'en', text: 'Hello' },
          ],
          timezone: 'UTC',
        });

      const newTextId = await t.run(async (ctx) => {
        const texts = await ctx.db.query('texts').collect();
        return texts.find((x) => x._id !== oldTextId)!._id;
      });

      // The exposure: a user-owned card carrying machine provenance.
      const carried = await t.run(async (ctx) =>
        liveTranslation(ctx, newTextId, 'en'),
      );
      expect(carried?.translationSource).toBe(
        'google/gemini-3.1-flash-lite-high',
      );
      expect(
        await t.run(async (ctx) => (await ctx.db.get(newTextId))!.userCreated),
      ).toBe(true);

      // A later gender resolution disagrees with the copied audio's voice.
      await t.run(async (ctx) => {
        await ctx.db.patch(newTextId, {
          speakerGender: 'female',
          audioSpeakerGender: 'female',
        });
      });

      const after = await t.run(async (ctx) => {
        const text = (await ctx.db.get(newTextId))!;
        await scheduleMissingContent(ctx, newTextId, text, ['en'], ['sv']);
        return {
          translation: await liveTranslation(ctx, newTextId, 'en'),
          audio: await ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', newTextId).eq('language', 'en'),
            )
            .first(),
        };
      });

      // Wording kept; the wrong-gender voice still dropped for re-synthesis.
      expect(after.translation?.translatedText).toBe('Hello');
      expect(after.audio).toBeNull();
    });
  });

  describe('editCard: curriculum fix suggestion', () => {
    /**
     * Seed a card on a SHARED curriculum text so editCard takes Path B. The
     * text's own language is "sv" and the course is en→sv, so the "en" row is
     * an ordinary translation the user can edit, and "sv" is the curriculum
     * source line. Editing "en" should flag the shared row; editing "sv"
     * should suppress flagging for the whole submission.
     */
    async function seedCurriculumCard(
      t: TestConvex<typeof schema>,
      opts: {
        flagCount?: number;
        translationSource?: string;
        userCreated?: boolean;
      } = {},
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['sv'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hej',
          language: 'sv',
          userCreated: opts.userCreated ?? false,
          ...(opts.userCreated ? { userId: 'user_A' } : {}),
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello',
          ...(opts.flagCount != null ? { flagCount: opts.flagCount } : {}),
          ...(opts.translationSource
            ? { translationSource: opts.translationSource }
            : {}),
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        // Only card_edits is funded. The suggestion path must not need a
        // translation_flags unit; if it consumed one this seed would throw.
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            card_edits: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, translationId };
      });
    }

    it("flags the original shared row and sends the user's wording as a suggestion", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedCurriculumCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      // The ORIGINAL shared row is flagged. Other learners still study it,
      // which is the whole point of doing this on top of the fork.
      const original = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(original?.flagCount).toBe(1);
      expect(original?.translatedText).toBe('Hello');

      const enqueues = llmEnqueues();
      expect(enqueues).toHaveLength(1);
      expect(enqueues[0].textId).toBe(textId);
      expect(enqueues[0].targetLanguage).toBe('en');
      expect(enqueues[0].ruleOverride).toBe('retranslation_high');
      expect(enqueues[0].replaceExisting).toBe(true);
      expect(enqueues[0].userSuggestedTranslation).toBe('Hi there');

      // The fork carries the user's wording, tagged user-provided, and is not
      // itself flagged: the complaint is against the curriculum, not the copy.
      const forked = await t.run(async (ctx) => {
        const cards = await ctx.db.query('cards').collect();
        const replacement = cards.find((c) => c.textId !== textId);
        return replacement
          ? liveTranslation(ctx, replacement.textId, 'en')
          : null;
      });
      expect(forked?.translatedText).toBe('Hi there');
      expect(forked?.translationSource).toBe('user-provided');
      expect(forked?.flagCount).toBeUndefined();
    });

    it('respects the flag cap: an over-cap edit counts but does not enqueue', async () => {
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedCurriculumCard(t, {
        flagCount: 2,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const original = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(original?.flagCount).toBe(3);
      expect(llmEnqueues()).toHaveLength(0);
    });

    it('skips flagging entirely when the edit also changes the curriculum source line', async () => {
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedCurriculumCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      // "sv" is the text's own language. Changing it means the new English is
      // a translation of the user's sentence, not the curriculum's, so it is
      // not evidence the curriculum's English is wrong.
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hejsan' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const original = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(original?.flagCount).toBeUndefined();
      expect(llmEnqueues()).toHaveLength(0);
    });

    it('leaves hand-curated rows alone, counter included', async () => {
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedCurriculumCard(t, {
        translationSource: 'curated-manual',
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      // mayRegenerateTranslation blocks the retranslation, so a flag here
      // would be a complaint nothing will ever act on.
      const original = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(original?.flagCount).toBeUndefined();
      expect(llmEnqueues()).toHaveLength(0);
    });

    it('drops the suggestion when another retranslation already holds the claim', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedCurriculumCard(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'en',
          claimedAt: Date.now(),
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      // The complaint is still recorded; only the suggestion is lost.
      const original = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(original?.flagCount).toBe(1);
      expect(llmEnqueues()).toHaveLength(0);
    });

    it('does not flag when the text is already user-owned (Path A)', async () => {
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedCurriculumCard(t, {
        userCreated: true,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      // Path A patches the row in place; there is no shared row to complain
      // about, and the patched row must not carry a flag from its own owner.
      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe('Hi there');
      expect(row?.flagCount).toBeUndefined();
      expect(llmEnqueues()).toHaveLength(0);
    });
  });

  describe('editCard: Path A (user-owned text, in-place edit)', () => {
    /**
     * Seed a card backed by a USER-OWNED text (userCreated && userId matches)
     * so editCard takes Path A: reuse the textId and patch translations/audio
     * rows in place instead of creating a new text. Audio rows exist for both
     * languages (gemini rows so the precedence sweep in scheduleMissingContent
     * leaves them alone; wordTimings set so no backfill is scheduled).
     */
    async function seedOwnedCardWithAudio(t: ReturnType<typeof convexTest>) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['sv'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hej',
          language: 'sv',
          romanizedText: 'hej-rom',
          romanizationSource: 'google-v3',
          userCreated: true,
          userId: 'user_A',
          audioSpeakerGender: 'female',
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello',
          romanizedText: 'en-rom',
          romanizationSource: 'google-v3',
          translationSource: 'google/gemini-3.1-flash-lite-preview-none',
        });
        const { rowId: svAudioId } = await insertAudioFixture(ctx, {
          textId,
          language: 'sv',
          voiceName: 'Kore',
          storageId: await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])]),
          ),
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'female',
          speed: 0.9,
          wordTimings: [{ word: 'Hej', start: 0, end: 0.5 }],
        });
        const { rowId: enAudioId } = await insertAudioFixture(ctx, {
          textId,
          language: 'en',
          voiceName: 'Leda',
          storageId: await ctx.storage.store(
            new Blob([new Uint8Array([4, 5, 6])]),
          ),
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'female',
          wordTimings: [{ word: 'Hello', start: 0, end: 0.4 }],
        });
        const dueDate = Date.now() - 1000;
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            card_edits: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, translationId, svAudioId, enAudioId, dueDate };
      });
    }

    it('drops a stored alternative that the edit turns into the primary sentence', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCardWithAudio(t);
      const { dupId, keptId } = await t.run(async (ctx) => ({
        // Normalizes equal to the new primary below (punctuation/case).
        dupId: await ctx.db.insert('writingAlternatives', {
          userId: 'user_A',
          cardId,
          language: 'sv',
          text: 'hej då!',
        }),
        keptId: await ctx.db.insert('writingAlternatives', {
          userId: 'user_A',
          cardId,
          language: 'sv',
          text: 'Tjena',
        }),
      }));
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [{ language: 'sv', text: 'Hej då' }],
        timezone: 'UTC',
      });

      await t.run(async (ctx) => {
        // The store path would never have created a row equal to the
        // primary; the edit sweep removes the one it just made equal.
        expect(await ctx.db.get(dupId)).toBeNull();
        expect(await ctx.db.get(keptId)).not.toBeNull();
      });
    });

    it('keeps the textId and patches the translation row in place on a target-language edit', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId, svAudioId, enAudioId, dueDate } =
        await seedOwnedCardWithAudio(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      await t.run(async (ctx) => {
        // No new texts row. The user-owned text is reused as-is.
        const texts = await ctx.db.query('texts').collect();
        expect(texts).toHaveLength(1);
        expect(texts[0]._id).toBe(textId);
        expect(texts[0].text).toBe('Hej');
        expect(texts[0].romanizedText).toBe('hej-rom');

        // Path A patches the card in place: same _id, same dueDate, so it
        // keeps its exact position in the queue.
        const cards = await ctx.db.query('cards').collect();
        expect(cards).toHaveLength(1);
        expect(cards[0]._id).toBe(cardId);
        expect(cards[0].textId).toBe(textId);
        expect(cards[0].dueDate).toBe(dueDate);
        // Defaults the replacement path used to backfill are still applied.
        expect(cards[0].isGraduated).toBe(false);
        expect(cards[0].radioRoundCounter).toBe(0);
        expect(cards[0].radioOrderKey).toEqual(expect.any(Number));

        // The translation row is patched in place: same _id, new text,
        // romanization dropped, re-tagged as user-provided, gender stamped
        // from the text's audioSpeakerGender.
        const translations = await ctx.db.query('translations').collect();
        expect(translations).toHaveLength(1);
        const tr = await ctx.db.get(translationId);
        expect(tr?.translatedText).toBe('Hi there');
        expect(tr?.romanizedText).toBeUndefined();
        expect(tr?.romanizationSource).toBeUndefined();
        expect(tr?.translationSource).toBe('user-provided');
        expect(tr?.speakerGender).toBe('female');

        // Audio: the audibly-changed en row is deleted in place; the
        // untouched sv row keeps its _id and its asset payload.
        expect(await ctx.db.get(enAudioId)).toBeNull();
        const svRow = await ctx.db.get(svAudioId);
        expect(svRow).not.toBeNull();
        const sv = await resolveAudioPayload(ctx, svRow!);
        expect(sv?.voiceName).toBe('Kore');
        expect(sv?.speed).toBe(0.9);
        expect(sv?.wordTimings).toEqual([{ word: 'Hej', start: 0, end: 0.5 }]);
      });
    });

    it('patches the source text in place and clears its romanization on a source edit', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId, svAudioId, enAudioId } =
        await seedOwnedCardWithAudio(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hejsan' },
          { language: 'en', text: 'Hello' },
        ],
        timezone: 'UTC',
      });

      await t.run(async (ctx) => {
        // Same texts row, patched in place with the new source text.
        const texts = await ctx.db.query('texts').collect();
        expect(texts).toHaveLength(1);
        expect(texts[0]._id).toBe(textId);
        expect(texts[0].text).toBe('Hejsan');
        expect(texts[0].romanizedText).toBeUndefined();
        // `romanizedText` and `romanizationSource` travel as a unit. The
        // provenance tag goes with the transliteration it described.
        expect(texts[0].romanizationSource).toBeUndefined();

        // Card patched in place, still pointing at the same textId.
        const cards = await ctx.db.query('cards').collect();
        expect(cards).toHaveLength(1);
        expect(cards[0]._id).toBe(cardId);
        expect(cards[0].textId).toBe(textId);

        // The unchanged en translation row is untouched in place.
        const tr = await ctx.db.get(translationId);
        expect(tr?.translatedText).toBe('Hello');
        expect(tr?.romanizedText).toBe('en-rom');
        expect(tr?.translationSource).toBe(
          'google/gemini-3.1-flash-lite-preview-none',
        );

        // Audio: the audibly-changed sv row is deleted; en keeps its row.
        expect(await ctx.db.get(svAudioId)).toBeNull();
        const enRow = await ctx.db.get(enAudioId);
        expect(enRow).not.toBeNull();
        const en = await resolveAudioPayload(ctx, enRow!);
        expect(en?.voiceName).toBe('Leda');
      });
    });
  });

  describe('reviewCard: dual punctuation accuracy', () => {
    async function reviewWith(
      t: TestConvex<typeof schema>,
      cardId: Id<'cards'>,
      extra: Record<string, number>,
    ) {
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'good',
        timezone: 'UTC',
        forceReviewPhase: true,
        reviewMode: 'full',
        accuracy: 0.8,
        ...extra,
      });
    }

    const readDaily = (t: TestConvex<typeof schema>, courseId: Id<'courses'>) =>
      t.run(async (ctx) =>
        ctx.db
          .query('dailyStats')
          .withIndex('by_userId_and_courseId_and_date', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first(),
      );

    it('records both sums and a shared count when the pair is present', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      await reviewWith(t, cardId, {
        accuracyStrict: 0.8,
        accuracyLenient: 0.95,
      });

      const daily = await readDaily(t, courseId);
      expect(daily?.accuracyStrictSum).toBeCloseTo(0.8);
      expect(daily?.accuracyLenientSum).toBeCloseTo(0.95);
      expect(daily?.accuracyDualCount).toBe(1);

      const stats = await t.run(async (ctx) =>
        ctx.db
          .query('courseStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first(),
      );
      expect(stats?.totalAccuracyStrictSum).toBeCloseTo(0.8);
      expect(stats?.totalAccuracyLenientSum).toBeCloseTo(0.95);
      expect(stats?.totalAccuracyDualCount).toBe(1);
    });

    // The two sums share one count, so a half-written pair would desynchronise
    // the averages permanently. Neither is recorded unless both arrive.
    it('records neither sum when only one half of the pair is sent', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      await reviewWith(t, cardId, { accuracyStrict: 0.8 });

      const daily = await readDaily(t, courseId);
      expect(daily?.accuracyStrictSum).toBeUndefined();
      expect(daily?.accuracyLenientSum).toBeUndefined();
      expect(daily?.accuracyDualCount).toBeUndefined();
      // The legacy series is unaffected by the gate.
      expect(daily?.accuracySum).toBeCloseTo(0.8);
    });

    it('rejects an out-of-range value in either half', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourseAndStats(t);
      await expect(
        reviewWith(t, cardId, { accuracyStrict: 1.4, accuracyLenient: 0.9 }),
      ).rejects.toThrow(/accuracyStrict/);
      await expect(
        reviewWith(t, cardId, { accuracyStrict: 0.9, accuracyLenient: -0.2 }),
      ).rejects.toThrow(/accuracyLenient/);
    });
  });

  describe('reviewCard: progress display plumbing', () => {
    it("returns today's review/time/new-words counts after a review", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourseAndStats(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'understood',
        timezone: 'UTC',
        timeSpentMs: 4_000,
        sessionId: 'session_X',
      });
      expect(result.dailyReviewsToday).toBe(1);
      expect(result.dailyTimeMsToday).toBe(4_000);
      // `dailyNewWordsToday` only counts target-language words. The seed
      // card has "hola" and "mundo" in `es` (target). The base-language
      // translation ("Hello", "world") tracks userWords but doesn't bump
      // this count.
      expect(result.dailyNewWordsToday).toBe(2);
      // First review only triggers a celebration if INTERVAL divides 1.
      expect(result.triggerCelebration).toBe(
        1 % PROGRESS_DISPLAY_INTERVAL === 0,
      );
    });

    it('triggers a celebration on the Nth review where N % INTERVAL === 0', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      // Pre-seed today's reviews so the next one lands exactly on the
      // milestone boundary. UTC matches the timezone arg below.
      // `reviewsByMode.audio` must mirror `reps` here. The milestone trigger
      // counts non-radio reviews (audio + full), and the next review will
      // bump audio from INTERVAL-1 → INTERVAL.
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: today,
          reps: PROGRESS_DISPLAY_INTERVAL - 1,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: PROGRESS_DISPLAY_INTERVAL - 1,
          reviewsByMode: {
            audio: PROGRESS_DISPLAY_INTERVAL - 1,
            full: 0,
            radio: 0,
          },
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'understood',
        timezone: 'UTC',
        sessionId: 'session_X',
      });
      expect(result.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
      expect(result.triggerCelebration).toBe(true);
    });

    it('does not trigger a celebration when progressDisplayEnabled is false, even on a milestone', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: today,
          reps: PROGRESS_DISPLAY_INTERVAL - 1,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: PROGRESS_DISPLAY_INTERVAL - 1,
          reviewsByMode: {
            audio: PROGRESS_DISPLAY_INTERVAL - 1,
            full: 0,
            radio: 0,
          },
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 3,
          progressDisplayEnabled: false,
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'understood',
        timezone: 'UTC',
        sessionId: 'session_X',
      });
      expect(result.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
      expect(result.triggerCelebration).toBe(false);
    });

    it('stamps sessionId on userWords inserted during the review', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'understood',
        timezone: 'UTC',
        sessionId: 'session_X',
      });
      const stamped = await t.run(async (ctx) =>
        ctx.db
          .query('userWords')
          .withIndex('by_userId_and_courseId_and_language', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .filter((q) => q.eq(q.field('sessionId'), 'session_X'))
          .collect(),
      );
      expect(stamped.length).toBeGreaterThan(0);
      // Every stamped row should carry the session id we passed.
      for (const row of stamped) {
        expect(row.sessionId).toBe('session_X');
      }
      // The target-language words ("hola", "mundo") should be among them.
      const esWords = stamped
        .filter((r) => r.language === 'es')
        .map((r) => r.word);
      expect(esWords.sort()).toEqual(['hola', 'mundo']);
    });

    it('does not stamp a sessionId when the review is sent without one', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourseAndStats(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'understood',
        timezone: 'UTC',
      });
      const allWords = await t.run(async (ctx) =>
        ctx.db
          .query('userWords')
          .withIndex('by_userId_and_courseId_and_language', (q) =>
            q.eq('userId', 'user_A'),
          )
          .collect(),
      );
      expect(allWords.length).toBeGreaterThan(0);
      for (const row of allWords) {
        expect(row.sessionId).toBeUndefined();
      }
    });

    it('excludes radio plays from dailyReviewsToday so the milestone fires on the Nth active review', async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      // Pre-seed today's dailyStats with INTERVAL-1 audio reviews PLUS a few
      // radio plays. Total `reps` already exceeds the milestone, but only the
      // audio count drives the celebration trigger.
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: today,
          reps: PROGRESS_DISPLAY_INTERVAL + 4,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: PROGRESS_DISPLAY_INTERVAL + 4,
          reviewsByMode: {
            audio: PROGRESS_DISPLAY_INTERVAL - 1,
            full: 0,
            radio: 5,
          },
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'understood',
        timezone: 'UTC',
        sessionId: 'session_X',
      });
      // dailyReviewsToday is the active count (audio + full), not total reps.
      expect(result.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
      expect(result.triggerCelebration).toBe(true);
    });

    it('accumulates dailyReviewsToday across multiple cards reviewed today', async () => {
      const t = convexTest(schema, modules);
      const { cardId, deckId } = await seedCardWithCourseAndStats(t);

      // Add two more brand-new preReview cards in the same deck so we can
      // do three reviews without any one card transitioning out of preReview.
      const moreCardIds = await t.run(async (ctx) => {
        const collectionId = (await ctx.db.get(cardId))!.collectionId!;
        const ids: string[] = [];
        for (const text of ['Adios', 'Casa']) {
          const newTextId = await ctx.db.insert('texts', {
            text,
            language: 'es',
            userCreated: true,
            userId: 'user_A',
            collectionId,
            collectionRank: 2,
          });
          const id = await ctx.db.insert('cards', {
            deckId,
            textId: newTextId,
            collectionId,
            collectionOrigin: 'premade',
            dueDate: Date.now() - 1000,
            isMastered: false,
            isHidden: false,
            schedulingPhase: 'preReview',
            preReviewCount: 0,
          });
          ids.push(id);
        }
        return ids;
      });

      const asUser = t.withIdentity({ subject: 'user_A' });
      const all = [cardId, ...moreCardIds];
      const counts: number[] = [];
      for (const id of all) {
        const r = await asUser.mutation(api.features.scheduling.reviewCard, {
          cardId: id as typeof cardId,
          rating: 'understood',
          timezone: 'UTC',
          sessionId: 'session_X',
        });
        counts.push(r.dailyReviewsToday);
      }
      expect(counts).toEqual([1, 2, 3]);
    });
  });

  // ============================================================================
  // Radio mode
  // ============================================================================
  //
  // Radio mode bypasses FSRS entirely. Cards are picked by `radioRoundCounter`
  // (lowest first), and the free-play advance only patches `radioRoundCounter` +
  // `lastReviewedAt`. It must NOT touch FSRS state, dueDate, schedulingPhase,
  // or daily stats. The catch-up rule keeps a freshly-added card (counter 0)
  // from monopolizing the queue when other cards are at a high counter.
  describe('radio mode', () => {
    /**
     * Seed a deck with `cards.length` cards, each with the supplied
     * `radioRoundCounter` value (or 0 if unspecified). All cards are
     * non-mastered, non-hidden. courseSettings.schedulingMode is set to
     * 'radio'. Returns ids in insertion order.
     */
    async function seedRadioDeck(
      t: TestConvex<typeof schema>,
      cards: Array<{
        counter?: number;
        text?: string;
        orderKey?: number;
        dueDate?: number;
      }>,
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 3,
          schedulingMode: 'radio',
        });
        // recordRadioPlayStats requires a courseStats row (radio plays bump
        // totalRepetitions, totalTimeMs, totalReviewsByMode.radio, streak).
        await ctx.db.insert('courseStats', {
          userId: 'user_A',
          courseId,
          totalRepetitions: 0,
          totalTimeMs: 0,
          totalCards: 0,
          currentStreak: 0,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: cards.length,
        });
        const cardIds = [];
        for (let i = 0; i < cards.length; i++) {
          const {
            counter = 0,
            text = `card-${i}`,
            orderKey,
            dueDate,
          } = cards[i];
          const textId = await ctx.db.insert('texts', {
            text,
            language: 'es',
            userCreated: true,
            userId: 'user_A',
            collectionId,
            collectionRank: i + 1,
          });
          await ctx.db.insert('translations', {
            textId,
            targetLanguage: 'en',
            translatedText: `EN ${text}`,
          });
          const cardId = await ctx.db.insert('cards', {
            deckId,
            textId,
            collectionId,
            collectionOrigin: 'premade',
            // dueDate is irrelevant for radio picking. Default is a distinct
            // past value so rows insert cleanly; tests that exercise the
            // "plays even when not due" guarantee pass an explicit future
            // value.
            dueDate: dueDate ?? Date.now() - 1000 - i,
            isMastered: false,
            isHidden: false,
            schedulingPhase: 'preReview',
            preReviewCount: 0,
            radioRoundCounter: counter,
            // Default to a deterministic orderKey when the test doesn't care,
            // so the first-pick assertion is stable. Tests that exercise the
            // shuffle behavior pass an explicit value.
            radioOrderKey: orderKey ?? i,
          });
          cardIds.push(cardId);
        }
        return { courseId, deckId, cardIds };
      });
    }

    // ------------------------------------------------------------------------
    // getCardForReview (radio scheduling)
    // ------------------------------------------------------------------------
    describe('getCardForReview', () => {
      it('picks the card with the lowest radioRoundCounter', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 5, text: 'high' },
          { counter: 0, text: 'low' },
          { counter: 3, text: 'mid' },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        // The "low" card (counter 0) should win.
        expect(res?._id).toBe(cardIds[1]);
        expect(res?.sourceText).toBe('low');
      });

      it('ignores dueDate in radio mode (plays cards even when nothing is due)', async () => {
        // Every card here is dated *in the future*, under learnAndReview the
        // query would return null. Radio must still pick by counter so the
        // user can listen at any time, not just when reviews are due.
        const t = convexTest(schema, modules);
        const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000; // +30d
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 10, dueDate: farFuture + 1 },
          { counter: 0, dueDate: farFuture },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?._id).toBe(cardIds[1]);
      });

      it('a freshly inserted card (counter 0) plays before cards at counter 100', async () => {
        // This is the headline behavior: new cards jump to the front of the
        // radio queue regardless of how many times the existing deck has
        // looped. Mirrors the "new card joins after 100 plays" scenario.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: 'old-A' },
          { counter: 100, text: 'old-B' },
          { counter: 0, text: 'fresh' },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?._id).toBe(cardIds[2]);
        expect(res?.sourceText).toBe('fresh');
      });

      it('returns null when the deck is empty', async () => {
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, []);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res).toBeNull();
      });

      it('surfaces radioPlayCount to the client (and leaves it undefined for cards that predate the field)', async () => {
        // The "Only new" limit reads radioPlayCount off the card result; the
        // client treats undefined as 0 (→ baselined off the active review count).
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });

        // seedRadioDeck doesn't set radioPlayCount → undefined on the wire.
        let res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?._id).toBe(cardIds[0]);
        expect(res?.radioPlayCount).toBeUndefined();

        await t.run(async (ctx) => {
          await ctx.db.patch(cardIds[0], { radioPlayCount: 7 });
        });
        res = await asUser.query(api.features.scheduling.getCardForReview, {});
        expect(res?.radioPlayCount).toBe(7);
      });

      it('skips mastered and hidden cards', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 0, text: 'should-be-skipped' },
          { counter: 5, text: 'playable' },
        ]);
        // Master the lowest-counter card so it falls out of the radio queue.
        await t.run(async (ctx) => {
          await ctx.db.patch(cardIds[0], { isMastered: true });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?._id).toBe(cardIds[1]);
      });
    });

    // ------------------------------------------------------------------------
    // advanceFreePlayCard
    // ------------------------------------------------------------------------
    describe('advanceFreePlayCard (listening face)', () => {
      it('rejects unauthenticated callers', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        await expect(
          t.mutation(api.features.scheduling.advanceFreePlayCard, {
            cardId: cardIds[0],
            timezone: 'UTC',
          }),
        ).rejects.toThrow();
      });

      it("rejects access to another user's card", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asOther = t.withIdentity({ subject: 'user_B' });
        await expect(
          asOther.mutation(api.features.scheduling.advanceFreePlayCard, {
            cardId: cardIds[0],
            timezone: 'UTC',
          }),
        ).rejects.toThrow();
      });

      it('increments by 1 when the card is the only one in the deck', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 4 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const result = await asUser.mutation(
          api.features.scheduling.advanceFreePlayCard,
          { cardId: cardIds[0], timezone: 'UTC' },
        );
        expect(result.nextRoundCounter).toBe(5);
        const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        expect(card?.radioRoundCounter).toBe(5);
      });

      it('increments by 1 when all cards share the same counter', async () => {
        // Picked card is at 5, floor (next-lowest) is also 5.
        // newCounter = max(5+1, 5) = 6.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 5 },
          { counter: 5 },
          { counter: 5 },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const result = await asUser.mutation(
          api.features.scheduling.advanceFreePlayCard,
          { cardId: cardIds[0], timezone: 'UTC' },
        );
        expect(result.nextRoundCounter).toBe(6);
      });

      it('catches a fresh card up to one past the floor instead of incrementing by 1', async () => {
        // Headline catch-up rule: picked card at 0, floor at 100.
        // newCounter = max(0, 100) + 1 = 101. The picked card lands one step
        // PAST the rest of the deck. Strictly above every other playable
        // card, so it doesn't replay 99 more times in a row AND so it cannot
        // be immediately re-picked when the random `radioOrderKey` tiebreak
        // would otherwise put it first within a tie.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: 'old-A' },
          { counter: 100, text: 'old-B' },
          { counter: 0, text: 'fresh' },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const result = await asUser.mutation(
          api.features.scheduling.advanceFreePlayCard,
          { cardId: cardIds[2], timezone: 'UTC' },
        );
        expect(result.nextRoundCounter).toBe(101);
        const card = await t.run(async (ctx) => ctx.db.get(cardIds[2]));
        expect(card?.radioRoundCounter).toBe(101);
      });

      it('seeds radioPlayCount from the review count for cards that predate the field, then +1 per play', async () => {
        // The "Only new" limit needs a true radio play-count, distinct from the
        // rotation-position `radioRoundCounter` (which jumps via catch-up). A
        // card with no `radioPlayCount` (predates the field) but a review count
        // of 4 (preReviewCount 4 + 0 reps) seeds to 4, then +1 → 5 on first
        // play, 6 on the next, so an already-practiced card doesn't reset to
        // "new" in radio.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        await t.run(async (ctx) => {
          await ctx.db.patch(cardIds[0], { preReviewCount: 4 });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });

        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        });
        let card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        expect(card?.radioPlayCount).toBe(5);

        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        });
        card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        expect(card?.radioPlayCount).toBe(6);
      });

      it('does not modify FSRS state, dueDate, schedulingPhase, or preReviewCount', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const before = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        });
        const after = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        // FSRS-related fields are untouched.
        expect(after?.fsrsState).toEqual(before?.fsrsState);
        expect(after?.dueDate).toBe(before?.dueDate);
        expect(after?.schedulingPhase).toBe(before?.schedulingPhase);
        expect(after?.preReviewCount).toBe(before?.preReviewCount);
        expect(after?.isGraduated ?? false).toBe(before?.isGraduated ?? false);
      });

      it('stamps lastReviewedAt', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const before = Date.now();
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        });
        const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        expect(card?.lastReviewedAt).toBeGreaterThanOrEqual(before);
      });

      it('plays a full round-robin pass and only revisits the fresh card after each peer plays once', async () => {
        // End-to-end: 3 old cards at counter 100 + 1 fresh card at counter 0.
        // After D plays once and catches up to 100, the next 3 plays should
        // each pick a different one of A/B/C before D could come up again.
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, [
          { counter: 100, text: 'A' },
          { counter: 100, text: 'B' },
          { counter: 100, text: 'C' },
          { counter: 0, text: 'D-fresh' },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });

        const playOrder: string[] = [];
        for (let i = 0; i < 4; i++) {
          const next = await asUser.query(
            api.features.scheduling.getCardForReview,
            {},
          );
          if (!next) break;
          playOrder.push(next.sourceText);
          await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
            cardId: next._id,
            timezone: 'UTC',
          });
        }

        // D plays first (counter 0 wins). Then A, B, C all play in some
        // (now random, see ordering tests below) order before D could be
        // picked again.
        expect(playOrder.length).toBe(4);
        expect(playOrder[0]).toBe('D-fresh');
        expect(playOrder.slice(1).sort()).toEqual(['A', 'B', 'C']);
      });

      it('sequential plays of a single-card deck increment monotonically', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const counters: number[] = [];
        for (let i = 0; i < 4; i++) {
          const r = await asUser.mutation(
            api.features.scheduling.advanceFreePlayCard,
            { cardId: cardIds[0], timezone: 'UTC' },
          );
          counters.push(r.nextRoundCounter);
        }
        expect(counters).toEqual([1, 2, 3, 4]);
      });
    });

    // ------------------------------------------------------------------------
    // advanceFreePlayCard. Stats tracking
    // ------------------------------------------------------------------------
    //
    // Radio plays write LIGHT stats: dailyStats reps/timeMs/reviewsByMode.radio
    // /timeMsByMode.radio + courseStats totals + weekly/monthly/yearly rollups
    // + streak. Word tracking, accuracy, ratings, hour buckets, card-state
    // breakdown, and collection progress are intentionally skipped.
    describe('advanceFreePlayCard: stats (listening face)', () => {
      it('writes dailyStats with reviewsByMode.radio + timeMsByMode.radio', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
          timeSpentMs: 7500,
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query('dailyStats')
            .withIndex('by_userId_and_courseId_and_date', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        expect(daily).not.toBeNull();
        expect(daily?.reps).toBe(1);
        expect(daily?.timeMs).toBe(7500);
        expect(daily?.reviewsByMode?.radio).toBe(1);
        expect(daily?.reviewsByMode?.audio).toBe(0);
        expect(daily?.reviewsByMode?.full).toBe(0);
        expect(daily?.timeMsByMode?.radio).toBe(7500);
        expect(daily?.timeMsByMode?.audio).toBe(0);
        // Skipped fields stay at their no-op defaults.
        expect(daily?.newCards).toBe(0);
        expect(daily?.accuracySum).toBeUndefined();
      });

      it('accumulates radio reps + time across multiple plays the same day', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        for (const ms of [1000, 2000, 3000]) {
          await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
            cardId: cardIds[0],
            timezone: 'UTC',
            timeSpentMs: ms,
          });
        }
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query('dailyStats')
            .withIndex('by_userId_and_courseId_and_date', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        expect(daily?.reps).toBe(3);
        expect(daily?.timeMs).toBe(6000);
        expect(daily?.reviewsByMode?.radio).toBe(3);
        expect(daily?.timeMsByMode?.radio).toBe(6000);
      });

      it('clamps absurd timeSpentMs to MAX_TIME_PER_PLAY_MS (3 minutes)', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
          // 1 hour of "background" time should not all credit as study.
          timeSpentMs: 60 * 60 * 1000,
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query('dailyStats')
            .withIndex('by_userId_and_courseId_and_date', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        expect(daily?.timeMs).toBe(180_000);
      });

      it('treats missing timeSpentMs as zero (no fake time credit)', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query('dailyStats')
            .withIndex('by_userId_and_courseId_and_date', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        expect(daily?.reps).toBe(1);
        expect(daily?.timeMs).toBe(0);
      });

      it('updates courseStats totals + radio counter, but not totalCards', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
          timeSpentMs: 4000,
        });
        const stats = await t.run(async (ctx) =>
          ctx.db
            .query('courseStats')
            .withIndex('by_userId_and_courseId', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        expect(stats?.totalRepetitions).toBe(1);
        expect(stats?.totalTimeMs).toBe(4000);
        expect(stats?.totalReviewsByMode?.radio).toBe(1);
        expect(stats?.totalTimeMsByMode?.radio).toBe(4000);
        // Radio doesn't graduate cards or count "first review". totalCards
        // should stay at the seeded value (0).
        expect(stats?.totalCards).toBe(0);
        expect(stats?.totalWordCount ?? 0).toBe(0);
      });

      it('counts radio activity toward the streak', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        });
        const stats = await t.run(async (ctx) =>
          ctx.db
            .query('courseStats')
            .withIndex('by_userId_and_courseId', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        // currentStreak transitions 0 → 1 on first activity of a fresh course.
        expect(stats?.currentStreak).toBe(1);
        expect(stats?.lastActivityDate).toBeDefined();
      });

      it('populates weekly / monthly / yearly rollups with reviewsByMode.radio', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
          timeSpentMs: 2500,
        });
        const [weekly, monthly, yearly] = await t.run(async (ctx) => {
          const w = await ctx.db
            .query('weeklyStats')
            .withIndex('by_userId_and_courseId', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first();
          const m = await ctx.db
            .query('monthlyStats')
            .withIndex('by_userId_and_courseId', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first();
          const y = await ctx.db
            .query('yearlyStats')
            .withIndex('by_userId_and_courseId', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first();
          return [w, m, y];
        });
        for (const row of [weekly, monthly, yearly]) {
          expect(row).not.toBeNull();
          expect(row?.totalRepetitions).toBe(1);
          expect(row?.totalTimeMs).toBe(2500);
          expect(row?.totalNewCards).toBe(0);
          expect(row?.reviewsByMode?.radio).toBe(1);
          expect(row?.reviewsByMode?.audio).toBe(0);
          expect(row?.reviewsByMode?.full).toBe(0);
        }
      });

      it('does not write per-language stats or word tracking', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
          timeSpentMs: 5000,
        });
        const [dailyLang, langTotals, words] = await t.run(async (ctx) => {
          const dl = await ctx.db
            .query('dailyLanguageStats')
            .withIndex('by_userId_and_courseId_and_date', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .collect();
          const lt = await ctx.db
            .query('languageStats')
            .withIndex('by_userId_and_courseId', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .collect();
          const uw = await ctx.db
            .query('userWords')
            .withIndex('by_userId_and_courseId_and_language', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .collect();
          return [dl, lt, uw];
        });
        expect(dailyLang).toEqual([]);
        expect(langTotals).toEqual([]);
        expect(words).toEqual([]);
      });

      it('does not record a rating, accuracy, or hour bucket', async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
          timeSpentMs: 5000,
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query('dailyStats')
            .withIndex('by_userId_and_courseId_and_date', (q) =>
              q.eq('userId', 'user_A').eq('courseId', courseId),
            )
            .first(),
        );
        // Per-rating counters stay at their default zeros.
        expect(daily?.ratingCounts?.again ?? 0).toBe(0);
        expect(daily?.ratingCounts?.understood ?? 0).toBe(0);
        // Hour buckets weren't passed through, so they stay all-zero.
        expect((daily?.hourBuckets ?? []).every((n) => n === 0)).toBe(true);
        expect(daily?.accuracySum).toBeUndefined();
      });
    });

    // ------------------------------------------------------------------------
    // Random tiebreak via radioOrderKey
    // ------------------------------------------------------------------------
    //
    // The radio queue is sorted by `[deckId, isHidden, isMastered,
    // radioRoundCounter, radioOrderKey]`. Within ties on the counter, the
    // random `radioOrderKey` decides, and gets re-rolled on every play so
    // every loop visits cards in a different order.
    describe('radio tiebreak (radioOrderKey)', () => {
      it('when counters tie, the lower radioOrderKey plays first', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          // All same counter; orderKey decides.
          { counter: 5, text: 'high-key', orderKey: 1000 },
          { counter: 5, text: 'low-key', orderKey: 10 },
          { counter: 5, text: 'mid-key', orderKey: 500 },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?._id).toBe(cardIds[1]);
        expect(res?.sourceText).toBe('low-key');
      });

      it('regenerates radioOrderKey on advance (typically changes the value)', async () => {
        // Run several plays and confirm the orderKey actually moves around
        // rather than staying constant. With a 32-bit random space, hitting
        // the same value twice in a row is astronomically unlikely.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 0, orderKey: 42 },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const seen: number[] = [42];
        for (let i = 0; i < 5; i++) {
          await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
            cardId: cardIds[0],
            timezone: 'UTC',
          });
          const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
          seen.push(card!.radioOrderKey!);
        }
        // All values are integers within the 32-bit positive range.
        for (const k of seen) {
          expect(Number.isInteger(k)).toBe(true);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThan(0x7fffffff);
        }
        // At least 5 distinct values across 6 reads (1 initial + 5 plays).
        // Collisions are vanishingly rare in a 32-bit space.
        expect(new Set(seen).size).toBeGreaterThanOrEqual(5);
      });

      it('over a full loop, orderKeys after each play are all distinct', async () => {
        // End-to-end shuffle check: 4 cards all at counter 100 with explicit
        // initial orderKeys. After one full pass, every card's orderKey has
        // been re-rolled, so the next loop's order is pseudo-random.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: 'A', orderKey: 1 },
          { counter: 100, text: 'B', orderKey: 2 },
          { counter: 100, text: 'C', orderKey: 3 },
          { counter: 100, text: 'D', orderKey: 4 },
        ]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        for (let i = 0; i < 4; i++) {
          const next = await asUser.query(
            api.features.scheduling.getCardForReview,
            {},
          );
          if (!next) break;
          await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
            cardId: next._id,
            timezone: 'UTC',
          });
        }
        const cards = await t.run(async (ctx) =>
          Promise.all(cardIds.map((id) => ctx.db.get(id))),
        );
        const newKeys = cards.map((c) => c!.radioOrderKey!);
        // Every card's key was replaced (none of the seeded values 1..4 stayed).
        for (const k of newKeys) {
          expect([1, 2, 3, 4]).not.toContain(k);
        }
      });
    });

    // ------------------------------------------------------------------------
    // hasPlayableCards
    // ------------------------------------------------------------------------
    describe('hasPlayableCards', () => {
      it('returns false unauthenticated', async () => {
        const t = convexTest(schema, modules);
        const res = await t.query(api.features.scheduling.hasPlayableCards, {});
        expect(res).toBe(false);
      });

      it('returns false with no active course', async () => {
        const t = convexTest(schema, modules);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(false);
      });

      it('returns true when the deck has at least one playable card', async () => {
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(true);
      });

      it('returns false when every card is mastered or hidden', async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 0 },
          { counter: 0 },
        ]);
        await t.run(async (ctx) => {
          await ctx.db.patch(cardIds[0], { isMastered: true });
          await ctx.db.patch(cardIds[1], { isHidden: true });
        });
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(false);
      });

      it('returns false when the deck is empty', async () => {
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, []);
        const asUser = t.withIdentity({ subject: 'user_A' });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(false);
      });
    });
  });

  describe('flagTranslation', () => {
    // Seeds: course en→es with a card; translation row for `en`; audio row
    // for `en`; usage quota with translation_flags balance > 0.
    async function seedFlaggableCard(
      t: TestConvex<typeof schema>,
      opts: {
        flagsBalance?: number;
        flagCount?: number;
        userCreated?: boolean;
      } = {},
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hola mundo',
          language: 'es',
          userCreated: opts.userCreated ?? false,
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello world',
          ...(opts.flagCount != null ? { flagCount: opts.flagCount } : {}),
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const { rowId: audioId } = await insertAudioFixture(ctx, {
          textId,
          language: 'en',
          voiceName: 'en-US-test',
          storageId,
          ttsQuality: 'validated',
          ttsProvider: 'google',
          voiceGender: 'female',
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        const flagsBalance = opts.flagsBalance ?? 10;
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            translation_flags: {
              balance: flagsBalance,
              included: 10,
              used: 10 - flagsBalance,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, translationId, audioId };
      });
    }

    it('first flag increments count, enqueues retranslation_high, keeps audio for the store to decide, charges quota', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedFlaggableCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      const res = await asUser.mutation(
        api.features.scheduling.flagTranslation,
        {
          cardId,
        },
      );
      expect(res).toEqual({ retranslated: true, updatedToLatest: false });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(1);

      // Audio is NOT deleted up front anymore: before the LLM lands we can't
      // know whether the retranslation is audibly different. The delete/keep
      // decision moved into storeTranslationAndScheduleTTS's replaceExisting
      // branch (punctuation-only → keep; audible change → delete + re-TTS).
      const audioRows = await t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'en'),
          )
          .collect(),
      );
      expect(audioRows).toHaveLength(1);

      // Retranslation enqueued into the LLM pool with the retranslation_high
      // override. `replaceExisting: true` ensures storeTranslationAndScheduleTTS
      // will overwrite the existing translatedText when the LLM lands.
      const enqueues = llmEnqueues();
      expect(enqueues).toHaveLength(1);
      expect(enqueues[0].ruleOverride).toBe('retranslation_high');
      expect(enqueues[0].replaceExisting).toBe(true);
      expect(enqueues[0].targetLanguage).toBe('en');

      // Quota debited by exactly 1. Single charge per flag click,
      // regardless of how many languages got retranslated.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(9);
    });

    it('flagging a custom (user-created) text increments flagCount but does not retranslate', async () => {
      // Curriculum texts (userCreated: false) get retranslated via
      // `retranslation_high`. Custom texts (userCreated: true) are
      // flag-only: counter bumps, no LLM enqueue, no quota charge. The
      // LLM has no source-of-truth to second-guess user-created content.
      const t = convexTest(schema, modules);
      const { cardId } = await seedFlaggableCard(t, { userCreated: true });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const res = await asUser.mutation(
        api.features.scheduling.flagTranslation,
        {
          cardId,
        },
      );
      expect(res).toEqual({ retranslated: false, updatedToLatest: false });

      expect(llmEnqueues()).toHaveLength(0);

      // Counter still bumped so the "Flagged" pill surfaces in the UI.
      const translations = await t.run(async (ctx) =>
        ctx.db.query('translations').collect(),
      );
      expect(translations).toHaveLength(1);
      expect(translations[0].flagCount).toBe(1);

      // No quota charge. The helper seeds 10 units, expect all 10 left.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(10);
    });

    it('flags every non-source-language translation at once, single quota charge', async () => {
      // Card with translations in two non-source languages. The mutation
      // should retranslate BOTH but only charge quota once.
      const t = convexTest(schema, modules);
      const { cardId, textId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en', 'fr'],
          targetLanguages: ['es'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hola mundo',
          language: 'es',
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello world',
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'fr',
          translatedText: 'Bonjour le monde',
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            translation_flags: {
              balance: 10,
              included: 10,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId };
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const res = await asUser.mutation(
        api.features.scheduling.flagTranslation,
        {
          cardId,
        },
      );
      expect(res).toEqual({ retranslated: true, updatedToLatest: false });

      // Both translation rows got their flagCount bumped.
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', textId))
          .collect(),
      );
      expect(translations).toHaveLength(2);
      for (const tr of translations) {
        expect(tr.flagCount).toBe(1);
      }

      // Both languages got a pool enqueue.
      const enqueues = llmEnqueues();
      expect(enqueues).toHaveLength(2);
      const enqueuedLangs = enqueues.map((r) => r.targetLanguage).sort();
      expect(enqueuedLangs).toEqual(['en', 'fr']);

      // Single quota charge regardless of language count.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(9);
    });

    it('second flag still enqueues: the cap allows two attempts per row', async () => {
      // FLAG_AUTO_RETRANSLATION_MAX is 2, so a row that has been flagged once
      // gets a second automatic retranslation. The cap is shared with the
      // manual-edit suggestion path, which is why a row can reach it via two
      // different gestures.
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedFlaggableCard(t, {
        flagCount: 1,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const res = await asUser.mutation(
        api.features.scheduling.flagTranslation,
        {
          cardId,
        },
      );
      expect(res).toEqual({ retranslated: true, updatedToLatest: false });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(2);

      const enqueues = llmEnqueues();
      expect(enqueues).toHaveLength(1);
      expect(enqueues[0].ruleOverride).toBe('retranslation_high');

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(9);
    });

    it('over-cap flag only increments counter, no enqueue, no charge', async () => {
      // Pre-seed flagCount=2 (the cap). Next flag bumps it to 3, which is
      // past FLAG_AUTO_RETRANSLATION_MAX, so the short-circuit returns before
      // claiming, enqueuing, or charging quota.
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedFlaggableCard(t, {
        flagCount: 2,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const res = await asUser.mutation(
        api.features.scheduling.flagTranslation,
        {
          cardId,
        },
      );
      expect(res).toEqual({ retranslated: false, updatedToLatest: false });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(3);

      expect(llmEnqueues()).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      // Balance untouched. The over-cap path doesn't bill.
      expect(quota?.features.translation_flags.balance).toBe(10);
    });

    it('when claim is already held, increments counter but skips enqueue and charge', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedFlaggableCard(t);
      // Pre-insert a fresh claim row → `claimLlmTranslationIfAvailable` will
      // return false on the flag path.
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'en',
          claimedAt: Date.now(),
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const res = await asUser.mutation(
        api.features.scheduling.flagTranslation,
        {
          cardId,
        },
      );
      expect(res).toEqual({ retranslated: false, updatedToLatest: false });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(1);

      expect(llmEnqueues()).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(10);
    });

    it('rolls back the flagCount patch when quota is depleted', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedFlaggableCard(t, {
        flagsBalance: 0,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await expect(
        asUser.mutation(api.features.scheduling.flagTranslation, {
          cardId,
        }),
      ).rejects.toThrow();

      // Transaction-level rollback: flagCount stays unset, no claim row
      // remains, no queue row was inserted.
      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount ?? 0).toBe(0);

      const claims = await t.run(async (ctx) =>
        ctx.db
          .query('llmTranslationClaims')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'en'),
          )
          .collect(),
      );
      expect(claims).toHaveLength(0);

      // consumeQuota throws before the enqueue is reached.
      expect(llmEnqueues()).toHaveLength(0);
    });
  });

  describe('regenerateCardAudio', () => {
    async function seedCardWithAudioForAllLanguages(
      t: TestConvex<typeof schema>,
      opts: { audioBalance?: number } = {},
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es', 'fr'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hola',
          language: 'es',
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        // Translations for both `en` (base) and `fr` (extra target). Source
        // language `es` doesn't need a translation row.
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en',
          translatedText: 'Hello',
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'fr',
          translatedText: 'Bonjour',
        });
        // Seed an audio row for each language so we can assert wipe.
        const audioIds: Record<string, unknown> = {};
        for (const lang of ['en', 'es', 'fr'] as const) {
          const storageId = await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])]),
          );
          audioIds[lang] = (
            await insertAudioFixture(ctx, {
              textId,
              language: lang,
              voiceName: `${lang}-test`,
              storageId,
              ttsQuality: 'validated',
              ttsProvider: 'google',
              voiceGender: 'female',
            })
          ).rowId;
        }
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        const balance = opts.audioBalance ?? 5;
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            audio_regenerations: {
              balance,
              included: 5,
              used: 5 - balance,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, audioIds };
      });
    }

    it('deletes every audio row for the card and debits one audio_regenerations unit', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithAudioForAllLanguages(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.regenerateCardAudio, {
        cardId,
        timezone: 'UTC',
      });

      // All audio rows for the card's text are gone (across base + target langs).
      const remaining = await t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_textId', (q) => q.eq('textId', textId))
          .collect(),
      );
      expect(remaining).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.audio_regenerations.balance).toBe(4);
    });

    it('rejects when audio_regenerations quota is depleted', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithAudioForAllLanguages(t, {
        audioBalance: 0,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await expect(
        asUser.mutation(api.features.scheduling.regenerateCardAudio, {
          cardId,
          timezone: 'UTC',
        }),
      ).rejects.toThrow();

      // Audio rows survive the rollback.
      const remaining = await t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_textId', (q) => q.eq('textId', textId))
          .collect(),
      );
      expect(remaining.length).toBeGreaterThan(0);
    });
  });
});
