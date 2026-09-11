import { ANNOTATION_REQUEST_COOLDOWN_MS } from './textAnnotations';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * The `hyperliterals` table's rules: the engine tag, what counts as missing,
 * and the cascade that removes a sentence's glosses when its wording changes.
 *
 * This kind deliberately does NOT join the `TEXT_ANNOTATIONS` registry in
 * textAnnotations.ts. That registry is built around a value + source column
 * pair living on the annotated row, and a gloss cannot live there: one
 * sentence carries one gloss per gloss language, and `translations` rows are
 * shared between users who read different base languages. The cost is a
 * hyperliteral-specific branch in the sweep, the probe and the projection;
 * the benefit is that a second gloss language is a new row rather than a
 * schema migration.
 */

/**
 * Engine + prompt version. Bumping this makes every existing row stale, and
 * each one regenerates the next time its card is viewed.
 *
 * `gemini-3.8-flash-floor-v1`: chosen by `pnpm eval:hyperliteral` on
 * 2026-09-11 over GPT-5.6 Luna, which the plan had proposed. Across 200 items
 * in fi/hu/tr/ja/zh, Flash scored 86% lexical coverage against Luna's 83%,
 * produced the right number of gloss units on 100% of sentences against Luna's
 * 90%, and led 7.7 to 6.9 on a Claude Sonnet judge (a third family, related to
 * neither candidate). It costs about 9x more per sentence — $0.000534 against
 * $0.000058 — which is 9x a very small number, and it is already the
 * romanization model, so it adds no new provider surface.
 */
export const HYPERLITERAL_SOURCES = {
  geminiFlashFloor: 'gemini-3.8-flash-floor-v1',
} as const;

export type HyperliteralSource =
  (typeof HYPERLITERAL_SOURCES)[keyof typeof HYPERLITERAL_SOURCES];

/**
 * Per-language engine tags, for a language whose conventions are revised on
 * their own. One tag per language, like `LLM_ROMANIZATION_SOURCES`, so
 * rewriting the Turkish case table does not re-buy every Japanese row.
 */
const PER_LANGUAGE_SOURCES: Partial<Record<string, string>> = {};

/** The tag a row written today for `language` would carry. */
export function getHyperliteralSource(language: string): string {
  return (
    PER_LANGUAGE_SOURCES[language] ?? HYPERLITERAL_SOURCES.geminiFlashFloor
  );
}

/** See `deleteHyperliteralsFor`: a bound on how many gloss languages one
 *  sentence can carry, not a page size. */
const MAX_GLOSS_LANGUAGES_PER_SENTENCE = 50;

/** The subject a gloss hangs off: exactly one of the two ids. */
export type HyperliteralSubject =
  | { textId: Id<'texts'>; translationId?: undefined }
  | { translationId: Id<'translations'>; textId?: undefined };

export type HyperliteralState = 'missing' | 'inFlight' | 'done';

/**
 * Whether this row still has work outstanding, ignoring any request already in
 * flight. CLOCK-FREE, so a query may ask it: Convex queries are not re-run
 * merely because time advances, and reading the wall clock in one both yields
 * stale answers and costs query-cache reuse (see the Query guidelines in
 * convex/_generated/ai/guidelines.md). `missingAnnotationKinds` is clock-free
 * for the same reason, and the cooldown lives only on the scheduling side.
 *
 * True when there is no row, when the row was written by an engine we no
 * longer ship, when it was made for a wording the sentence has since moved
 * off, or when it has no text yet.
 *
 * The `''` failure sentinel is NOT outstanding work for the CURRENT engine:
 * that engine already tried this exact sentence, and retrying on every view
 * would be a paid call that always fails. A STALE sentinel is, because a new
 * engine deserves its own attempt.
 */
export function hyperliteralNeedsWork(
  row: Doc<'hyperliterals'> | null | undefined,
  expected: { language: string; wording: string },
): boolean {
  if (!row) return true;
  if (row.source !== getHyperliteralSource(expected.language)) return true;
  if (row.forText !== expected.wording) return true;
  return row.text === undefined;
}

/**
 * `hyperliteralNeedsWork` plus the request cooldown, for the SCHEDULING side.
 * A claim younger than the cooldown is `inFlight` and is left alone, so a
 * provider outage costs one attempt per window instead of one per view.
 *
 * Takes `now` explicitly and is only called from mutations; a query must ask
 * `hyperliteralNeedsWork` instead.
 */
