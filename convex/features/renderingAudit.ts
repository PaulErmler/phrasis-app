import { v } from 'convex/values';
import { internalAction, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { audioPointer } from '../db/translationReads';
import { resolveAudioPayload } from '../lib/audioAssets';
import {
  classificationLanguageForRow,
  renderingAxesFor,
} from '../lib/renderingClassifier';
import { axisOf } from '../../lib/preferenceResolution';
import { definitiveSpeakerGender } from '../../lib/sentenceMetadataSource';

/**
 * Read-only audit of the invariant the form chips made visible:
 *
 *   a canonical row's `renderedGender` is `unmarked`, or it equals
 *   `axisOf(texts.audioSpeakerGender)`.
 *
 * The card picks ONE gender per text (`resolveCardSpeakerGenders`, a
 * textId-seeded coin flip when the sentence does not force one), and that
 * choice feeds three things: the translation prompt's `<speaker_gender>`
 * (llmTranslationQueue.ts), the voice the clip is synthesized in, and — by
 * consequence — what the wording says in a gender-marking language. Nothing
 * checks that they still agree, because today's reconciliation
 * (`sweepInvalidAudio`, `isGenderContradicted`) only runs when the SENTENCE
 * fixes a gender (`definitiveSpeakerGender`). On a free choice the three can
 * drift apart silently. This counts how often they have.
 *
 * Every mismatch is classified by the row's own `speakerGender` — the
 * resolved `texts.audioSpeakerGender` AT WRITE TIME (schema.ts) — which
 * separates the two candidate causes:
 *
 *   `adherence`   the row was generated under the current voice and the
 *                 model wrote the other gender anyway (a prompt problem).
 *   `voice_moved` the row says what it was generated under, and the text's
 *                 voice changed afterwards (a plumbing problem).
 *   `legacy_row`  the row predates the `speakerGender` column, so it was
 *                 written before the gender reached the prompt at all.
 *   `no_voice`    the text has no resolved voice yet (nothing to compare).
 *
 * `clipDisagreesWithWording` is the one the learner actually hears: the
 * canonical clip's `voiceGender` against what the wording says.
 *
 * Run (dev):
 *   npx convex run features/renderingAudit:auditRenderedGender
 * One language only, more samples:
 *   npx convex run features/renderingAudit:auditRenderedGender '{"language":"th","sampleLimit":40}'
 */

const PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 200;
const DEFAULT_SAMPLE_LIMIT = 25;

const sampleValidator = v.object({
  textId: v.id('texts'),
  translationId: v.id('translations'),
  language: v.string(),
  sourceText: v.string(),
  wording: v.string(),
  /** What the wording IS (classifier stamp). */
  stamp: v.string(),
  /** What the card chose: `texts.audioSpeakerGender`. */
  cardVoice: v.union(v.string(), v.null()),
  /** The voice the row was GENERATED under (`translations.speakerGender`). */
  generatedUnder: v.union(v.string(), v.null()),
  /** The canonical clip's actual voice, null when there is no audio. */
  clipVoice: v.union(v.string(), v.null()),
  cause: v.string(),
  /** The sentence itself fixes the gender (a verdict, not a coin flip). */
  definitive: v.boolean(),
  userCreated: v.boolean(),
  archived: v.boolean(),
});

const tallyValidator = v.object({
  scanned: v.number(),
  /** Canonical rows of a gender-marking language stamped masculine/feminine. */
  marked: v.number(),
  /** Of those, wording disagreeing with the card's chosen voice. */
  mismatched: v.number(),
  /** Of those, clip voice disagreeing with what the wording says. */
  clipDisagreesWithWording: v.number(),
  byLanguage: v.record(v.string(), v.number()),
  markedByLanguage: v.record(v.string(), v.number()),
  byCause: v.record(v.string(), v.number()),
});

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * One page of the table walk. A plain `.paginate()` scan: the row's own
 * columns decide everything, so no index is named (see the translations
 * index invariant, convex/tests/lib/translationsIndexInvariant.test.ts).
 */
export const auditRenderedGenderPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    language: v.optional(v.string()),
    sampleLimit: v.optional(v.number()),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    tally: tallyValidator,
    samples: v.array(sampleValidator),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('translations')
      .paginate({ cursor: args.cursor, numItems: args.numItems ?? PAGE_SIZE });

    const tally = {
      scanned: 0,
      marked: 0,
      mismatched: 0,
      clipDisagreesWithWording: 0,
      byLanguage: {} as Record<string, number>,
      markedByLanguage: {} as Record<string, number>,
      byCause: {} as Record<string, number>,
    };
    const samples: Array<typeof sampleValidator.type> = [];
    const sampleLimit = args.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
    // One read per distinct text in the page, not one per row: a text has a
    // row per course language and they all resolve the same text.
    const textCache = new Map<string, Doc<'texts'> | null>();
    const readText = async (id: Id<'texts'>) => {
      const key = id.toString();
      if (!textCache.has(key)) textCache.set(key, await ctx.db.get(id));
      return textCache.get(key) ?? null;
    };

    for (const row of page.page) {
      tally.scanned++;
      // A variant carries its own requested gender and is checked by the
      // rendering path; only canonical rows answer to the text's voice.
      if (row.variantKey !== undefined) continue;
      if (
        row.renderedGender === undefined ||
        row.renderedGender === 'unmarked'
      ) {
        continue;
      }
      const language = classificationLanguageForRow(row);
      if (args.language !== undefined && language !== args.language) continue;
      if (!renderingAxesFor(language).gender) continue;

      tally.marked++;
      bump(tally.markedByLanguage, language);

      const text = await readText(row.textId);
      if (!text) continue;
      const cardVoice = text.audioSpeakerGender;
      const expected =
        cardVoice === 'male' || cardVoice === 'female'
          ? axisOf(cardVoice)
          : null;
      if (expected === row.renderedGender) continue;

      tally.mismatched++;
      bump(tally.byLanguage, language);

      const generatedUnder = row.speakerGender ?? null;
      const cause =
        expected === null
          ? 'no_voice'
          : generatedUnder === null
            ? 'legacy_row'
            : axisOf(generatedUnder) === row.renderedGender
              ? 'voice_moved'
              : 'adherence';
      bump(tally.byCause, cause);

      // Only for a mismatching row, so the audio reads stay bounded by the
      // defect count rather than the table size.
      const pointer = await audioPointer(ctx, row.textId, row.targetLanguage);
      const payload = pointer ? await resolveAudioPayload(ctx, pointer) : null;
      const clipVoice = payload?.voiceGender ?? null;
      if (clipVoice !== null && axisOf(clipVoice) !== row.renderedGender) {
        tally.clipDisagreesWithWording++;
      }

      if (samples.length < sampleLimit) {
        samples.push({
          textId: row.textId,
          translationId: row._id,
          language: row.targetLanguage,
          sourceText: text.text.slice(0, 120),
          wording: row.translatedText.slice(0, 120),
          stamp: row.renderedGender,
          cardVoice: cardVoice ?? null,
          generatedUnder,
          clipVoice,
          cause,
          definitive: definitiveSpeakerGender(text) !== null,
          userCreated: text.userCreated,
          archived: row.supersededAt !== undefined,
        });
      }
    }

    return {
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      tally,
      samples,
    };
  },
});

