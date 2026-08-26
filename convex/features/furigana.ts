'use node';

/**
 * Furigana generation: kana readings laid over the kanji runs of a Japanese
 * sentence, stored as one bracketed string (see lib/furigana.ts for the
 * format and the client-side reader).
 *
 * Node runtime for the same reason as IPA: the analyzer is a WASM build whose
 * embedded IPADIC dictionary is ~13 MB, far past the V8 isolate's 32 MiB
 * bundle cap, so it ships via `node.externalPackages` in convex.json. This
 * file may therefore only export actions; the store mutations live in decks.ts
 * and everything V8-shareable (registry, source tags) in
 * convex/lib/textAnnotations.ts.
 *
 * Same lazy pipeline shape as romanization and IPA: schedulers enqueue
 * `processFuriganaFor*` when `furiganaText === undefined`; failures persist
 * the `''` sentinel so nothing re-enqueues them. The deploy-time backfill
 * (backfillTextFurigana / backfillTranslationFurigana in convex/migrations.ts)
 * schedules these same actions per existing row, so the store mutations'
 * idempotence guard dedupes it against concurrent lazy fills. Like espeak and unlike
 * `romanizeText` (network), this is deterministic local compute, so there is
 * no retry loop — the first failure is as good as the third.
 *
 * Why IPADIC and not UniDic: IPADIC's `reading` field is the SURFACE reading
 * ("続け" → ツヅケ), which is what ruby needs. UniDic returns the lemma
 * reading there ("続け" → ツヅケル) and its surface field is a phonetic
 * respelling that corrupts ヅ→ズ and long vowels →ー, so recovering the kana
 * spelling from it is lossy. IPADIC is also better on several everyday words
 * (私 → ワタシ, not ワタクシ) and a third of the download.
 */

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { FURIGANA_LANGUAGES } from '../../lib/languages';
import {
  fitReading,
  hasKanji,
  katakanaToHiragana,
  serializeFurigana,
  type FuriganaSegment,
} from '../../lib/furigana';
import {
  getFuriganaSource,
  runApprovalAnnotation,
  runSourceAnnotation,
  runTranslationAnnotation,
} from '../lib/textAnnotations';

/** Shape of the token objects the analyzer returns (camelCase per its docs). */
interface LinderaToken {
  surface: string;
  /** Surface reading in katakana, or '*' for tokens the dictionary lacks. */
  reading?: string;
}
interface LinderaTokenizer {
  tokenize(text: string): LinderaToken[];
}

/**
 * One tokenizer per Node instance, built on first use and reused across warm
 * invocations: the build parses the embedded dictionary (~110 ms), far too
 * expensive per call. Mirrors the espeak worker in features/ipa.ts and the
 * lazy OpenCC converter in lib/localRomanization.ts.
 *
 * Dynamic import because the package is marked external — a static import can
 * surface as `require()` of an ES module in the bundled CJS output.
 */
let tokenizerPromise: Promise<LinderaTokenizer> | undefined;
async function getTokenizer(): Promise<LinderaTokenizer> {
  tokenizerPromise ??= (async () => {
    const { TokenizerBuilder } = await import('lindera-wasm-nodejs-ipadic');
    const builder = new TokenizerBuilder();
    builder.setDictionary('embedded://ipadic');
    // Whitespace tokens must survive: the annotation has to reconstruct the
    // sentence character-for-character or the client's validator rejects it.
    builder.setKeepWhitespace(true);
    return builder.build() as LinderaTokenizer;
  })();
  try {
    return await tokenizerPromise;
  } catch (err) {
    // Never cache a failed build: with the rejection memoized, every later
    // invocation in this warm instance would fail too, and each failure
    // persists a permanent `''` sentinel — one transient hiccup loading the
    // ~13 MB dictionary would silently strip furigana from every row this
    // instance touches. Clearing lets the next invocation rebuild.
    tokenizerPromise = undefined;
    throw err;
  }
}

/**
 * Bracketed furigana for `text`. Returns the `''` sentinel directly for
 * sentences with no kanji (すみません, やった！ — common and EXPECTED, so no
 * error is logged for them); throws when the language is unsupported or when
 * kanji are present but no reading could be fitted (a real engine problem
 * worth a log line). Callers convert the throw into the same `''` sentinel.
 *
 * Per token: skip anything without kanji (kana, latin, punctuation), then fit
 * the token's own reading onto its surface. A token whose reading is missing
 * or cannot be aligned is emitted bare — showing the sentence with one word
 * un-annotated is always better than showing an invented reading.
 */
export async function furiganaForText(
  text: string,
  language: string,
): Promise<string> {
  if (!FURIGANA_LANGUAGES.has(language)) {
    throw new Error(`Furigana is not supported for language "${language}"`);
  }
  // Kana-only sentence: nothing a reading could attach to. The sentinel is
  // the correct durable answer, not a failure.
  if (!hasKanji(text)) return '';
  const tokenizer = await getTokenizer();

  const segments: FuriganaSegment[] = [];
  let annotated = 0;
  for (const token of tokenizer.tokenize(text)) {
    const fitted = fitTokenReading(token);
    if (fitted === null) {
      segments.push({ text: token.surface });
    } else {
      segments.push(...fitted);
      annotated++;
    }
  }

  if (annotated === 0) {
    // Kanji exist but not one reading could be fitted — dictionary gap or
    // tokenizer trouble, unlike the kana-only early return above.
    throw new Error('No kanji readings produced');
  }
  // Belt-and-braces against a tokenizer that drops or rewrites input: the
  // client would reject a lossy annotation anyway, so fail loudly here and
  // store the sentinel rather than persist a string that can never render.
  const reconstructed = segments.map((seg) => seg.text).join('');
  if (reconstructed !== text) {
    throw new Error('Tokenization did not reconstruct the source text');
  }
  return serializeFurigana(segments);
}

function fitTokenReading(token: LinderaToken): FuriganaSegment[] | null {
  if (!hasKanji(token.surface)) return null;
  const reading = token.reading;
  if (reading === undefined || reading === '' || reading === '*') return null;
  return fitReading(token.surface, katakanaToHiragana(reading));
}

// The three process actions share the generic try/generate/sentinel/store
// bodies in convex/lib/textAnnotations.ts (runSourceAnnotation and friends);
// this file only declares the Node runtime and supplies the lindera engine.
// Note the sentinel doubles as a legitimate durable answer here: a kana-only
// sentence "fails" into '' by design (nothing to annotate, never re-check).

/** Furigana for a source text (texts table). */
export const processFuriganaForSourceText = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runSourceAnnotation(
      ctx,
      'furigana',
      args,
      furiganaForText,
      getFuriganaSource(args.language),
    ),
});

/** Furigana for a chat card proposal's entries (see runApprovalAnnotation). */
export const processFuriganaForApproval = internalAction({
  args: {
    approvalId: v.id('cardApprovals'),
    entries: v.array(v.object({ language: v.string(), text: v.string() })),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runApprovalAnnotation(ctx, 'furigana', args, furiganaForText),
});

/** Furigana for a translation row. */
export const processFuriganaForTranslation = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runTranslationAnnotation(
      ctx,
      'furigana',
      args,
      furiganaForText,
      getFuriganaSource(args.language),
    ),
});
