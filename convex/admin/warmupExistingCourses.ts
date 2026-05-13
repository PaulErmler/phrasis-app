import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

/**
 * One-shot backfill: schedule `ensureFirstSentencesAcrossLevelCollections`
 * for every (baseLanguages, targetLanguages) pair represented across all
 * existing courses.
 *
 * Context: that warmup used to fire from HomeView on every mount; it now
 * runs at course creation only. Pre-existing courses missed the transition
 * — this mutation backfills them.
 *
 * Dedupes by language pair before scheduling — the warmup's output is a pure
 * function of the language arrays (it preps the same level collections in
 * the same languages), so two users sharing English→Spanish only need one
 * fan-out. With typical pair counts in the low single digits, this trims
 * a 1k-course backfill from 1k scheduled parents to a handful.
 *
 * Trigger from the Convex dashboard:
 *   `internal/admin/warmupExistingCourses:run`
 */
export const run = internalMutation({
  args: {},
  returns: v.object({
    coursesScanned: v.number(),
    uniquePairsScheduled: v.number(),
  }),
  handler: async (ctx) => {
    const courses = await ctx.db.query('courses').collect();

    // Sort each array before keying so {base:['en','de']} and
    // {base:['de','en']} collapse into the same pair.
    const pairs = new Map<
      string,
      { baseLanguages: string[]; targetLanguages: string[] }
    >();
    for (const course of courses) {
      const baseLanguages = [...course.baseLanguages].sort();
      const targetLanguages = [...course.targetLanguages].sort();
      const key = JSON.stringify({ b: baseLanguages, t: targetLanguages });
      if (!pairs.has(key)) {
        pairs.set(key, { baseLanguages, targetLanguages });
      }
    }

    await Promise.all(
      Array.from(pairs.values()).map((pair) =>
        ctx.scheduler.runAfter(
          0,
          internal.features.collections.ensureFirstSentencesAcrossLevelCollections,
          pair,
        ),
      ),
    );

    return {
      coursesScanned: courses.length,
      uniquePairsScheduled: pairs.size,
    };
  },
});
