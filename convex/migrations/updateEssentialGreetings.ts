import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { getActiveDataset } from '../db/collections';
import { deleteAudioRowsForTextLanguage } from '../lib/audio';
import { CURATED_TRANSLATION_SOURCE } from '../../lib/translationProvenance';
import {
  resolveCardSpeakerGenders,
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
} from '../../lib/voices';
import {
  ESSENTIAL_GREETING_SENTENCES,
  ESSENTIAL_GREETING_TRANSLATIONS,
} from './data/essentialGreetingTranslations';

/**
 * One-off migration: replace the first three L01 ("Essential") sentences.
 * "Hi." / "Hello!" / "Hi! How are you?" → "Hello." / "How are you?" /
 * "Hello. How are you?", and upload the hand-curated translations from
 * ./data/essentialGreetingTranslations for every supported language.
 *
 * Motivation: "Hi." and "Hello!" translate to the same word in many
 * languages, which made the first onboarding reps confusing.
 *
 * What it does per sentence (idempotent, safe to re-run):
 *   1. Patches `texts.text` in the ACTIVE dataset (matched by externalId) and
 *      deletes the English audio rows: the text changed audibly and
 *      `audioRecordings` stores no source text, so nothing else would notice.
 *   2. Schedules one `storeTranslationAndScheduleTTS` job per curated
 *      language with `replaceExisting: true`: the choke point handles the
 *      soundsSame audio decision, version stamping, and the searchableText
 *      rebuild fan-out. `skipTts: true`: audio regenerates lazily via the
 *      ensure-content sweep on next view, like any other content self-heal.
 *   3. Schedules a searchableText rebuild for the English text change itself.
 *
 * The placement-test copy of "Hi." (separate texts row in the
 * placement-test-pool collection) is deliberately untouched.
 *
 * Run with:
 *   npx convex run migrations/updateEssentialGreetings:run
 */

/** Provenance slug stamped on the curated rows (translationSource). Shared with
 * `isProtectedTranslationSource` in lib/translationProvenance.ts, which is what
 * keeps a future `translationVersion` bump from deleting and re-generating
 * them. */
const CURATED_SOURCE = CURATED_TRANSLATION_SOURCE;

/**
 * Spacing between scheduled translation jobs, to avoid an OCC burst of
 * concurrent searchableText rebuilds against the same card docs.
 *
 * Must keep the whole job train inside `SEARCHABLE_REBUILD_DEBOUNCE_MS`
 * (10s, convex/features/decks.ts): each translation store schedules a
 * `rebuildSearchableTextForText` fan-out unless one is already pending for
 * that text, and these three texts are the most common onboarding sentences,
 * so every extra fan-out repaginates `cards by_textId` across the entire
 * userbase. `jobIndex` restarts per sentence, so the last job of a text lands
 * at (58 - 1 + sentenceIndex) × stagger: ~5.9s here, comfortably inside the
 * window. At the previous 250ms it landed at ~14.8s and triggered a second
 * full rebuild for every text.
 */
const JOB_STAGGER_MS = 100;

export const run = internalMutation({
  args: {},
  returns: v.object({
    textsPatched: v.array(v.string()),
    translationJobsScheduled: v.number(),
  }),
  handler: async (ctx) => {
    const dataset = await getActiveDataset(ctx);
    if (!dataset) {
      throw new Error('No active dataset — run the OGTE cutover first.');
    }

    const textsPatched: string[] = [];
    let translationJobsScheduled = 0;

    for (const [
      sentenceIndex,
      sentence,
    ] of ESSENTIAL_GREETING_SENTENCES.entries()) {
      const text = await ctx.db
        .query('texts')
        .withIndex('by_dataset_and_externalId', (q) =>
          q.eq('datasetId', dataset._id).eq('externalId', sentence.externalId),
        )
        .unique();
      if (!text) {
        throw new Error(
          `texts row with externalId ${sentence.externalId} not found in active dataset ${dataset.slug}`,
        );
      }

      if (text.text !== sentence.text) {
        await ctx.db.patch(text._id, {
          text: sentence.text,
          // "How are you?" is an informal-register question (the old
          // "Hello!" row was register-neutral); keeps translation-prompt
          // T/V choice consistent should a language ever regenerate.
          ...(sentence.key === 'howAreYou' ? { register: 'informal' } : {}),
        });
        await deleteAudioRowsForTextLanguage(ctx, text._id, 'en');
        await ctx.scheduler.runAfter(
          0,
          internal.features.decks.rebuildSearchableTextForText,
          { textId: text._id },
        );
        textsPatched.push(sentence.externalId);
      }

      // Same gender resolution the content pipeline uses, so the stamped
      // `speakerGender` matches what the gender-mismatch sweep will later
      // compare against (a missing stamp would mark the row "unknown,
      // regenerate on next sweep" and defeat the curation).
      const { audioSpeakerGender, genderPatch } = resolveCardSpeakerGenders(
        text,
        text._id,
      );
      if (Object.keys(genderPatch).length > 0) {
        await ctx.db.patch(text._id, genderPatch);
      }

      let jobIndex = 0;
      for (const [language, entry] of Object.entries(
        ESSENTIAL_GREETING_TRANSLATIONS,
      )) {
        const curated = entry[sentence.key];
        const voiceName = entry.regionVariant
          ? getVoiceForLanguageVariant(
              language,
              entry.regionVariant,
              audioSpeakerGender,
            )
          : getVoiceForLanguage(language, audioSpeakerGender);
        await ctx.scheduler.runAfter(
          // Offset the three sentences so their job trains interleave less.
          (jobIndex++ + sentenceIndex) * JOB_STAGGER_MS,
          internal.features.decks.storeTranslationAndScheduleTTS,
          {
            textId: text._id,
            targetLanguage: language,
            translatedText: curated.text,
            voiceName,
            // No romanizedText: on replace the choke point clears the old
            // romanization so the ensure-content sweep regenerates it
            // against the new text for languages that need it.
            translationSource: CURATED_SOURCE,
            ...(entry.regionVariant
              ? { regionVariant: entry.regionVariant }
              : {}),
            replaceExisting: true,
            speakerGender: audioSpeakerGender,
            skipTts: true,
          },
        );
        translationJobsScheduled++;
      }
    }

    return { textsPatched, translationJobsScheduled };
  },
});
