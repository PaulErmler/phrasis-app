import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { getAuthUserId } from '../db/users';
import { PLACEMENT_SENTENCES_QUERY_CAP } from '../../lib/constants/onboarding';

/**
 * Placement-test backend.
 *
 * Sentences are indexed by the `placementTestSentences` side table (one row
 * per (level, position) pair). The English source text + its translations +
 * audio live in the standard `texts` / `translations` / `audioRecordings`
 * tables via `textId`, so the regular translation + TTS pipelines work on
 * placement sentences exactly like any other text.
 *
 * The seed migration (`convex/migrations/seedPlacementTestSentences.ts`)
 * populates both tables and creates one `placement-test-pool` collection
 * that holds the English `texts` rows. The pool collection is never offered
 * as study material — `resolveStartingCollection` only maps to `L01..L20` /
 * legacy CEFR collection names.
 */

/**
 * Returns one placement-test sentence (along with the translation in the
 * requested target language, if available) for the given OGTE level. The
 * caller picks a `position` 0..4 to vary which of the 5 curated sentences
 * for that level appears.
 *
 * The "source" side of the card renders in the user's chosen base language
 * (`sourceLanguage`). The underlying texts are stored as English, so when
 * the base language differs we look up its translation and swap it in.
 * Translation backfill is driven by `prepareLanguagePair` /
 * `ensurePlacementTranslations`; until it lands we fall back to the stored
 * English text so the user always sees a sentence.
 */
export const getPlacementSentence = query({
  args: {
    level: v.number(),
    position: v.number(),
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.union(
    v.object({
      textId: v.id('texts'),
      sourceText: v.string(),
      sourceLanguage: v.string(),
      sourceAudioUrl: v.optional(v.union(v.string(), v.null())),
      targetText: v.optional(v.string()),
      targetRomanization: v.optional(v.string()),
      targetAudioUrl: v.optional(v.union(v.string(), v.null())),
      level: v.number(),
      position: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { level, position, targetLanguage, sourceLanguage }) => {
    const indexRow = await ctx.db
      .query('placementTestSentences')
      .withIndex('by_level_and_position', (q) =>
        q.eq('level', level).eq('position', position),
      )
      .first();
    if (!indexRow) return null;

    const text = await ctx.db.get(indexRow.textId);
    if (!text) return null;

    // Resolve the source-side rendering: if the user's base language
    // differs from the text's stored language, swap in its translation.
    let resolvedSourceText = text.text;
    let resolvedSourceLanguage = text.language;
    if (sourceLanguage && sourceLanguage !== text.language) {
      const sourceTranslation = await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', text._id).eq('targetLanguage', sourceLanguage),
        )
        .first();
      if (sourceTranslation) {
        resolvedSourceText = sourceTranslation.translatedText;
        resolvedSourceLanguage = sourceLanguage;
      }
    }

    const sourceAudio = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', text._id).eq('language', resolvedSourceLanguage),
      )
      .first();
    const sourceAudioUrl = sourceAudio
      ? await ctx.storage.getUrl(sourceAudio.storageId)
      : null;

    let translation: Doc<'translations'> | null = null;
    let targetAudio: Doc<'audioRecordings'> | null = null;
    if (targetLanguage && targetLanguage !== text.language) {
      translation = await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', text._id).eq('targetLanguage', targetLanguage),
        )
        .first();
      targetAudio = await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', text._id).eq('language', targetLanguage),
        )
        .first();
    }
    const targetAudioUrl = targetAudio
      ? await ctx.storage.getUrl(targetAudio.storageId)
      : null;

    return {
      textId: text._id,
      sourceText: resolvedSourceText,
      sourceLanguage: resolvedSourceLanguage,
      sourceAudioUrl: sourceAudioUrl,
      targetText: translation?.translatedText,
      targetRomanization: translation?.romanizedText,
      targetAudioUrl: targetAudioUrl,
      level,
      position,
    };
  },
});

