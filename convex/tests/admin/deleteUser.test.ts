/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi } from 'vitest';

// convex/auth.ts (imported by admin/deleteUser.ts for the preflight helpers)
// requires SITE_URL at module load; vi.hoisted runs before the static imports.
vi.hoisted(() => {
  process.env.SITE_URL ??= 'http://convex-test.invalid';
});

// Record aggregate-namespace clears so the aggregates phase is observable.
// Overrides the no-op global mock in tests/convexTestSetup.ts (which lacks
// `clear`); same pattern as recalcUserCardAggregates.test.ts.
const aggregateCalls = {
  clears: [] as Array<{ namespace: string }>,
};

vi.mock('@convex-dev/aggregate', () => {
  class TableAggregate {
    constructor(_component: unknown, _opts: unknown) {}
    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async clear(_ctx: unknown, opts: { namespace: string }): Promise<void> {
      aggregateCalls.clears.push(opts);
    }
    async count(): Promise<number> {
      return 0;
    }
  }
  return { TableAggregate };
});

// The rate-limiter component is not registered with convex-test; the purge
// resets the accountDeletionRequest bucket at the end of the userTables phase.
vi.mock('../../rateLimiter', () => ({
  rateLimiter: {
    limit: vi.fn(async () => ({ ok: true })),
    check: vi.fn(async () => ({ ok: true })),
    reset: vi.fn(async () => undefined),
  },
  TTS_RATE_LIMIT_BY_PROVIDER: {
    google: 'googleTts',
    gemini: 'geminiTts',
    minimax: 'minimaxTts',
  },
}));

import schema from '../../schema';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { USER_TABLES } from '../../admin/deleteUser';
import { rateLimiter } from '../../rateLimiter';

const modules = import.meta.glob('/convex/**/*.ts');

const VICTIM = 'user_victim';
const VICTIM_EMAIL = 'victim@test.invalid';
const OTHER = 'user_other';

describe('USER_TABLES coverage checklist', () => {
  // Tables whose user rows are removed by a dedicated phase (or, for
  // accountDeletions, deliberately survive as the audit record). Adding a
  // userId-carrying table to the schema without extending USER_TABLES or
  // this list fails the test, so new user data can't silently outlive the
  // account.
  const HANDLED_ELSEWHERE = new Set([
    'texts', // texts phase (cascade incl. translations/audio/claims)
    'courses', // courses phase
    'cardApprovals', // approvals phase
    'accountDeletions', // audit row, survives on purpose
    // Cards phase: every card deletion routes through `deleteCard`
    // (convex/db/stats/cardAggregates.ts), which drains the card's
    // writingAlternatives rows in the same transaction.
    'writingAlternatives',
  ]);

  it('every schema table with a userId field is purged (or explicitly audit-exempt)', () => {
    const tables = (
      schema as unknown as {
        tables: Record<string, { export(): { documentType: unknown } }>;
      }
    ).tables;
    const userTables = Object.entries(tables)
      .filter(([, def]) =>
        JSON.stringify(def.export().documentType).includes('"userId"'),
      )
      .map(([name]) => name);

    expect(userTables.length).toBeGreaterThan(15);
    const covered = new Set<string>([...USER_TABLES, ...HANDLED_ELSEWHERE]);
    expect(userTables.filter((t) => !covered.has(t))).toEqual([]);
  });
});

interface Fixture {
  courseId: Id<'courses'>;
  deckId: Id<'decks'>;
  premadeColl: Id<'collections'>;
  customColl: Id<'collections'>;
  chatColl: Id<'collections'>;
  premadeText: Id<'texts'>;
  customText: Id<'texts'>;
  otherText: Id<'texts'>;
  otherDeck: Id<'decks'>;
  sharedBlob: Id<'_storage'>;
  uniqueBlob: Id<'_storage'>;
  mismatchBlob: Id<'_storage'>;
  sharedAsset: Id<'audioAssets'>;
  uniqueAsset: Id<'audioAssets'>;
}

/**
 * A compact but complete account: one course with premade + custom content,
 * shared and exclusive audio blobs, one row in every flat per-user table, and
 * a second user whose data must survive untouched.
 */
