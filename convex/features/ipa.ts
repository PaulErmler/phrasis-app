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
import { getIpaSource } from '../lib/textAnnotations';
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
 */
export function cleanEspeakIpa(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/_/g, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * IPA for `text` in `language`. Throws when the language has no espeak voice
 * or espeak returns nothing; callers convert that into the `''` sentinel.
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
  return ipa;
}

/**
 * IPA for a source text (texts table). Mirror of
 * processRomanizationForSourceText in decks.ts.
 */
export const processIpaForSourceText = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let ipa: string;
    try {
      ipa = await ipaForText(args.text, args.language);
    } catch (err) {
      // Persist the empty-string sentinel so scheduleMissingContent doesn't
      // re-enqueue the same failing input on every ensureContent call.
      console.error('Source IPA error (persisting sentinel):', err);
      ipa = '';
    }
    // Source recorded even on failure: lets an engine swap target failed
    // rows by the source that produced the sentinel.
    await ctx.runMutation(internal.features.decks.storeSourceAnnotation, {
      textId: args.textId,
      kind: 'ipa',
      value: ipa,
      source: getIpaSource(args.language),
      forText: args.text,
    });
    return null;
  },
});

/**
 * IPA for a translation row. Mirror of processRomanizationForTranslation
 * in decks.ts.
 */
export const processIpaForTranslation = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let ipa: string;
    try {
      ipa = await ipaForText(args.text, args.language);
    } catch (err) {
      console.error('Translation IPA error (persisting sentinel):', err);
      ipa = '';
    }
    await ctx.runMutation(internal.features.decks.storeTranslationAnnotation, {
      textId: args.textId,
      language: args.language,
      kind: 'ipa',
      value: ipa,
      source: getIpaSource(args.language),
      forText: args.text,
    });
    return null;
  },
});

/**
 * IPA for a chat card proposal's entries. Proposals live only on the
 * `cardApprovals` row (no texts/translations rows exist until approval), so
 * they get their own store path. One action per proposal, all entries in one
 * pass. Results carry the text they were computed for; the store mutation
 * drops any whose entry has since been edited (see storeApprovalEntryIpa).
 */
export const processIpaForApproval = internalAction({
  args: {
    approvalId: v.id('cardApprovals'),
    entries: v.array(
      v.object({ language: v.string(), text: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const results: Array<{ language: string; forText: string; ipa: string }> =
      [];
    for (const entry of args.entries) {
      let ipa: string;
      try {
        ipa = await ipaForText(entry.text, entry.language);
      } catch (err) {
        console.error(
          `Approval IPA error for ${entry.language} (persisting sentinel):`,
          err,
        );
        ipa = '';
      }
      results.push({ language: entry.language, forText: entry.text, ipa });
    }
    if (results.length > 0) {
      await ctx.runMutation(
        internal.features.chat.cardApprovals.storeApprovalEntryIpa,
        { approvalId: args.approvalId, results },
      );
    }
    return null;
  },
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