export function hyperliteralState(
  row: Doc<'hyperliterals'> | null | undefined,
  expected: { language: string; wording: string },
  now: number,
): HyperliteralState {
  if (!hyperliteralNeedsWork(row, expected)) return 'done';
  if (
    row &&
    row.text === undefined &&
    now - row.requestedAt < ANNOTATION_REQUEST_COOLDOWN_MS
  ) {
    // Same row, same engine, same wording, just not finished yet.
    return row.source === getHyperliteralSource(expected.language) &&
      row.forText === expected.wording
      ? 'inFlight'
      : 'missing';
  }
  return 'missing';
}

/** The gloss to display, or undefined when there is nothing to show. Also
 *  clock-free: the `''` sentinel and an unfinished claim both render as no
 *  line rather than a blank one. */
export function hyperliteralTextOf(
  row: Doc<'hyperliterals'> | null | undefined,
  expected: { language: string; wording: string },
): string | undefined {
  if (hyperliteralNeedsWork(row, expected)) return undefined;
  const text = row?.text;
  return text !== undefined && text.length > 0 ? text : undefined;
}

/** This subject's gloss in one language, through the matching index. */
export async function getHyperliteral(
  ctx: QueryCtx,
  subject: HyperliteralSubject,
  glossLanguage: string,
): Promise<Doc<'hyperliterals'> | null> {
  if (subject.translationId !== undefined) {
    const translationId = subject.translationId;
    return ctx.db
      .query('hyperliterals')
      .withIndex('by_translationId_and_glossLanguage', (q) =>
        q.eq('translationId', translationId).eq('glossLanguage', glossLanguage),
      )
      .first();
  }
  const textId = subject.textId;
  return ctx.db
    .query('hyperliterals')
    .withIndex('by_textId_and_glossLanguage', (q) =>
      q.eq('textId', textId).eq('glossLanguage', glossLanguage),
    )
    .first();
}

/**
 * Claim this subject's gloss for regeneration and return the row to work on,
 * or null when nothing is due.
 *
 * Reads the index before writing, so two sweeps racing on the same card
 * produce one row rather than two. An existing stale row is reused rather than
 * replaced, which keeps the gloss's identity stable across engine bumps.
 */
export async function claimHyperliteral(
  ctx: MutationCtx,
  subject: HyperliteralSubject,
  args: { language: string; glossLanguage: string; wording: string },
): Promise<Id<'hyperliterals'> | null> {
  const existing = await getHyperliteral(ctx, subject, args.glossLanguage);
  const state = hyperliteralState(
    existing,
    { language: args.language, wording: args.wording },
    Date.now(),
  );
  if (state !== 'missing') return null;
  const claim = {
    language: args.language,
    glossLanguage: args.glossLanguage,
    forText: args.wording,
    source: getHyperliteralSource(args.language),
    text: undefined,
    requestedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch('hyperliterals', existing._id, claim);
    return existing._id;
  }
  return ctx.db.insert('hyperliterals', { ...subject, ...claim });
}

/**
 * Drop every gloss of a sentence, in every gloss language. Called where the
 * wording is patched IN PLACE (a user edit), alongside
 * `clearedAnnotationFields`. A retranslation makes a new `translations` row
 * instead, so its glosses are simply never found.
 *
 * One row per gloss language, and `glossLanguageFor` returns a single value
 * today, so the `take` bound below is an assertion that this set is small
 * rather than a page size: there is nothing to continue to. Revisit it only if
 * a sentence can ever carry dozens of gloss languages at once.
 */
export async function deleteHyperliteralsFor(
  ctx: MutationCtx,
  subject: HyperliteralSubject,
): Promise<void> {
  const rows =
    subject.translationId !== undefined
      ? await ctx.db
          .query('hyperliterals')
          .withIndex('by_translationId_and_glossLanguage', (q) =>
            q.eq('translationId', subject.translationId),
          )
          .take(MAX_GLOSS_LANGUAGES_PER_SENTENCE)
      : await ctx.db
          .query('hyperliterals')
          .withIndex('by_textId_and_glossLanguage', (q) =>
            q.eq('textId', subject.textId),
          )
          .take(MAX_GLOSS_LANGUAGES_PER_SENTENCE);
  for (const row of rows) await ctx.db.delete('hyperliterals', row._id);
}
