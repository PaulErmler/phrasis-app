import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

const BATCH_SIZE = 25;

/**
 * One-time migration for the workpool cutover: move every row still sitting
 * in the legacy hand-rolled queues (`ttsQueue`, `llmTranslationQueue`) into
 * the corresponding workpool, and wipe the now-meaningless coordination
 * tables (`ttsProviderSlots`, `llmTranslationSlots`, `queuePumpStates`).
 *
 * The re-enqueues go through the SAME `enqueueTtsJob` / `enqueueLlmTranslation`
 * mutations the app uses, so each job gets a pool workId stamped onto its
 * existing claim (legacy claims carry no workId until then) and a proper
 * onComplete. Deprecated per-row fields (priority, failureCount, claimId)
 * are dropped — pool jobs start with a fresh retry budget.
 *
 * Idempotent and self-continuing (drains BATCH_SIZE rows per table per
 * transaction, then reschedules itself until all five tables are empty).
 * Kick off once after the migration deploy:
 *   npx convex run migrations/drainLegacyQueues:run
 * A later cleanup deploy drops the five tables from the schema.
 */
export const run = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let remaining = false;

    const ttsRows = await ctx.db.query('ttsQueue').take(BATCH_SIZE);
    for (const row of ttsRows) {
      await ctx.runMutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: row.provider,
        args: {
          textId: row.args.textId,
          text: row.args.text,
          language: row.args.language,
          voiceName: row.args.voiceName,
          voiceGender: row.args.voiceGender,
          speed: row.args.speed,
          regionVariant: row.args.regionVariant,
        },
      });
      await ctx.db.delete(row._id);
    }
    remaining ||= ttsRows.length === BATCH_SIZE;

    const llmRows = await ctx.db.query('llmTranslationQueue').take(BATCH_SIZE);
    for (const row of llmRows) {
      await ctx.runMutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        {
          args: {
            textId: row.args.textId,
            sourceLanguage: row.args.sourceLanguage,
            targetLanguage: row.args.targetLanguage,
            text: row.args.text,
            audioSpeakerGender: row.args.audioSpeakerGender,
            ruleOverride: row.args.ruleOverride,
            replaceExisting: row.args.replaceExisting,
          },
        },
      );
      await ctx.db.delete(row._id);
    }
    remaining ||= llmRows.length === BATCH_SIZE;

    for (const table of [
      'ttsProviderSlots',
      'llmTranslationSlots',
      'queuePumpStates',
    ] as const) {
      const rows = await ctx.db.query(table).take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      remaining ||= rows.length === BATCH_SIZE;
    }

    if (remaining) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.drainLegacyQueues.run,
        {},
      );
    }
    return null;
  },
});
