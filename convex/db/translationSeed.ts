import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

const SPANISH_VOICE_PREFIXES: Record<string, string> = {
  es: 'es-ES',
  es_latam: 'es-US',
};

/**
 * Batch upsert translations and text metadata from the offline translation pipeline.
 *
 * For each sentence: updates the texts row (normalized text + metadata),
 * upserts translations per language, and invalidates audio when translation
 * text changes or Spanish voices use the wrong regional prefix.
 */
export const batchUpsertTranslations = internalMutation({
  args: {
    items: v.array(
      v.object({
        datasetSentenceId: v.number(),
        textEn: v.string(),
        register: v.optional(v.string()),
        addresseeNumber: v.optional(v.string()),
        speakerGender: v.optional(v.string()),
        addresseeGender: v.optional(v.string()),
        tenseAspect: v.optional(v.string()),
        sentenceType: v.optional(v.string()),
        literalFigurative: v.optional(v.string()),
        translations: v.array(
          v.object({
            language: v.string(),
            text: v.string(),
          }),
        ),
      }),
    ),
  },
  returns: v.object({
    textsUpdated: v.number(),
    textsNotFound: v.number(),
    translationsInserted: v.number(),
    translationsUpdated: v.number(),
    translationsUnchanged: v.number(),
    audioInvalidated: v.number(),
  }),
  handler: async (ctx, args) => {
    const stats = {
      textsUpdated: 0,
      textsNotFound: 0,
      translationsInserted: 0,
      translationsUpdated: 0,
      translationsUnchanged: 0,
      audioInvalidated: 0,
    };

    for (const item of args.items) {
      const textDoc = await ctx.db
        .query('texts')
        .withIndex('by_datasetSentenceId', (q) =>
          q.eq('datasetSentenceId', item.datasetSentenceId),
        )
        .unique();

      if (!textDoc) {
        stats.textsNotFound++;
        continue;
      }

      const textId = textDoc._id;

      await ctx.db.patch(textId, {
        text: item.textEn,
        register: item.register,
        addresseeNumber: item.addresseeNumber,
        speakerGender: item.speakerGender,
        addresseeGender: item.addresseeGender,
        tenseAspect: item.tenseAspect,
        sentenceType: item.sentenceType,
        literalFigurative: item.literalFigurative,
      });
      stats.textsUpdated++;

      // Check if source English text changed — invalidate English audio too
      if (textDoc.text !== item.textEn) {
        const enAudio = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'en'),
          )
          .first();
        if (enAudio) {
          await ctx.storage.delete(enAudio.storageId);
          await ctx.db.delete(enAudio._id);
          stats.audioInvalidated++;
        }
      }

      for (const tr of item.translations) {
        const existing = await ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', tr.language),
          )
          .first();

        if (!existing) {
          await ctx.db.insert('translations', {
            textId,
            targetLanguage: tr.language,
            translatedText: tr.text,
          });
          stats.translationsInserted++;
        } else if (existing.translatedText !== tr.text) {
          await ctx.db.patch(existing._id, {
            translatedText: tr.text,
            romanizedText: undefined,
          });
          stats.translationsUpdated++;

          // Translation text changed — delete audio so it regenerates on demand
          const audio = await ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', textId).eq('language', tr.language),
            )
            .first();
          if (audio) {
            await ctx.storage.delete(audio.storageId);
            await ctx.db.delete(audio._id);
            stats.audioInvalidated++;
          }
        } else {
          stats.translationsUnchanged++;
        }

        // Spanish voice audit: delete audio using wrong regional voice prefix
        const expectedPrefix = SPANISH_VOICE_PREFIXES[tr.language];
        if (expectedPrefix) {
          const audioForLang = await ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', textId).eq('language', tr.language),
            )
            .first();
          if (audioForLang && !audioForLang.voiceName.startsWith(expectedPrefix)) {
            await ctx.storage.delete(audioForLang.storageId);
            await ctx.db.delete(audioForLang._id);
            stats.audioInvalidated++;
          }
        }
      }
    }

    return stats;
  },
});
