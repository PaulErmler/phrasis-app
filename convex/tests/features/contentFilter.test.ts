/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Helper: seed a course + deck + three collections (premade, custom, chat) +
 * one card in each collection. Returns ids so tests can drive specific cases.
 *
 * The "premade-edited" case (test #4 in the plan) is captured by inserting a
 * text with `userCreated: true` into the premade collection.
 */
async function seedFilterFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const userId = 'user_F';

    const premadeColl = await ctx.db.insert('collections', {
      name: 'L01',
      textCount: 2,
      origin: 'premade',
    });
    const customColl = await ctx.db.insert('collections', {
      name: 'Custom',
      textCount: 1,
      origin: 'custom',
    });
    const chatColl = await ctx.db.insert('collections', {
      name: 'Chat',
      textCount: 1,
      origin: 'chat',
    });

    const courseId = await ctx.db.insert('courses', {
      userId,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId,
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 3,
      chatCollectionId: chatColl,
      customCollectionId: customColl,
      activeCustomCollectionIds: [customColl, chatColl],
      activeCollectionId: premadeColl,
    });

    const premadeText = await ctx.db.insert('texts', {
      text: 'Hola',
      language: 'es',
      userCreated: false,
      collectionId: premadeColl,
      collectionRank: 1,
    });
    // Edited-premade text: userCreated=true but still in the premade collection.
    const editedPremadeText = await ctx.db.insert('texts', {
      text: 'Adios',
      language: 'es',
      userCreated: true,
      userId,
      collectionId: premadeColl,
      collectionRank: 2,
    });
    const customText = await ctx.db.insert('texts', {
      text: 'Mi gato',
      language: 'es',
      userCreated: true,
      userId,
      collectionId: customColl,
      collectionRank: 1,
    });
    const chatText = await ctx.db.insert('texts', {
      text: 'Buenos dias',
      language: 'es',
      userCreated: true,
      userId,
      collectionId: chatColl,
      collectionRank: 1,
    });

    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 4,
    });

    const now = Date.now();
    const premadeCard = await ctx.db.insert('cards', {
      deckId,
      textId: premadeText,
      collectionId: premadeColl,
      collectionOrigin: 'premade',
      dueDate: now - 4000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    const editedPremadeCard = await ctx.db.insert('cards', {
      deckId,
      textId: editedPremadeText,
      collectionId: premadeColl,
      collectionOrigin: 'premade',
      dueDate: now - 3000,
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
      dueDate: now - 2000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    const chatCard = await ctx.db.insert('cards', {
      deckId,
      textId: chatText,
      collectionId: chatColl,
      collectionOrigin: 'chat',
      dueDate: now - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });

    return {
      userId,
      courseId,
      deckId,
      premadeColl,
      customColl,
      chatColl,
      premadeCard,
      editedPremadeCard,
      customCard,
      chatCard,
    };
  });
}

async function setFilter(
  t: TestConvex<typeof schema>,
  courseId: Id<'courses'>,
  filter: 'custom' | 'course' | 'both',
) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .unique();
    if (!row) throw new Error('courseSettings missing');
    await ctx.db.patch(row._id, { studyContentFilter: filter });
  });
}

describe('content-source filter: getCardForReview', () => {
  it("returns cards from any origin when filter is undefined ('both' default)", async () => {
    const t = convexTest(schema, modules);
    await seedFilterFixture(t);
    const asUser = t.withIdentity({ subject: 'user_F' });
    const res = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    // Earliest dueDate is the premade card.
    expect(res).not.toBeNull();
    expect(res?.sourceText).toBe('Hola');
  });

  it("filter='course' returns only premade-origin cards (including edited-premade)", async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    await setFilter(t, f.courseId, 'course');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const res = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    // Premade card is earliest-due among the premade-origin pool.
    expect(res?._id).toBe(f.premadeCard);
    // Peek-next is the edited-premade card, still classified as course content.
    expect(res?.nextCard?._id).toBe(f.editedPremadeCard);
  });

  it("filter='custom' hides edited-premade text even when text.userCreated=true (regression)", async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    await setFilter(t, f.courseId, 'custom');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const res = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    // The edited-premade card MUST NOT appear under 'custom'. Custom + chat
    // are the only allowed origins; among those, the custom card is earliest-due.
    expect(res?._id).toBe(f.customCard);
    expect(res?.nextCard?._id).toBe(f.chatCard);
  });

  it("filter='custom' groups custom + chat origins together", async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    // Hide custom card so chat is the only candidate.
    await t.run(async (ctx) => {
      await ctx.db.patch(f.customCard, { isHidden: true });
    });
    await setFilter(t, f.courseId, 'custom');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const res = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    expect(res?._id).toBe(f.chatCard);
  });

  it("filter='course' hides chat-origin cards", async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    // Hide both premade cards so chat would be the only candidate under no filter.
    await t.run(async (ctx) => {
      await ctx.db.patch(f.premadeCard, { isHidden: true });
      await ctx.db.patch(f.editedPremadeCard, { isHidden: true });
    });
    await setFilter(t, f.courseId, 'course');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const res = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    // No premade-origin card is visible → null.
    expect(res).toBeNull();
  });
});