/** Walk the whole table page by page and add the pages up. */
export const auditRenderedGender = internalAction({
  args: {
    language: v.optional(v.string()),
    maxPages: v.optional(v.number()),
    sampleLimit: v.optional(v.number()),
  },
  returns: v.object({
    pages: v.number(),
    complete: v.boolean(),
    tally: tallyValidator,
    samples: v.array(sampleValidator),
  }),
  handler: async (ctx, args) => {
    const maxPages = args.maxPages ?? DEFAULT_MAX_PAGES;
    const sampleLimit = args.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
    const total = {
      scanned: 0,
      marked: 0,
      mismatched: 0,
      clipDisagreesWithWording: 0,
      byLanguage: {} as Record<string, number>,
      markedByLanguage: {} as Record<string, number>,
      byCause: {} as Record<string, number>,
    };
    const samples: Array<typeof sampleValidator.type> = [];
    let cursor: string | null = null;
    let pages = 0;
    let isDone = false;

    while (pages < maxPages) {
      const page: {
        cursor: string | null;
        isDone: boolean;
        tally: typeof total;
        samples: Array<typeof sampleValidator.type>;
      } = await ctx.runQuery(
        internal.features.renderingAudit.auditRenderedGenderPage,
        {
          cursor,
          language: args.language,
          sampleLimit: Math.max(0, sampleLimit - samples.length),
        },
      );
      pages++;
      total.scanned += page.tally.scanned;
      total.marked += page.tally.marked;
      total.mismatched += page.tally.mismatched;
      total.clipDisagreesWithWording += page.tally.clipDisagreesWithWording;
      for (const [key, count] of Object.entries(page.tally.byLanguage)) {
        total.byLanguage[key] = (total.byLanguage[key] ?? 0) + count;
      }
      for (const [key, count] of Object.entries(page.tally.markedByLanguage)) {
        total.markedByLanguage[key] =
          (total.markedByLanguage[key] ?? 0) + count;
      }
      for (const [key, count] of Object.entries(page.tally.byCause)) {
        total.byCause[key] = (total.byCause[key] ?? 0) + count;
      }
      samples.push(...page.samples);
      cursor = page.cursor;
      isDone = page.isDone;
      if (isDone) break;
    }

    return { pages, complete: isDone, tally: total, samples };
  },
});
