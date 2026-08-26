import { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import { requireAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import { getCourseSettings } from '../db/courseSettings';
import {
  schedulingTrackFromSettings,
  type SchedulingMode,
  type SchedulingTrack,
  type StudyContentFilter,
  type TtsPriority,
  type LlmPriority,
} from '../types';
import { ENSURE_CONTENT_LOOKAHEAD } from '../../lib/constants/learning';
import { fetchFreePlayRotation } from '../lib/freePlay';
import { fetchTrackDueCards } from '../lib/dueQueue';
import {
  ProbeNeedsWork,
  scheduleMissingContent,
} from '../lib/contentScheduling';
import { getNextAddableTextsFromRank } from './collectionCardAdding';

/**
 * Upcoming-card content orchestration: which cards each study surface will
 * serve next (due queues per track, free-play rotation heads) and the
 * probe-then-dispatch sweep that pre-generates their content, plus the
 * warm-ahead beyond the collection frontier. The registered ensure/warm
 * functions stay in features/decks.ts and delegate here; the underlying
 * per-text sweep lives in convex/lib/contentScheduling.ts.
 */

/** Handler body of `ensureCardContent`. */
export async function ensureCardContentHandler(
  ctx: MutationCtx,
  args: { textId: Id<'texts'> },
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const userId = await requireAuthUserId(ctx);

  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return { translationsScheduled: 0, audioScheduled: 0 };

  const deck = await getDeckByCourseId(ctx, active.course._id);
  if (!deck) return { translationsScheduled: 0, audioScheduled: 0 };

  // Verify the user actually has a card for this text in their deck
  const card = await getCardByDeckAndText(ctx, deck._id, args.textId);
  if (!card) return { translationsScheduled: 0, audioScheduled: 0 };

  const text = await ctx.db.get(args.textId);
  if (!text) return { translationsScheduled: 0, audioScheduled: 0 };

  return scheduleMissingContent(
    ctx,
    args.textId,
    text,
    active.course.baseLanguages,
    active.course.targetLanguages,
  );
}

/**
 * Query the next N upcoming cards for a given scheduling mode. The card set
 * differs by mode: `learn_new` pulls only new (non-graduated) cards via the
 * graduated index, `learnAndReview` pulls all due cards, and free play
 * (`radio`, either face) has no due filter at all. Its rotations serve by
 * round counter, so the cards to warm are each face's rotation head.
 */
async function getUpcomingCardsForMode(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
  mode: SchedulingMode,
  now: number,
  filter: StudyContentFilter,
  track: SchedulingTrack,
): Promise<Doc<'cards'>[]> {
  if (mode === 'radio') {
    // Both faces: the Radio and Free Study rotations advance independently,
    // so their heads can be entirely different cards.
    //
    // Must go through `fetchFreePlayRotation`. The same selector the serving
    // queue uses. Calling the unfiltered `fetch` here warmed a different set
    // than free play actually serves for anyone on a 'course'/'custom' filter.
    const [radioHead, freeStudyHead] = await Promise.all([
      fetchFreePlayRotation(ctx, deckId, 'radio', filter, ENSURE_CONTENT_LOOKAHEAD),
      fetchFreePlayRotation(ctx, deckId, 'freeStudy', filter, ENSURE_CONTENT_LOOKAHEAD),
    ]);
    const byId = new Map<Id<'cards'>, Doc<'cards'>>();
    for (const card of [...radioHead, ...freeStudyHead]) byId.set(card._id, card);
    return [...byId.values()];
  }
  // Due queues: warm exactly what the serving path (`fetchTrackDueCards`)
  // will read, same track (shared vs writing schedule), same content-source
  // filter. Warming an unfiltered/other-track superset here looked harmless
  // but warmed a different set than the queue actually serves. The same
  // trap the free-play comment above describes.
  return fetchTrackDueCards(
    ctx,
    deckId,
    mode,
    filter,
    track,
    now,
    ENSURE_CONTENT_LOOKAHEAD,
  );
}

/**
 * Schedule missing content (translations + TTS) for the supplied due cards.
 * Shared by the per-mode (`ensureUpcomingCardsContent`) and all-modes
 * (`ensureUpcomingCardsContentAllModes`) ensure mutations. Returns the number
 * of cards that actually needed work.
 *
 * PROBE-THEN-DISPATCH: each card is first run through the sweep in read-only
 * probe mode (see ProbeNeedsWork); only cards that need work get a scheduled
 * per-card `prepareCardContent` mutation. Two properties this buys:
 *  - Steady state (nothing needy, or everything in-flight under claims) does
 *    ZERO writes, and a write-free mutation cannot lose an OCC race — the
 *    2026-08-20 permanent failure ("audioRecordings changed on every retry"
 *    vs completing TTS jobs) is structurally impossible then. It is also one
 *    single billed mutation, no per-card fan-out.
 *  - When cards DO need work, each runs in its own small transaction, so a
 *    completing job conflicts with at most that one card's mutation (cheap
 *    auto-retry) instead of killing the whole sweep.
 */
async function scheduleContentForUpcomingCards(
  ctx: MutationCtx,
  active: { settings: Doc<'userSettings'>; course: Doc<'courses'> },
  cards: Doc<'cards'>[],
): Promise<number> {
  let processed = 0;
  // Batch-load the texts up front (one concurrent read round, not one
  // sequential get per card) before the sequential probe loop.
  const texts = await Promise.all(cards.map((card) => ctx.db.get(card.textId)));
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const text = texts[i];
    if (!text) continue;
    let needsWork = false;
    try {
      await scheduleMissingContent(
        ctx,
        card.textId,
        text,
        active.course.baseLanguages,
        active.course.targetLanguages,
        { probe: true },
      );
    } catch (error) {
      if (error instanceof ProbeNeedsWork) {
        needsWork = true;
      } else {
        // A probe is read-only, so an unexpected throw is data-shaped (bad
        // config etc.) — skip this card, keep probing the rest.
        console.error('[ensureUpcomingCards] probe failed for one card — continuing', {
          textId: card.textId,
          error,
        });
      }
    }
    if (needsWork) {
      await ctx.scheduler.runAfter(0, internal.features.decks.prepareCardContent, {
        textId: card.textId,
        baseLanguages: active.course.baseLanguages,
        targetLanguages: active.course.targetLanguages,
      });
      processed++;
    }
  }

  // This sweep does NOT reach past the deck into not-yet-added collection
  // texts; that proved too late for fast reviewers (batches observed added
  // ~30s apart vs a ~15-40s per-card pipeline), so the batch add now
  // schedules `warmNextCollectionBatch` to pre-generate the next batch
  // beyond the frontier at add time. Preview browsing still generates
  // translations lazily and audio only on an explicit audio-icon click.
  return processed;
}

/** Handler body of `ensureUpcomingCardsContent`. */
export async function ensureUpcomingCardsContentHandler(
  ctx: MutationCtx,
): Promise<number> {
  const userId = await requireAuthUserId(ctx);
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return 0;
  const deck = await getDeckByCourseId(ctx, active.course._id);
  if (!deck) return 0;

  const settings = await getCourseSettings(ctx, active.course._id);
  const schedulingMode = settings?.schedulingMode ?? 'learnAndReview';

  const cards = await getUpcomingCardsForMode(
    ctx,
    deck._id,
    schedulingMode,
    Date.now(),
    settings?.studyContentFilter ?? 'both',
    schedulingTrackFromSettings({
      separateModeTracking: settings?.separateModeTracking,
      reviewMode: settings?.reviewMode,
    }),
  );

  return scheduleContentForUpcomingCards(ctx, active, cards);
}

// Scheduling modes whose upcoming card sets differ for content purposes.
// Free play's rotations serve by round counter with no due filter, so its
// upcoming cards are NOT covered by the due-based modes and must be warmed
// separately (both faces, see getUpcomingCardsForMode).
const WARMABLE_SCHEDULING_MODES: SchedulingMode[] = [
  'learn_new',
  'learnAndReview',
  'radio',
];

/** Handler body of `ensureUpcomingCardsContentAllModes`. */
export async function ensureUpcomingCardsContentAllModesHandler(
  ctx: MutationCtx,
): Promise<number> {
  const userId = await requireAuthUserId(ctx);
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return 0;
  const deck = await getDeckByCourseId(ctx, active.course._id);
  if (!deck) return 0;

  const now = Date.now();
  // Free play's rotation head is filter-dependent, so the warmer needs the
  // same content filter the serving queue reads.
  const settings = await getCourseSettings(ctx, active.course._id);
  const filter = settings?.studyContentFilter ?? 'both';
  // With separateModeTracking on, the home-screen mode toggle switches
  // between two different due queues. Warm both tracks so either choice
  // starts instantly. (Free play ignores the track; it's warmed once.)
  const tracks: SchedulingTrack[] = settings?.separateModeTracking
    ? ['shared', 'writing']
    : ['shared'];
  const cardLists = await Promise.all(
    WARMABLE_SCHEDULING_MODES.flatMap((mode) =>
      (mode === 'radio' ? (['shared'] as SchedulingTrack[]) : tracks).map(
        (track) => getUpcomingCardsForMode(ctx, deck._id, mode, now, filter, track),
      ),
    ),
  );

  // Merge + dedup by card id so overlapping cards are scheduled once.
  const byId = new Map<Id<'cards'>, Doc<'cards'>>();
  for (const list of cardLists) {
    for (const card of list) {
      if (!byId.has(card._id)) byId.set(card._id, card);
    }
  }

  return scheduleContentForUpcomingCards(ctx, active, Array.from(byId.values()));
}

/** Handler body of the internal mutation `prepareCardContent`. */
export async function prepareCardContentHandler(
  ctx: MutationCtx,
  args: {
    textId: Id<'texts'>;
    baseLanguages: string[];
    targetLanguages: string[];
    priority?: TtsPriority;
    llmPriority?: LlmPriority;
  },
): Promise<null> {
  const text = await ctx.db.get(args.textId);
  if (!text) return null;

  await scheduleMissingContent(
    ctx,
    args.textId,
    text,
    args.baseLanguages,
    args.targetLanguages,
    { priority: args.priority, llmPriority: args.llmPriority },
  );
  return null;
}

/** Handler body of the internal mutation `warmNextCollectionBatch`. */
export async function warmNextCollectionBatchHandler(
  ctx: MutationCtx,
  args: {
    collectionId: Id<'collections'>;
    courseId: Id<'courses'>;
    deckId: Id<'decks'>;
    userId: string;
    afterRank: number;
    limit: number;
  },
): Promise<null> {
  const course = await ctx.db.get(args.courseId);
  if (!course) return null;
  const scan = await getNextAddableTextsFromRank(ctx, {
    collectionId: args.collectionId,
    afterRank: args.afterRank,
    limit: args.limit,
    deckId: args.deckId,
    userId: args.userId,
    courseId: args.courseId,
    options: { onlyCurriculum: true },
  });
  for (const text of scan.picked) {
    // Inline (no per-text dispatch): these texts are brand-new to the
    // pipeline, so no jobs are completing against their rows yet and the
    // OCC contention the ensure sweep needed dispatch for doesn't apply.
    // One bad text must still not abort the rest of the warm.
    try {
      await scheduleMissingContent(
        ctx,
        text._id,
        text,
        course.baseLanguages,
        course.targetLanguages,
      );
    } catch (error) {
      console.error('[warmNextCollectionBatch] scheduleMissingContent failed for one text — continuing', {
        textId: text._id,
        error,
      });
    }
  }
  return null;
}
