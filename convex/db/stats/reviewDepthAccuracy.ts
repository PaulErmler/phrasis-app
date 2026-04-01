import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export async function upsertReviewDepthAccuracy(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    reviewNumber: number;
    accuracy: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query('reviewDepthAccuracy')
    .withIndex('by_userId_and_courseId_and_reviewNumber', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('reviewNumber', args.reviewNumber),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      accuracySum: existing.accuracySum + args.accuracy,
      count: existing.count + 1,
    });
    return;
  }

  await ctx.db.insert('reviewDepthAccuracy', {
    userId: args.userId,
    courseId: args.courseId,
    reviewNumber: args.reviewNumber,
    accuracySum: args.accuracy,
    count: 1,
  });
}
