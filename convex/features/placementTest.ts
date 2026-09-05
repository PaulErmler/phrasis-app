import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { resolveAudioPayload } from '../lib/audioAssets';
import { PLACEMENT_SENTENCES_QUERY_CAP } from '../../lib/constants/onboarding';
import { liveTranslation, servedSourceText } from '../db/translationReads';

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
 * as study material. `resolveStartingCollection` only maps to `L01..L20` /
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
    // The language whose audio row voices the rendered source: the accent
    // code when a Mixed English course serves an accent row.
    let sourceAudioLanguage = text.language;
    if (sourceLanguage && sourceLanguage !== text.language) {
      const sourceTranslation = await liveTranslation(
        ctx,
        text._id,
        sourceLanguage,
      );
      if (sourceTranslation) {
        resolvedSourceText = sourceTranslation.translatedText;
        resolvedSourceLanguage = sourceLanguage;
        sourceAudioLanguage = sourceLanguage;
      }
    } else {
      // The text's own language, as a card would show it (no card, no pin:
      // the accent row of a British- or Australian-voiced sentence).
      const source = await servedSourceText(ctx, text, null);
      resolvedSourceText = source.text;
      sourceAudioLanguage = source.language;
    }

    const sourceAudio = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', text._id).eq('language', sourceAudioLanguage),
      )
      .first();
    const sourcePayload = sourceAudio
      ? await resolveAudioPayload(ctx, sourceAudio)
      : null;
    const sourceAudioUrl = sourcePayload
      ? await ctx.storage.getUrl(sourcePayload.storageId)
      : null;

    let targetText: string | undefined;
    let targetRomanization: string | undefined;
    let targetAudio: Doc<'audioRecordings'> | null = null;
    if (targetLanguage && targetLanguage !== text.language) {
      const translation = await liveTranslation(ctx, text._id, targetLanguage);
      targetText = translation?.translatedText;
      targetRomanization = translation?.romanizedText;
      targetAudio = await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', text._id).eq('language', targetLanguage),
        )
        .first();
    } else if (targetLanguage === text.language) {
      // Learning the text's own language (English on an English course):
      // the target side is the served source wording, accent row included,
      // and the source text itself while that row has not landed.
      const source = await servedSourceText(ctx, text, null);
      targetText = source.text;
      targetRomanization = source.romanizedText;
      targetAudio = await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', text._id).eq('language', source.language),
        )
        .first();
    }
    const targetPayload = targetAudio
      ? await resolveAudioPayload(ctx, targetAudio)
      : null;
    const targetAudioUrl = targetPayload
      ? await ctx.storage.getUrl(targetPayload.storageId)
      : null;

    return {
      textId: text._id,
      sourceText: resolvedSourceText,
      sourceLanguage: resolvedSourceLanguage,
      sourceAudioUrl: sourceAudioUrl,
      targetText,
      targetRomanization,
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
          const sourceTranslation = await liveTranslation(
            ctx,
            text._id,
            sourceLanguage,
          );
          if (sourceTranslation) {
            resolvedSourceText = sourceTranslation.translatedText;
          }
        } else {
          resolvedSourceText = (await servedSourceText(ctx, text, null)).text;
        }

        let targetText: string | undefined;
        let targetRomanization: string | undefined;
        if (targetLanguage && targetLanguage !== text.language) {
          const translation = await liveTranslation(
            ctx,
            text._id,
            targetLanguage,
          );
          targetText = translation?.translatedText;
          targetRomanization = translation?.romanizedText;
        } else if (targetLanguage === text.language) {
          const source = await servedSourceText(ctx, text, null);
          targetText = source.text;
          targetRomanization = source.romanizedText;
        }

        return {
          level: indexRow.level,
          position: indexRow.position,
          sourceText: resolvedSourceText,
          targetText,
          targetRomanization,
        };
      }),
    );
    return rows.filter((row) => row !== null);
  },
});
