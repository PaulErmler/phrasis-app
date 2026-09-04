/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { openrouterSttBody, isOpenrouterSttUrl } from '../lib/sttFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * Fan-out budget + idempotency for the text→card add path. The
 * collectionBrowseAdd suite proves the add flows COUNT correctly; this one
 * pins two invariants those tests don't touch:
 *
 *  1. one add schedules exactly ONE content-preparation job — a fan-out
 *     regression (N jobs per card) multiplies real TTS/LLM spend silently;
 *  2. repeating the same add (double-click, optimistic re-dispatch, OCC
 *     retry) inserts NO second card and schedules NO second job — the
 *     server-side half of the duplicate-card invariant the deck-integrity
 *     e2e asserts from the browser;
 *
 * and, by draining the chain to completion, that the scheduled work
 * TERMINATES instead of re-enqueueing itself (a runaway chain would spin
 * until the vitest timeout, failing loudly).
 */

async function seedCourseWithOneText(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 1,
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
      cardCount: 0,
    });
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        sentences: { balance: 100, included: 100, used: 0, unlimited: false },
      },
      lastSyncedAt: Date.now(),
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hola mundo',
      language: 'es',
      userCreated: false,
      collectionId: collId,
      collectionRank: 1,
    });
    return { deckId, textId };
  });
}

/**
 * Stub every host the prepareCardContent fan-out (translation → TTS → STT)
 * can reach, under fake timers, so the scheduled chain can be drained with
 * `t.finishAllScheduledFunctions(vi.runAllTimers)`. Unknown hosts throw so
 * the test fails loudly if the chain wanders into unmocked territory.
 * (Copied from collectionBrowseAdd.test.ts — per-file helper copies are
 * this suite's existing pattern.)
 */
async function withContentChainMocks(fn: () => Promise<void>) {
  vi.useFakeTimers();
  vi.stubEnv('GOOGLE_TTS_API_KEY', 'dummy');
  vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'dummy');

  const translateBody = JSON.stringify({
    data: { translations: [{ translatedText: 'translated' }] },
  });
  const sttBody = openrouterSttBody('translated');
  const googleTtsBody = JSON.stringify({
    audioContent: Buffer.from('fake-mp3-bytes').toString('base64'),
  });
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('translation.googleapis.com/language/translate/v2')) {
      return new Response(translateBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isOpenrouterSttUrl(u)) {
      return new Response(sttBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('texttospeech.googleapis.com')) {
      return new Response(googleTtsBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch to ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  try {
    await fn();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}

function getDeckCards(t: TestConvex<typeof schema>, deckId: Id<'decks'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
      .collect(),
  );
}

function getPendingJobs(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const jobs = await ctx.db.system.query('_scheduled_functions').collect();
    return jobs.filter(
      (j) => j.state.kind === 'pending' || j.state.kind === 'inProgress',
    );
  });
}

describe('card add fan-out and idempotency', () => {
  it('one add → one card, one content job; a repeat add changes nothing; the chain terminates', async () => {
    const t = convexTest(schema, modules);
    const { deckId, textId } = await seedCourseWithOneText(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await withContentChainMocks(async () => {
      const first = await asUser.mutation(
        api.features.decks.addSingleTextFromCollection,
        { textId },
      );
      expect(first).toEqual({ added: true, alreadyAdded: false });

      expect(await getDeckCards(t, deckId)).toHaveLength(1);
      const jobsAfterFirst = await getPendingJobs(t);
      const contentJobs = jobsAfterFirst.filter((j) =>
        j.name.includes('prepareCardContent'),
      );
      expect(contentJobs).toHaveLength(1);

      // Double dispatch (double-click / optimistic re-send / OCC retry
      // shape): must be a no-op on both the card and the job queue.
      const second = await asUser.mutation(
        api.features.decks.addSingleTextFromCollection,
        { textId },
      );
      expect(second).toEqual({ added: false, alreadyAdded: true });
      expect(await getDeckCards(t, deckId)).toHaveLength(1);
      const jobsAfterSecond = await getPendingJobs(t);
      expect(jobsAfterSecond).toHaveLength(jobsAfterFirst.length);

      // Drain the whole chain. A self-re-enqueueing job would never let
      // this return (vitest timeout = loud failure).
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Terminated: nothing pending, and the card population is unchanged.
      expect(await getPendingJobs(t)).toHaveLength(0);
      const cards = await getDeckCards(t, deckId);
      expect(cards).toHaveLength(1);
      expect(cards[0].textId).toBe(textId);
    });
  });
});
