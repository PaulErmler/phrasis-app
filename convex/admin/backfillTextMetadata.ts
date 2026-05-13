import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';

/**
 * One-time backfill: populate `addressesSomeone` and `referentGender` on every
 * `texts` row that doesn't have them yet. Idempotent — re-running is a no-op
 * for rows that already have both fields set.
 *
 * `addressesSomeone` derivation:
 *   - addresseeNumber === 'not_applicable'  → false (descriptive sentence)
 *   - anything else                          → true (direct-address)
 *
 * `referentGender` derivation:
 *   - always coin-flipped 50/50 to 'male'|'female' using a deterministic seed
 *     (`hash(externalId or _id + '|referent')`) so re-runs are stable.
 *
 * `addresseeGender` is also nudged: when `addressesSomeone === true` and the
 * current value is missing / 'neutral' / 'not_applicable', flip it to a
 * committed 'male'|'female' (separate seed → uncorrelated with referentGender).
 *
 * Run from the Convex dashboard: `internal/admin/backfillTextMetadata:run`.
 */

const BATCH_SIZE = 200;

// Synchronous, deterministic 50/50 picker. Uses a simple FNV-1a-ish rolling
// hash to avoid pulling in WebCrypto (which would require an action context).
function stableCoinFlip(key: string, salt: string): 'male' | 'female' {
  const s = `${salt}|${key}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 1) === 0 ? 'male' : 'female';
}

function pickSeedKey(doc: Doc<'texts'>): string {
  // Prefer externalId (stable across re-uploads); fall back to _id for
  // user-created rows that don't have one.
  return doc.externalId && doc.externalId.length > 0
    ? doc.externalId
    : (doc._id as unknown as string);
}

export const run = internalMutation({
  args: {},
  returns: v.object({ status: v.string() }),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.admin.backfillTextMetadata.processBatch,
      {},
    );
    return { status: 'started' };
  },
});

export const processBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('texts').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let updated = 0;
    for (const doc of result.page) {
      const patch: Partial<Doc<'texts'>> = {};

      // addressesSomeone
      if (doc.addressesSomeone === undefined) {
        patch.addressesSomeone = doc.addresseeNumber !== 'not_applicable';
      }

      // Effective post-patch view, for the addresseeGender decision below.
      const effectiveAddressesSomeone =
        patch.addressesSomeone ?? doc.addressesSomeone ?? false;

      const seedKey = pickSeedKey(doc);

      // addresseeGender — only commit a coin-flip when the sentence addresses
      // someone AND the current value is missing or non-committal.
      if (
        effectiveAddressesSomeone &&
        (doc.addresseeGender === undefined ||
          doc.addresseeGender === 'neutral' ||
          doc.addresseeGender === 'not_applicable' ||
          doc.addresseeGender === '')
      ) {
        patch.addresseeGender = stableCoinFlip(seedKey, 'addressee');
      }

      // referentGender — always coin-flipped when missing; never re-rolled.
      if (
        doc.referentGender === undefined ||
        (doc.referentGender !== 'male' && doc.referentGender !== 'female')
      ) {
        patch.referentGender = stableCoinFlip(seedKey, 'referent');
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(doc._id as Id<'texts'>, patch);
        updated++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.admin.backfillTextMetadata.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      updated,
      isDone: result.isDone,
    };
  },
});
