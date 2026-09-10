'use node';

/**
 * IPA transcription via espeak-ng (@echogarden/espeak-ng-emscripten).
 *
 * Node runtime on purpose: the emscripten build loads its ~24 MB
 * espeak-ng.data from disk (shipped via `node.externalPackages` in
 * convex.json), which the default V8 isolate can neither bundle (32 MiB cap)
 * nor hold (64 MiB RAM). This file may therefore only export actions; the
 * store mutations live in decks.ts and everything V8-shareable (source tags,
 * registry) in convex/lib/textAnnotations.ts.
 *
 * Same lazy pipeline shape as romanization (decks.ts): schedulers enqueue
 * `processIpaFor*` when `ipaText === undefined`; failures persist the `''`
 * sentinel so nothing re-enqueues them. espeak is deterministic local
 * compute, so unlike `romanizeText` (network) there is no retry loop: the
 * first failure is as good as the third.
 */

import { v } from 'convex/values';
import type { EspeakNgWorkerInstance } from '@echogarden/espeak-ng-emscripten';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { getIpaVoice, IPA_LANGUAGES } from '../../lib/languages';
import {
  getIpaSource,
  runApprovalAnnotation,
  runSourceAnnotation,
  runTranslationAnnotation,
} from '../lib/textAnnotations';
import type { BackfillPage } from '../admin/backfillIpa';

/**
 * One worker per Node instance, built on first use and reused across warm
 * invocations. Init parses the full espeak data bundle, far too expensive
 * per call (mirrors the lazy OpenCC converter in localRomanization.ts).
 * Dynamic import because the package is ESM ("type": "module") and marked
 * external: a static import could surface as `require()` of an ES module in
 * the bundled CJS output.
 */
let workerPromise: Promise<EspeakNgWorkerInstance> | undefined;
async function getEspeakWorker(): Promise<EspeakNgWorkerInstance> {
  workerPromise ??= (async () => {
    const { default: init } = await import('@echogarden/espeak-ng-emscripten');
    const espeakModule = await init();
    return new espeakModule.eSpeakNGWorker();
  })();
  return workerPromise;
}

/**
 * espeak's IPA mode separates phonemes with `_` and clauses with newlines
 * ("h_ə_l_ˈoʊ w_ˈɜː_l_d\n"). Strip the separators, join clauses with a
 * space, collapse whitespace. Punctuation is dropped by espeak itself;
 * that's normal for IPA transcriptions.
 *
 * Two voices also leak an internal marker into the stream. Danish writes some
 * glottal stops as ASCII `?` while writing others as `ʔ` in the same word
 * ("ˈalʔesˌ?ɑmən"), and Icelandic emits a stray `#` ("kʋˈɛrdn#ɪx"). espeak
 * has already dropped the input's own punctuation by this point, so neither
 * rewrite can reach real text.
 */
export function cleanEspeakIpa(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/_|#/g, '').replace(/\?/g, 'ʔ').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * espeak switches voice mid-sentence when it recognises a word as belonging
 * to another language, and marks the switch inline: the French voice renders
 * "And you?" as "(en)and(fr) jˈu".
 *
 * The markers are not the real problem. The switched-to word is left as RAW
 * TEXT — "and", not "ænd" — so the line reads as if a Latin word were IPA,
 * and stripping the markers alone would hide that rather than fix it. There
 * is no way to disable the switching through this binding, so a transcription
 * carrying one is treated as failed.
 */
const LANGUAGE_SWITCH = /\([a-z]{2,3}(?:-[a-z0-9-]+)?\)/i;

/**
 * IPA for `text` in `language`. Throws when the language has no espeak voice,
 * when espeak returns nothing, or when it switched language mid-sentence;
 * callers convert that into the `''` sentinel, so the line is simply absent
 * rather than wrong.
 */
export async function ipaForText(
  text: string,
  language: string,
): Promise<string> {
  const voice = getIpaVoice(language);
  if (voice === null) {
    throw new Error(`No espeak voice configured for language "${language}"`);
  }
  const worker = await getEspeakWorker();
  // set_voice + synthesize_ipa are synchronous back-to-back calls, so
  // concurrent actions in the same instance can't interleave between them.
  worker.set_voice(voice);
  const ipa = cleanEspeakIpa(worker.synthesize_ipa(text).ipa ?? '');
  if (ipa.length === 0) {
    throw new Error(`espeak produced empty IPA for "${language}"`);
  }
  if (LANGUAGE_SWITCH.test(ipa)) {
    throw new Error(
      `espeak switched language mid-sentence for "${language}" (${ipa.slice(0, 60)}); ` +
        'the switched span is untranscribed, so the whole line is unusable',
    );
  }
  return ipa;
}

// The three process actions share the generic try/generate/sentinel/store
// bodies in convex/lib/textAnnotations.ts (runSourceAnnotation and friends);
// this file only declares the Node runtime and supplies the espeak engine.

/** IPA for a source text (texts table). */
export const processIpaForSourceText = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runSourceAnnotation(
      ctx,
      'ipa',
      args,
      ipaForText,
      getIpaSource(args.language),
    ),
});

