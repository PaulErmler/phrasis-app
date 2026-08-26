import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import { api, internal } from '../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * The accepted-alternative generation pipeline around the audio store: the
 * context probe that prefers reuse over re-synthesis, saveAlternativeAudio's
 * defer-to-completed keying (one shared asset per sentence, however many
 * cards accepted it), and the evicted-row guards that let a slow scheduled
 * job land after cap-eviction without throwing. The store mutations and
 * queries run real; the vendor synthesis action itself is exercised in
 * production code paths only (convex-test cannot host its storage write).
 */

async function seedAlternative(
  t: TestConvex<typeof schema>,
  name: string,
  text = 'Me gustaría un café.',
  userId = 'user_A',
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name,
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name,
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: `I would like a coffee (${name}).`,
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      dueDate: 0,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'es',
      translatedText: 'Quisiera un café.',
    });
    const alternativeId = await ctx.db.insert('writingAlternatives', {
      userId,
      cardId,
      language: 'es',
      text,
    });
    return { cardId, textId, alternativeId };
  });
}

async function saveAudio(
  t: TestConvex<typeof schema>,
  alternativeId: Awaited<ReturnType<typeof seedAlternative>>['alternativeId'],
  spokenText: string,
) {
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
  );
  await t.mutation(internal.features.writingAlternatives.saveAlternativeAudio, {
    alternativeId,
    language: 'es',
    voiceGender: 'female',
    spokenText,
    storageId,
    voiceName: 'es-ES-Standard-A',
    provider: 'google',
  });
}

describe('features/writingAlternatives generation pipeline', () => {
  it('keys audio by sentence: two cards accepting the same phrasing share one asset', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    const b = await seedAlternative(t, 'B');

    await saveAudio(t, a.alternativeId, 'Me gustaría un café.');
    // Second synthesis for the same (language, gender, sentence): the save
    // defers to the completed asset and drops its own blob.
    await saveAudio(t, b.alternativeId, 'Me gustaría un café.');

    const { assets, rows } = await t.run(async (ctx) => ({
      assets: await ctx.db.query('audioAssets').collect(),
      rows: await ctx.db.query('writingAlternatives').collect(),
    }));
    expect(assets).toHaveLength(1);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.audioAssetId === assets[0]._id)).toBe(true);
  });

  it('getAlternativeContext reports a reusable asset so the action skips synthesis', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    await saveAudio(t, a.alternativeId, 'Me gustaría un café.');

    // A fresh alternative for the SAME sentence on another card: the probe
    // must surface the existing asset (generateAlternativeAudio then attaches
    // it without calling the vendor).
    const b = await seedAlternative(t, 'B');
    const context = await t.query(
      internal.features.writingAlternatives.getAlternativeContext,
      { alternativeId: b.alternativeId },
    );
    expect(context?.reusableAssetId).not.toBeNull();
    expect(context?.hasAudio).toBe(false);

    await t.mutation(
      internal.features.writingAlternatives.attachAlternativeAudio,
      { alternativeId: b.alternativeId, assetId: context!.reusableAssetId! },
    );
    const row = await t.run((ctx) => ctx.db.get(b.alternativeId));
    expect(row?.audioAssetId).toBe(context?.reusableAssetId);
  });

  it('hasAudio short-circuits the pipeline for rows that already carry audio', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    await saveAudio(t, a.alternativeId, 'Me gustaría un café.');
    const context = await t.query(
      internal.features.writingAlternatives.getAlternativeContext,
      { alternativeId: a.alternativeId },
    );
    expect(context?.hasAudio).toBe(true);
  });

  it('lets a slow job land after its row was evicted: store mutations no-op', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A', 'Frase efímera.');
    const b = await seedAlternative(t, 'B');
    // b gets a real asset first so attach has something to point at.
    await saveAudio(t, b.alternativeId, 'Me gustaría un café.');
    const assetId = await t.run(async (ctx) => {
      const row = await ctx.db.get(b.alternativeId);
      return row!.audioAssetId!;
    });

    // Cap eviction beat A's scheduled jobs to it.
    await t.run((ctx) => ctx.db.delete(a.alternativeId));

    await expect(
      t.mutation(
        internal.features.writingAlternatives.storeAlternativeAnnotations,
        { alternativeId: a.alternativeId, ipaText: 'ipa' },
      ),
    ).resolves.toBeNull();
    await expect(
      t.mutation(
        internal.features.writingAlternatives.attachAlternativeAudio,
        { alternativeId: a.alternativeId, assetId },
      ),
    ).resolves.toBeNull();
    // The late save no-ops on the row but must not corrupt the asset store.
    await saveAudio(t, a.alternativeId, 'Frase efímera.');
    const aRow = await t.run((ctx) => ctx.db.get(a.alternativeId));
    expect(aRow).toBeNull();
  });
});

