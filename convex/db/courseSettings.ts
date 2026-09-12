import { QueryCtx, MutationCtx } from '../_generated/server';
import {
  hyperliteralWantsFor,
  type HyperliteralWants,
} from '../../lib/annotationDisplay';
import { Id, Doc } from '../_generated/dataModel';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';

/**
 * Defaults stamped on a course's settings row the first time one is inserted.
 *
 * Stamping rather than defaulting on read is what makes a new default reach
 * new users WITHOUT flipping the setting for everyone who already has a
 * course: an existing row keeps resolving `undefined` through the read-side
 * default, and only a row created from here carries the new value.
 *
 * Spread FIRST in `upsertCourseSettings` below, so an explicit value from the
 * caller still wins. That is the ONLY place these are stamped, and the reason
 * is worth stating because five other places also insert a `courseSettings`
 * row: `setActiveCollectionOnSettings`, two in features/courses.ts, one in
 * features/collectionCardAdding.ts and one in db/collections.ts.
 *
 * Those five are lazy-create fallbacks for a course whose settings row is
 * MISSING. Both course-creation paths (`createCourse`, `createAdditionalCourse`)
 * call `upsertCourseSettings` in the same mutation that inserts the course, so
 * a course made today always has its row already — which means a fallback can
 * only ever fire for an OLD course, and those are exactly the users a new
 * default must not reach. Stamping there would also break the invariant that
 * `updateCourseSettings` writes the same row whether or not one existed
 * (convex/tests/features/courses.test.ts, "insert/patch field parity").
 */
export const NEW_COURSE_SETTINGS_DEFAULTS = {
  // Practice Listening starts ON, limited to a card's first initial review
  // ("Only new" = 1).
  playTargetBeforeBase: true,
  playTargetAfterBase: true,
  targetBeforeListeningStrategy: 'onlyNew' as const,
  targetBeforeOnlyNewReps: 1,
  // "Show translation on new sentences" (writing mode). Stamped for symmetry
  // even though its read-side fallback is on/1 for everyone.
  showTranslationOnNew: true,
  showTranslationOnlyNewReps: 1,
  // The word-for-word gloss line, ON for new learners. Its read-side default
  // is OFF (lib/annotationDisplay.ts), so no existing course gains the line.
  showHyperliteral: true,
};

/**
 * Get the course settings for a given course.
 * Returns null if no settings document exists yet.
 */
export async function getCourseSettings(
  ctx: QueryCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'courseSettings'> | null> {
  return ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();
}

/**
 * Create or update the course settings for a given course.
 */
export async function upsertCourseSettings(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  values: {
    initialReviewCount: number;
    activeCollectionId?: Id<'collections'>;
    reviewMode?: 'audio' | 'full';
    writingInputMode?: 'translate' | 'transcribe';
    autoAddCards?: boolean;
    cardsToAddBatchSize?: number;
    dailyTimeGoalMinutes?: number;
  },
): Promise<Id<'courseSettings'>> {
  const existing = await ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, values);
    return existing._id;
  }

  // See NEW_COURSE_SETTINGS_DEFAULTS: stamped on first insert only.
  return ctx.db.insert('courseSettings', {
    ...NEW_COURSE_SETTINGS_DEFAULTS,
    courseId,
    ...values,
  });
}

/**
 * Update just the activeCollectionId on course settings.
 */
export async function setActiveCollectionOnSettings(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  activeCollectionId: Id<'collections'> | undefined,
): Promise<void> {
  const existing = await ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { activeCollectionId });
  } else {
    // No NEW_COURSE_SETTINGS_DEFAULTS here, deliberately: see the note on
    // that constant. This fallback only fires for a course whose settings row
    // is missing, which a course created today never is.
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      activeCollectionId,
    });
  }
}

/**
 * The card projection's gloss option for a course, or nothing at all when the
 * course wants none. Nothing is read from the `hyperliterals` table unless
 * this is set, so a course with the switch off pays nothing for the feature.
 *
 * Carries the whole `HyperliteralWants`, languages included, rather than just
 * the gloss language. The projection has to ask the same question the sweep
 * answers; see the note on `HyperliteralWants`.
 *
 * `targetLanguages` is required, not optional, because a caller that omits it
 * gets an empty want list and silently no glosses at all.
 *
 * Pass `settings` when the caller already holds the row. Every caller but one
 * does, and reading it twice in the same query is a wasted document read on
 * the review path.
 */
export async function glossOptFor(
  ctx: QueryCtx,
  course: {
    _id: Id<'courses'>;
    baseLanguages: string[];
    targetLanguages: string[];
  },
  settings?: Doc<'courseSettings'> | null,
): Promise<{ hyperliteral?: HyperliteralWants }> {
  const resolved =
    settings === undefined
      ? await getCourseSettings(ctx, course._id)
      : settings;
  const wants = hyperliteralWantsFor(course, resolved);
  return wants ? { hyperliteral: wants } : {};
}