async function seedFixture(t: TestConvex<typeof schema>): Promise<Fixture> {
  return t.run(async (ctx) => {
    const premadeColl = await ctx.db.insert('collections', {
      name: 'L01',
      textCount: 1,
      origin: 'premade',
    });
    const customColl = await ctx.db.insert('collections', {
      name: 'Custom',
      textCount: 1,
      origin: 'custom',
    });
    const chatColl = await ctx.db.insert('collections', {
      name: 'Chat',
      textCount: 0,
      origin: 'chat',
    });

    const courseId = await ctx.db.insert('courses', {
      userId: VICTIM,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 3,
      chatCollectionId: chatColl,
      customCollectionId: customColl,
      activeCustomCollectionIds: [customColl, chatColl],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 2,
    });

    const premadeText = await ctx.db.insert('texts', {
      text: 'Hola',
      language: 'es',
      userCreated: false,
      collectionId: premadeColl,
      collectionRank: 1,
    });
    const customText = await ctx.db.insert('texts', {
      text: 'Mi gato',
      language: 'es',
      userCreated: true,
      userId: VICTIM,
      collectionId: customColl,
      collectionRank: 1,
    });

    await ctx.db.insert('translations', {
      textId: premadeText,
      targetLanguage: 'en',
      translatedText: 'Hello',
    });
    await ctx.db.insert('translations', {
      textId: customText,
      targetLanguage: 'en',
      translatedText: 'My cat',
    });

    // Shared blob: the victim's custom text and a premade text speak the same
    // string, so they point at one asset. Deleting the account must keep it.
    const sharedBlob = await ctx.storage.store(new Blob(['shared-audio']));
    const sharedAsset = await ctx.db.insert('audioAssets', {
      language: 'es',
      voiceGender: 'female',
      spokenTextHash: 'hash-shared',
      spokenText: 'Hola',
      storageId: sharedBlob,
      voiceName: 'es-Voice',
      speed: 1,
    });
    await ctx.db.insert('audioRecordings', {
      textId: premadeText,
      language: 'es',
      assetId: sharedAsset,
    });
    await ctx.db.insert('audioRecordings', {
      textId: customText,
      language: 'es',
      assetId: sharedAsset,
    });

    // Exclusive blob: only the custom text points at this asset; both the
    // asset and its blob must be gone afterwards.
    const uniqueBlob = await ctx.storage.store(new Blob(['unique-audio']));
    const uniqueAsset = await ctx.db.insert('audioAssets', {
      language: 'en',
      voiceGender: 'male',
      spokenTextHash: 'hash-unique',
      spokenText: 'My cat',
      storageId: uniqueBlob,
      voiceName: 'en-Voice',
      speed: 1,
    });
    await ctx.db.insert('audioRecordings', {
      textId: customText,
      language: 'en',
      assetId: uniqueAsset,
    });

    // Failed-validation audio owns its blob outright.
    const mismatchBlob = await ctx.storage.store(new Blob(['mismatch-audio']));
    await ctx.db.insert('ttsMismatches', {
      textId: customText,
      language: 'es',
      voiceName: 'es-Voice',
      storageId: mismatchBlob,
      expectedText: 'Mi gato',
      transcribedText: 'migato',
      attempt: 1,
    });
    await ctx.db.insert('ttsGenerationClaims', {
      textId: customText,
      language: 'es',
      claimedAt: Date.now(),
    });
    await ctx.db.insert('llmTranslationClaims', {
      textId: customText,
      targetLanguage: 'en',
      claimedAt: Date.now(),
    });

    const now = Date.now();
    await ctx.db.insert('cards', {
      deckId,
      textId: premadeText,
      collectionId: premadeColl,
      collectionOrigin: 'premade',
      dueDate: now,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    const customCard = await ctx.db.insert('cards', {
      deckId,
      textId: customText,
      collectionId: customColl,
      collectionOrigin: 'custom',
      dueDate: now,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });

    // One row in every flat per-user table.
    await ctx.db.insert('userSettings', {
      userId: VICTIM,
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert('onboardingProgress', { userId: VICTIM, step: 5 });
    await ctx.db.insert('courseStats', {
      userId: VICTIM,
      courseId,
      totalRepetitions: 10,
      totalTimeMs: 1000,
      totalCards: 2,
      currentStreak: 3,
    });
    await ctx.db.insert('dailyStats', {
      userId: VICTIM,
      courseId,
      date: '2026-08-20',
      reps: 5,
      newCards: 1,
      timeMs: 500,
      cardsReviewed: 5,
    });
    await ctx.db.insert('reviewLogs', {
      userId: VICTIM,
      courseId,
      cardId: customCard,
      reviewedAt: now,
      timezone: 'UTC',
      kind: 'review',
      date: '2026-08-20',
      schedulingMode: 'learnAndReview',
      studyContentFilter: 'both',
    });
    await ctx.db.insert('reviewHistory', {
      userId: VICTIM,
      courseId,
      cardId: customCard,
      reviewedAt: now,
      date: '2026-08-20',
      timezone: 'UTC',
      track: 'shared',
      phase: 'preReview',
      rating: 'stillLearning',
      wasFirstReview: true,
      prevDueDate: now - 1000,
      newDueDate: now + 60_000,
    });
    await ctx.db.insert('collectionProgress', {
      userId: VICTIM,
      courseId,
      collectionId: premadeColl,
      cardsAdded: 1,
    });
    await ctx.db.insert('collectionTextMarks', {
      userId: VICTIM,
      courseId,
      collectionId: premadeColl,
      textId: premadeText,
      mark: 'ignored',
      collectionRank: 1,
    });
    await ctx.db.insert('dailyLanguageStats', {
      userId: VICTIM,
      courseId,
      date: '2026-08-20',
      language: 'es',
      reps: 5,
      newCards: 1,
      timeMs: 500,
      newWordsCount: 2,
    });
    await ctx.db.insert('userWords', {
      userId: VICTIM,
      courseId,
      language: 'es',
      word: 'gato',
    });
    await ctx.db.insert('userWordTexts', {
      userId: VICTIM,
      courseId,
      language: 'es',
      word: 'gato',
      textId: customText,
    });
    await ctx.db.insert('languageStats', {
      userId: VICTIM,
      courseId,
      language: 'es',
      totalRepetitions: 10,
      totalNewCards: 2,
      totalTimeMs: 1000,
      totalWords: 5,
    });
    await ctx.db.insert('weeklyStats', {
      userId: VICTIM,
      courseId,
      week: '2026-W34',
      totalRepetitions: 10,
      totalNewCards: 2,
      totalTimeMs: 1000,
      activeDays: 2,
    });
    await ctx.db.insert('monthlyStats', {
      userId: VICTIM,
      courseId,
      month: '2026-08',
      totalRepetitions: 10,
      totalNewCards: 2,
      totalTimeMs: 1000,
      activeDays: 2,
      activeWeeks: 1,
    });
    await ctx.db.insert('yearlyStats', {
      userId: VICTIM,
      courseId,
      year: '2026',
      totalRepetitions: 10,
      totalNewCards: 2,
      totalTimeMs: 1000,
      activeDays: 2,
      activeWeeks: 1,
      activeMonths: 1,
    });
    await ctx.db.insert('reviewDepthAccuracy', {
      userId: VICTIM,
      courseId,
      reviewNumber: 1,
      accuracySum: 90,
      count: 1,
    });
    await ctx.db.insert('usageQuotas', {
      userId: VICTIM,
      features: { chat_messages: { balance: 10, included: 10, used: 0 } },
      lastSyncedAt: now,
    });
    await ctx.db.insert('billingTestOverrides', {
      userId: VICTIM,
      planStatus: 'past_due',
    });
    await ctx.db.insert('admins', { email: VICTIM_EMAIL, userId: VICTIM });
    await ctx.db.insert('userProfiles', {
      userId: VICTIM,
      email: VICTIM_EMAIL,
      name: 'Victim',
      createdAt: now,
      searchText: `${VICTIM_EMAIL} victim`,
    });
    const victimCardEditId = await ctx.db.insert('cardEdits', {
      userId: VICTIM,
      courseId,
      kind: 'manual_edit',
      path: 'fork',
      cardIdBefore: customCard,
      cardIdAfter: customCard,
      textIdBefore: premadeText,
      textIdAfter: premadeText,
      textWasUserCreated: false,
      sourceLanguage: 'en',
      sourceText: 'My cat',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
      changes: [
        {
          language: 'es',
          role: 'target',
          isSourceLanguage: false,
          before: 'Mi gato',
          after: 'Mi gata',
          soundsSame: false,
        },
      ],
    });
    await ctx.db.insert('cardEditRetranslations', {
      cardEditId: victimCardEditId,
      userId: VICTIM,
      language: 'es',
      role: 'target',
      textId: premadeText,
      sourceLanguage: 'en',
      sourceText: 'My cat',
      beforeText: 'Mi gato',
      flagCountAfter: 1,
      status: 'enqueued',
    });
    await ctx.db.insert('cardApprovals', {
      threadId: 'thread_1',
      messageId: 'msg_1',
      toolCallId: 'tool_1',
      translations: [{ language: 'es', text: 'Mi gato' }],
      userId: VICTIM,
      status: 'pending',
    });
    await ctx.db.insert('testAuthEmails', {
      email: VICTIM_EMAIL,
      kind: 'verify',
      subject: 'code',
      otp: '123456',
    });

    // The request row, as requestAccountDeletion would have written it, but
    // already claimed by beginPurge.
    await ctx.db.insert('accountDeletions', {
      userId: VICTIM,
      email: VICTIM_EMAIL,
      status: 'running',
      requestedAt: now,
      startedAt: now,
      phase: 'cards',
      docsDeleted: 0,
    });

    // A second user whose world must be untouched.
    const otherCourse = await ctx.db.insert('courses', {
      userId: OTHER,
      baseLanguages: ['en'],
      targetLanguages: ['fr'],
    });
    const otherDeck = await ctx.db.insert('decks', {
      courseId: otherCourse,
      name: 'od',
      cardCount: 1,
    });
    const otherText = await ctx.db.insert('texts', {
      text: 'Mon chien',
      language: 'fr',
      userCreated: true,
      userId: OTHER,
      collectionId: customColl,
      collectionRank: 2,
    });
    await ctx.db.insert('cards', {
      deckId: otherDeck,
      textId: otherText,
      collectionId: customColl,
      collectionOrigin: 'custom',
      dueDate: now,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    await ctx.db.insert('userSettings', {
      userId: OTHER,
      hasCompletedOnboarding: true,
    });

    return {
      courseId,
      deckId,
      premadeColl,
      customColl,
      chatColl,
      premadeText,
      customText,
      otherText,
      otherDeck,
      sharedBlob,
      uniqueBlob,
      mismatchBlob,
      sharedAsset,
      uniqueAsset,
    };
  });
}

/**
 * Drive purgeBatch until the row reaches the 'auth' phase. The auth phase
 * itself talks to the Better Auth component (not registered with
 * convex-test); it is exercised by the e2e spec against a real deployment.
 */
async function runPurgeToAuthPhase(t: TestConvex<typeof schema>) {
  for (let i = 0; i < 300; i++) {
    await t.mutation(internal.admin.deleteUser.purgeBatch, {
      userId: VICTIM,
      email: VICTIM_EMAIL,
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('accountDeletions')
        .withIndex('by_userId', (q) => q.eq('userId', VICTIM))
        .first(),
    );
    if (row?.phase === 'auth') return;
  }
  throw new Error('purge did not reach the auth phase within 300 batches');
}

describe('admin/deleteUser purge', () => {
  it('removes every trace of the user and nothing of anyone else', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    aggregateCalls.clears = [];

    await runPurgeToAuthPhase(t);

    await t.run(async (ctx) => {
      // Every flat per-user table is empty for the victim; the other user's
      // rows survive.
      for (const table of USER_TABLES) {
        const rows = await ctx.db.query(table).collect();
        const victimRows = rows.filter(
          (row) => (row as { userId?: string }).userId === VICTIM,
        );
        expect(victimRows, `table ${table}`).toEqual([]);
      }
      const otherSettings = await ctx.db
        .query('userSettings')
        .withIndex('by_userId', (q) => q.eq('userId', OTHER))
        .collect();
      expect(otherSettings).toHaveLength(1);

      // Cards, deck, course, courseSettings gone; other user's card intact.
      expect(
        await ctx.db
          .query('cards')
          .withIndex('by_deckId', (q) => q.eq('deckId', fx.deckId))
          .collect(),
      ).toEqual([]);
      expect(await ctx.db.get(fx.deckId)).toBeNull();
      expect(await ctx.db.get(fx.courseId)).toBeNull();
      expect(
        await ctx.db
          .query('courseSettings')
          .withIndex('by_courseId', (q) => q.eq('courseId', fx.courseId))
          .collect(),
      ).toEqual([]);
      expect(
        await ctx.db
          .query('cards')
          .withIndex('by_deckId', (q) => q.eq('deckId', fx.otherDeck))
          .collect(),
      ).toHaveLength(1);

      // Text cascade: the victim's text and its content are gone; the
      // premade text (and the other user's text) survive with content.
      expect(await ctx.db.get(fx.customText)).toBeNull();
      expect(await ctx.db.get(fx.premadeText)).not.toBeNull();
      expect(await ctx.db.get(fx.otherText)).not.toBeNull();
      expect(
        await ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', fx.customText))
          .collect(),
      ).toEqual([]);
      expect(
        await ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', fx.premadeText))
          .collect(),
      ).toHaveLength(1);

      // Audio: the shared asset + blob survive (premade still points at
      // them); the exclusive asset + blob and the mismatch blob are gone.
      expect(await ctx.db.get(fx.sharedAsset)).not.toBeNull();
      expect(await ctx.db.system.get(fx.sharedBlob)).not.toBeNull();
      expect(await ctx.db.get(fx.uniqueAsset)).toBeNull();
      expect(await ctx.db.system.get(fx.uniqueBlob)).toBeNull();
      expect(await ctx.db.system.get(fx.mismatchBlob)).toBeNull();
      expect(
        await ctx.db
          .query('ttsMismatches')
          .withIndex('by_textId', (q) => q.eq('textId', fx.customText))
          .collect(),
      ).toEqual([]);
      expect(
        await ctx.db
          .query('ttsGenerationClaims')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', fx.customText),
          )
          .collect(),
      ).toEqual([]);
      expect(
        await ctx.db
          .query('llmTranslationClaims')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', fx.customText),
          )
          .collect(),
      ).toEqual([]);

      // Collections: the user's custom + chat rows are gone (custom only
      // after the other user's text was... see below), premade survives.
      expect(await ctx.db.get(fx.chatColl)).toBeNull();
      expect(await ctx.db.get(fx.premadeColl)).not.toBeNull();
      // The custom collection still holds ANOTHER user's text in this
      // fixture, so the purge must refuse to delete it.
      expect(await ctx.db.get(fx.customColl)).not.toBeNull();

      // Chat approvals and E2E email captures gone.
      expect(
        await ctx.db
          .query('cardApprovals')
          .withIndex('by_userId', (q) => q.eq('userId', VICTIM))
          .collect(),
      ).toEqual([]);
      expect(
        await ctx.db
          .query('testAuthEmails')
          .withIndex('by_email', (q) => q.eq('email', VICTIM_EMAIL))
          .collect(),
      ).toEqual([]);

      // The audit row survives with progress recorded.
      const audit = await ctx.db
        .query('accountDeletions')
        .withIndex('by_userId', (q) => q.eq('userId', VICTIM))
        .first();
      expect(audit).not.toBeNull();
      expect(audit?.status).toBe('running'); // 'completed' is set by run() after the auth phase
      expect(audit?.docsDeleted ?? 0).toBeGreaterThan(20);
    });

    // Aggregates: both tracks cleared for the victim's deck (30 shared +
    // 30 writing namespaces).
    expect(aggregateCalls.clears.length).toBe(60);
    expect(
      aggregateCalls.clears.every((c) => c.namespace.startsWith(fx.deckId)),
    ).toBe(true);

    // The request-rate bucket was reset so a future same-id user (impossible
    // in prod, but cheap to guarantee) starts fresh.
    expect(vi.mocked(rateLimiter.reset)).toHaveBeenCalledWith(
      expect.anything(),
      'accountDeletionRequest',
      { key: VICTIM },
    );
  });

  it('is idempotent: a second sweep over an already-purged phase deletes nothing', async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    await runPurgeToAuthPhase(t);

    // Rewind to the first phase, as a crashed-and-rerun operator command
    // would effectively do, and drive it again.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('accountDeletions')
        .withIndex('by_userId', (q) => q.eq('userId', VICTIM))
        .first();
      if (!row) throw new Error('audit row missing');
      await ctx.db.patch(row._id, { phase: 'cards', phaseCursor: undefined });
    });
    const before = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query('accountDeletions')
            .withIndex('by_userId', (q) => q.eq('userId', VICTIM))
            .first()
        )?.docsDeleted,
    );
    await runPurgeToAuthPhase(t);
    const after = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query('accountDeletions')
            .withIndex('by_userId', (q) => q.eq('userId', VICTIM))
            .first()
        )?.docsDeleted,
    );
    expect(after).toBe(before);
  });
});