describe('features/writingAlternatives edit-dialog CRUD', () => {
  it('listForCard returns only the caller\'s rows and refuses unauthenticated calls', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    // Another user's row on the SAME card (shared curriculum card).
    await t.run(async (ctx) => {
      await ctx.db.insert('writingAlternatives', {
        userId: 'user_B',
        cardId: a.cardId,
        language: 'es',
        text: 'Querría un café.',
      });
    });

    await expect(
      t.query(api.features.writingAlternatives.listForCard, {
        cardId: a.cardId,
      }),
    ).rejects.toThrow('Unauthenticated');

    const rows = await t
      .withIdentity({ subject: 'user_A' })
      .query(api.features.writingAlternatives.listForCard, {
        cardId: a.cardId,
      });
    expect(rows).toEqual([
      { _id: a.alternativeId, language: 'es', text: 'Me gustaría un café.' },
    ]);
  });

  it('updateAlternative rewords the row, clears stale content, and schedules regeneration', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    await t.run(async (ctx) => {
      await ctx.db.patch(a.alternativeId, {
        romanizedText: 'stale',
        ipaText: 'stale',
        furiganaText: 'stale',
      });
    });
    await saveAudio(t, a.alternativeId, 'Me gustaría un café.');

    await t
      .withIdentity({ subject: 'user_A' })
      .mutation(api.features.writingAlternatives.updateAlternative, {
        alternativeId: a.alternativeId,
        text: '  Me encantaría un café.  ',
      });

    const { row, scheduled } = await t.run(async (ctx) => ({
      row: await ctx.db.get(a.alternativeId),
      scheduled: await ctx.db.system.query('_scheduled_functions').collect(),
    }));
    expect(row).toMatchObject({ text: 'Me encantaría un café.' });
    // The old annotations and audio pointer describe the old sentence.
    expect(row!.romanizedText).toBeUndefined();
    expect(row!.ipaText).toBeUndefined();
    expect(row!.furiganaText).toBeUndefined();
    expect(row!.audioAssetId).toBeUndefined();
    const names = scheduled.map((j) => j.name);
    expect(
      names.some((n) => n.includes('generateAlternativeAnnotations')),
    ).toBe(true);
    expect(names.some((n) => n.includes('generateAlternativeAudio'))).toBe(
      true,
    );
  });

  it('updateAlternative deletes the row instead of patching when the new text duplicates the primary', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');

    await t
      .withIdentity({ subject: 'user_A' })
      .mutation(api.features.writingAlternatives.updateAlternative, {
        alternativeId: a.alternativeId,
        // Punctuation/case-insensitive match against the translation row.
        text: 'quisiera un café',
      });

    expect(await t.run((ctx) => ctx.db.get(a.alternativeId))).toBeNull();
  });

  it('updateAlternative deletes the row when the new text duplicates a sibling alternative', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    await t.run(async (ctx) => {
      await ctx.db.insert('writingAlternatives', {
        userId: 'user_A',
        cardId: a.cardId,
        language: 'es',
        text: 'Querría un café.',
      });
    });

    await t
      .withIdentity({ subject: 'user_A' })
      .mutation(api.features.writingAlternatives.updateAlternative, {
        alternativeId: a.alternativeId,
        text: 'Querría un café.',
      });

    expect(await t.run((ctx) => ctx.db.get(a.alternativeId))).toBeNull();
  });

  it('updateAlternative rejects a foreign row and empty text', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');
    const asIntruder = t.withIdentity({ subject: 'user_B' });
    await expect(
      asIntruder.mutation(api.features.writingAlternatives.updateAlternative, {
        alternativeId: a.alternativeId,
        text: 'Hacked.',
      }),
    ).rejects.toThrow('Unauthorized');
    await expect(
      t
        .withIdentity({ subject: 'user_A' })
        .mutation(api.features.writingAlternatives.updateAlternative, {
          alternativeId: a.alternativeId,
          text: '   ',
        }),
    ).rejects.toThrow('empty');
    // Untouched either way.
    expect(
      (await t.run((ctx) => ctx.db.get(a.alternativeId)))?.text,
    ).toBe('Me gustaría un café.');
  });

  it('deleteAlternative removes the caller\'s row and rejects a foreign one', async () => {
    const t = convexTest(schema, modules);
    const a = await seedAlternative(t, 'A');

    await expect(
      t
        .withIdentity({ subject: 'user_B' })
        .mutation(api.features.writingAlternatives.deleteAlternative, {
          alternativeId: a.alternativeId,
        }),
    ).rejects.toThrow('Unauthorized');

    await t
      .withIdentity({ subject: 'user_A' })
      .mutation(api.features.writingAlternatives.deleteAlternative, {
        alternativeId: a.alternativeId,
      });
    expect(await t.run((ctx) => ctx.db.get(a.alternativeId))).toBeNull();
  });
});