/**
 * The whole preview corpus for the CEFR self-pick slider in one subscription:
 * every placement sentence's text + translations, deliberately WITHOUT the
 * audio/storage lookups `getPlacementSentence` does (the slider preview never
 * plays audio). Fetching all levels upfront (~100 small rows, bounded by
 * `PLACEMENT_SENTENCES_QUERY_CAP`) lets the slider render any level straight
 * from memory instead of flashing a loading row per (level, position) query
 * while the user drags.
 */
export const getPlacementPreviewSentences = query({
  args: {
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.array(
    v.object({
      level: v.number(),
      position: v.number(),
      sourceText: v.string(),
      targetText: v.optional(v.string()),
      targetRomanization: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { targetLanguage, sourceLanguage }) => {
    const indexRows = await ctx.db
      .query('placementTestSentences')
      .take(PLACEMENT_SENTENCES_QUERY_CAP);
    if (indexRows.length === PLACEMENT_SENTENCES_QUERY_CAP) {
      console.warn(
        `placementTestSentences query hit cap ${PLACEMENT_SENTENCES_QUERY_CAP} ` +
          '— raise PLACEMENT_SENTENCES_QUERY_CAP.',
      );
    }

    const rows = await Promise.all(
      indexRows.map(async (indexRow) => {
        const text = await ctx.db.get(indexRow.textId);
        if (!text) return null;

        // Same source-side resolution as `getPlacementSentence`: render in
        // the user's base language once its translation lands, fall back to
        // the stored English text so a sentence always shows.
        let resolvedSourceText = text.text;
        if (sourceLanguage && sourceLanguage !== text.language) {
          const sourceTranslation = await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', text._id).eq('targetLanguage', sourceLanguage),
            )
            .first();
          if (sourceTranslation) {
            resolvedSourceText = sourceTranslation.translatedText;
          }
        }

        let translation: Doc<'translations'> | null = null;
        if (targetLanguage && targetLanguage !== text.language) {
          translation = await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', text._id).eq('targetLanguage', targetLanguage),
            )
            .first();
        }

        return {
          level: indexRow.level,
          position: indexRow.position,
          sourceText: resolvedSourceText,
          targetText: translation?.translatedText,
          targetRomanization: translation?.romanizedText,
        };
      }),
    );
    return rows.filter((row) => row !== null);
  },
});

/**
 * Returns how many of the 100 placement sentences have translations + audio
 * ready for `targetLanguage`. Used to gate the "Start test" button.
 */
export const getPlacementReadiness = query({
  args: { targetLanguage: v.string() },
  returns: v.object({
    totalSentences: v.number(),
    translatedSentences: v.number(),
    audioReadySentences: v.number(),
  }),
  handler: async (ctx, { targetLanguage }) => {
    // Public query — `userId` is read only to keep the auth shape uniform.
    const userId = await getAuthUserId(ctx);
    void userId;

    // Seed migration caps the corpus at ~100 rows. `.take()` makes the
    // safety bound explicit; the warn fires if a future seed bumps past it.
    const sentences = await ctx.db
      .query('placementTestSentences')
      .take(PLACEMENT_SENTENCES_QUERY_CAP);
    if (sentences.length === PLACEMENT_SENTENCES_QUERY_CAP) {
      console.warn(
        `placementTestSentences query hit cap ${PLACEMENT_SENTENCES_QUERY_CAP} ` +
          '— batch the lookup or raise PLACEMENT_SENTENCES_QUERY_CAP.',
      );
    }

    let translated = 0;
    let audioReady = 0;
    for (const s of sentences) {
      const tr = await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', s.textId).eq('targetLanguage', targetLanguage),
        )
        .first();
      if (tr) translated++;
      const audio = await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', s.textId).eq('language', targetLanguage),
        )
        .first();
      if (audio) audioReady++;
    }

    return {
      totalSentences: sentences.length,
      translatedSentences: translated,
      audioReadySentences: audioReady,
    };
  },
});