describe('content-source filter: getCardForReviewEmptyReason', () => {
  it('can-unblock: currentSourceHasAnyCards=true AND availableInOtherSource=true', async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    // Custom card exists in deck but isn't due (push into future). Course
    // cards are due now. → can-unblock state under filter='custom'.
    await t.run(async (ctx) => {
      const future = Date.now() + 60_000;
      await ctx.db.patch(f.customCard, { dueDate: future });
      await ctx.db.patch(f.chatCard, { dueDate: future });
    });
    await setFilter(t, f.courseId, 'custom');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const reason = await asUser.query(
      api.features.scheduling.getCardForReviewEmptyReason,
      {},
    );
    expect(reason.reason).toBe('filtered_out');
    if (reason.reason === 'filtered_out') {
      expect(reason.activeFilter).toBe('custom');
      expect(reason.currentSourceHasAnyCards).toBe(true);
      expect(reason.availableInOtherSource).toBe(true);
    }
  });

  it('must-add: currentSourceHasAnyCards=false; availableInOtherSource is independent', async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    // Delete all custom/chat cards. User has zero cards in 'custom' source.
    await t.run(async (ctx) => {
      await ctx.db.delete(f.customCard);
      await ctx.db.delete(f.chatCard);
    });
    await setFilter(t, f.courseId, 'custom');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const reason = await asUser.query(
      api.features.scheduling.getCardForReviewEmptyReason,
      {},
    );
    expect(reason.reason).toBe('filtered_out');
    if (reason.reason === 'filtered_out') {
      expect(reason.currentSourceHasAnyCards).toBe(false);
      // Other source still has due cards. The UI keys subtitle copy off
      // currentSourceHasAnyCards (must-add) but the Include-other CTA off
      // availableInOtherSource (still surfaces here).
      expect(reason.availableInOtherSource).toBe(true);
    }
  });

  it('must-add without other-source cards: availableInOtherSource=false too', async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    // Delete every card → both signals false.
    await t.run(async (ctx) => {
      await ctx.db.delete(f.premadeCard);
      await ctx.db.delete(f.editedPremadeCard);
      await ctx.db.delete(f.customCard);
      await ctx.db.delete(f.chatCard);
    });
    await setFilter(t, f.courseId, 'custom');
    const asUser = t.withIdentity({ subject: 'user_F' });

    const reason = await asUser.query(
      api.features.scheduling.getCardForReviewEmptyReason,
      {},
    );
    // With ZERO cards anywhere we degrade to 'no_cards', not 'filtered_out'.
    expect(reason.reason).toBe('no_cards');
  });

  it('honors an explicit client `now`: cards due on the wall clock are not due at an earlier now', async () => {
    const t = convexTest(schema, modules);
    await seedFilterFixture(t);
    const asUser = t.withIdentity({ subject: 'user_F' });

    // Fixture cards go due 1–4s before the wall-clock now; at a `now` two
    // minutes earlier none of them are due yet, so the deck reads as caught
    // up at that instant.
    const reason = await asUser.query(
      api.features.scheduling.getCardForReviewEmptyReason,
      { now: Date.now() - 120_000 },
    );
    expect(reason.reason).toBe('all_caught_up');
  });

  it("returns all_caught_up when filter is 'both' and nothing is due", async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    // Push every card's dueDate into the future so nothing is due.
    await t.run(async (ctx) => {
      const future = Date.now() + 60_000;
      for (const cid of [
        f.premadeCard,
        f.editedPremadeCard,
        f.customCard,
        f.chatCard,
      ]) {
        await ctx.db.patch(cid, { dueDate: future });
      }
    });
    const asUser = t.withIdentity({ subject: 'user_F' });

    const reason = await asUser.query(
      api.features.scheduling.getCardForReviewEmptyReason,
      {},
    );
    expect(reason.reason).toBe('all_caught_up');
  });
});

describe('content-source filter: updateCourseSettings', () => {
  it('persists studyContentFilter and rejects invalid values via validator', async () => {
    const t = convexTest(schema, modules);
    const f = await seedFilterFixture(t);
    const asUser = t.withIdentity({ subject: 'user_F' });

    await asUser.mutation(api.features.courses.updateCourseSettings, {
      courseId: f.courseId,
      studyContentFilter: 'custom',
    });
    const after = await t.run(async (ctx) => {
      return ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', f.courseId))
        .unique();
    });
    expect(after?.studyContentFilter).toBe('custom');

    // Validator should reject anything outside the union.
    await expect(
      asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId: f.courseId,
        // @ts-expect-error. Invalid literal on purpose.
        studyContentFilter: 'neither',
      }),
    ).rejects.toThrow();
  });
});