/** IPA for a translation row. */
export const processIpaForTranslation = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
    // See AnnotationActionArgs in lib/textAnnotations.ts.
    translationId: v.optional(v.id('translations')),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runTranslationAnnotation(
      ctx,
      'ipa',
      args,
      ipaForText,
      getIpaSource(args.language),
    ),
});

/** IPA for a chat card proposal's entries (see runApprovalAnnotation). */
export const processIpaForApproval = internalAction({
  args: {
    approvalId: v.id('cardApprovals'),
    entries: v.array(v.object({ language: v.string(), text: v.string() })),
  },
  returns: v.null(),
  handler: (ctx, args) => runApprovalAnnotation(ctx, 'ipa', args, ipaForText),
});

const BACKFILL_BATCH_SIZE = 100;

/**
 * One backfill step: page rows still missing IPA (paging + filtering happens
 * in the V8 query, convex/admin/backfillIpa.ts), transcribe them here, write
 * through the same store mutations as the lazy path (so the idempotence
 * guard also dedupes against concurrent lazy fills), then self-continue.
 * Kick off via admin/backfillIpa:start; see that file for the run command.
 */
export const backfillIpaBatch = internalAction({
  args: {
    table: v.union(v.literal('texts'), v.literal('translations')),
    cursor: v.union(v.string(), v.null()),
    /** Rows examined so far, carried across steps for progress logs. */
    processed: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page: BackfillPage = await ctx.runQuery(
      internal.admin.backfillIpa.pageIpaCandidates,
      {
        table: args.table,
        paginationOpts: { numItems: BACKFILL_BATCH_SIZE, cursor: args.cursor },
      },
    );

    for (const item of page.items) {
      if (!IPA_LANGUAGES.has(item.language)) continue; // belt-and-braces
      let ipa: string;
      try {
        ipa = await ipaForText(item.text, item.language);
      } catch (err) {
        console.error(
          `Backfill IPA error for ${args.table}/${item.textId} (${item.language}), persisting sentinel:`,
          err,
        );
        ipa = '';
      }
      if (args.table === 'texts') {
        await ctx.runMutation(internal.features.decks.storeSourceAnnotation, {
          textId: item.textId,
          kind: 'ipa',
          value: ipa,
          source: getIpaSource(item.language),
          forText: item.text,
        });
      } else {
        await ctx.runMutation(
          internal.features.decks.storeTranslationAnnotation,
          {
            textId: item.textId,
            language: item.language,
            kind: 'ipa',
            value: ipa,
            source: getIpaSource(item.language),
            forText: item.text,
            translationId: item.translationId,
          },
        );
      }
    }

    const processed = (args.processed ?? 0) + page.items.length;
    if (page.isDone) {
      console.log(
        `IPA backfill for ${args.table} finished: ${processed} rows annotated.`,
      );
    } else {
      console.log(`IPA backfill ${args.table}: ${processed} rows so far…`);
      await ctx.scheduler.runAfter(0, internal.features.ipa.backfillIpaBatch, {
        table: args.table,
        cursor: page.continueCursor,
        processed,
      });
    }
    return null;
  },
});
