import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { adjustCollectionTextCount } from '../db/seed';

/**
 * Create-or-return a dataset row by (slug, version). Idempotent — re-running
 * the upload script with the same version is a no-op for this call.
 *
 * The new dataset is created with `isActive: false`. Activation is a separate
 * step (see admin/activateDataset.ts in Phase 4) so the data can land in prod
 * before the home view starts referencing it.
 */
export const createOrGetDataset = internalMutation({
  args: {
    slug: v.string(),
    version: v.string(),
    description: v.optional(v.string()),
    manifestStorageId: v.optional(v.id('_storage')),
  },
  returns: v.id('datasets'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('datasets')
      .withIndex('by_slug_and_version', (q) =>
        q.eq('slug', args.slug).eq('version', args.version),
      )
      .unique();
    if (existing) return existing._id;
    const id: Id<'datasets'> = await ctx.db.insert('datasets', {
      slug: args.slug,
      version: args.version,
      publishedAt: Date.now(),
      isActive: false,
      description: args.description,
      manifestStorageId: args.manifestStorageId,
    });
    return id;
  },
});

/**
 * Upsert a premade collection for a dataset, keyed by (datasetId, order).
 * Returns the collectionId. Safe to re-run; updates `code` / `cefrTier` /
 * `displayName` if they've changed.
 */
export const upsertDatasetCollection = internalMutation({
  args: {
    datasetId: v.id('datasets'),
    code: v.string(),
    cefrTier: v.string(),
    order: v.number(),
    displayName: v.string(),
  },
  returns: v.id('collections'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) =>
        q.eq('datasetId', args.datasetId).eq('order', args.order),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        code: args.code,
        cefrTier: args.cefrTier,
        displayName: args.displayName,
        // Keep `name` aligned with `code` for back-compat with the by_name index.
        name: args.code,
      });
      return existing._id;
    }
    const id: Id<'collections'> = await ctx.db.insert('collections', {
      name: args.code,
      textCount: 0,
      datasetId: args.datasetId,
      code: args.code,
      cefrTier: args.cefrTier,
      order: args.order,
      displayName: args.displayName,
      origin: 'premade',
    });
    return id;
  },
});

/**
 * Batch-upsert texts into a dataset collection. Keyed by (datasetId, externalId).
 *
 * On insert: increments collections.textCount by 1 per new row.
 * On update: leaves textCount alone; the row already counted.
 *
 * Translations and audio are NOT generated here — they're produced lazily by
 * `scheduleMissingContent` (convex/features/decks.ts) the first time a user
 * adds a card backing the text.
 */
export const batchUpsertDatasetTexts = internalMutation({
  args: {
    datasetId: v.id('datasets'),
    collectionId: v.id('collections'),
    texts: v.array(
      v.object({
        externalId: v.string(),
        text: v.string(),
        collectionRank: v.number(),
        // Always sent by the upload script: a string keeps the value; `null`
        // clears the field on update. (Without this the script would have to
        // rely on Convex's `patch({ register: undefined })` clearing semantics
        // and could leave stale values when a row's formality changes to n/a.)
        register: v.union(v.string(), v.null()),
        // Carries the OGTE `register` column: 'not_applicable' for
        // descriptive sentences (no addressee → no T/V pronoun choice in
        // translations), `null` for direct-address (singular/plural unknown
        // — the LLM classifier fills that in later).
        addresseeNumber: v.union(v.string(), v.null()),
        // Translation-metadata fields populated from the OGTE curation pipeline
        // (helpers.py Row.compute_translation_metadata). `null` clears.
        addressesSomeone: v.union(v.boolean(), v.null()),
        addresseeGender: v.union(v.string(), v.null()), // '' for descriptive; else 'male'|'female'
        referentGender: v.union(v.string(), v.null()), // always 'male'|'female' for sentences with a human referent; '' if upload omits
      }),
    ),
  },
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    let textCountDelta = 0;

    // Run the per-externalId `.unique()` lookups in parallel so each batch is
    // bound by one network round-trip rather than BATCH_SIZE sequential ones.
    const existingResults = await Promise.all(
      args.texts.map((t) =>
        ctx.db
          .query('texts')
          .withIndex('by_dataset_and_externalId', (q) =>
            q.eq('datasetId', args.datasetId).eq('externalId', t.externalId),
          )
          .unique(),
      ),
    );
    const existingByExternalId = new Map<string, (typeof existingResults)[number]>();
    for (let i = 0; i < args.texts.length; i++) {
      const row = existingResults[i];
      if (row) existingByExternalId.set(args.texts[i].externalId, row);
    }

    for (const t of args.texts) {
      // `null` means "clear the field"; map to `undefined` for the patch/insert
      // so the field is removed (Convex `v.optional(v.string())` stores absence).
      const register = t.register === null ? undefined : t.register;
      const addresseeNumber =
        t.addresseeNumber === null ? undefined : t.addresseeNumber;
      const addressesSomeone =
        t.addressesSomeone === null ? undefined : t.addressesSomeone;
      // Treat empty string as "clear" so descriptive rows don't carry a stale addressee_gender.
      const addresseeGender =
        t.addresseeGender === null || t.addresseeGender === '' ? undefined : t.addresseeGender;
      const referentGender =
        t.referentGender === null || t.referentGender === '' ? undefined : t.referentGender;
      const existing = existingByExternalId.get(t.externalId);
      if (existing) {
        await ctx.db.patch(existing._id, {
          text: t.text,
          collectionId: args.collectionId,
          collectionRank: t.collectionRank,
          register,
          addresseeNumber,
          addressesSomeone,
          addresseeGender,
          referentGender,
        });
        updated++;
      } else {
        await ctx.db.insert('texts', {
          externalId: t.externalId,
          datasetId: args.datasetId,
          text: t.text,
          language: 'en',
          userCreated: false,
          collectionId: args.collectionId,
          collectionRank: t.collectionRank,
          register,
          addresseeNumber,
          addressesSomeone,
          addresseeGender,
          referentGender,
        });
        inserted++;
        textCountDelta++;
      }
    }

    if (textCountDelta !== 0) {
      await adjustCollectionTextCount(ctx, args.collectionId, textCountDelta);
    }

    return { inserted, updated };
  },
});
