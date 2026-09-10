import { ActionCtx, MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { romanizeText } from './translation';
import { getRomanizationSource } from '../lib/localRomanization';
import {
  TEXT_ANNOTATIONS,
  runSourceAnnotation,
  runTranslationAnnotation,
  type AnnotationField,
  type AnnotationKind,
} from '../lib/textAnnotations';
import { scheduleSearchableTextRebuild } from './searchRebuild';
import { liveTranslation } from '../db/translationReads';

/**
 * Romanization/annotation pipeline: the worker actions that romanize source
 * texts and translations, and the idempotent store mutations every
 * annotation producer (romanization here, IPA/furigana in their Node-runtime
 * modules) writes through. Owns the `forText` wording-race guard and the
 * stale-engine overwrite rule. The registered functions stay in
 * features/decks.ts and delegate here.
 */

/**
 * Handler body of `processRomanizationForSourceText`: romanize a source text
 * (in the texts table). The same generic runner the IPA and furigana actions
 * use (convex/lib/textAnnotations.ts): a failure about the text persists the
 * `''` sentinel, and a TransientAnnotationError (missing key, rate limit,
 * outage, empty Google reply) leaves the field undefined for the next view.
 */
export async function processRomanizationForSourceTextHandler(
  ctx: ActionCtx,
  args: { textId: Id<'texts'>; text: string; language: string },
): Promise<null> {
  return runSourceAnnotation(
    ctx,
    'romanization',
    args,
    romanizeText,
    getRomanizationSource(args.language),
  );
}

/**
 * Whether this write may land on a row that already has a value.
 *
 * The plain `=== undefined` guard is what makes the pipeline idempotent: a
 * lazy fill racing a backfill must not double-write. But it also silently
 * DROPPED every stale-engine refresh — the probe reported the card as needing
 * work, the scheduler enqueued it, the action recomputed the value, and this
 * mutation threw the result away because a value was already there. A user
 * looking at their library saw the old transcription no matter how many times
 * the engine was bumped.
 *
 * So an existing value is overwritten only when its engine tag is not the one
 * we ship today. That is self-limiting: the write stamps the current tag, so
 * a second refresh finds the row current and stops.
 */
function mayStoreAnnotation(
  spec: (typeof TEXT_ANNOTATIONS)[AnnotationKind],
  row: Partial<Record<AnnotationField, string>>,
  language: string,
): boolean {
  const value = row[spec.textField];
  if (value === undefined) return true;
  // The '' sentinel counts as a value: the engine that wrote it already
  // tried, and a duplicate job's late result under the same tag does not
  // outrank that. A sentinel under a retired tag is replaced like any other
  // stale value.
  const storedSource = row[spec.sourceField];
  // Untagged rows predate the source field; there is nothing to compare, and
  // overwriting them on every pass would be an unbounded rewrite loop.
  if (storedSource === undefined) return false;
  return storedSource !== spec.currentSource(language);
}

/**
 * Handler body of `storeSourceAnnotation`: store an annotation (romanization
 * or IPA) on a source text document.
 *
 * Idempotent against a real-value race: only patches when the row hasn't
 * been written yet (`=== undefined` on the kind's value field) or holds a
 * value from a retired engine (`mayStoreAnnotation`). The empty-string
 * sentinel for "tried and failed" also wins on first write but never
 * overwrites a previously-stored real value. `source` is recorded so a
 * future strategy swap can find + invalidate the row.
 */
export async function storeSourceAnnotationHandler(
  ctx: MutationCtx,
  args: {
    textId: Id<'texts'>;
    kind: AnnotationKind;
    value: string;
    source: string;
    // The text the annotation was computed FROM. The row's wording can change
    // between the action reading it and this mutation running (a backfill
    // racing a retranslation); a mismatched annotation must not land — the
    // field stays undefined so the lazy pipeline regenerates against the
    // current wording. Optional only for in-flight jobs enqueued before the
    // field existed. Mirror of `forText` in storeApprovalEntryAnnotations.
    forText?: string;
  },
): Promise<null> {
  const spec = TEXT_ANNOTATIONS[args.kind];
  const text = await ctx.db.get(args.textId);
  if (args.forText !== undefined && text && text.text !== args.forText) {
    return null;
  }
  if (text && mayStoreAnnotation(spec, text, text.language)) {
    const patch: Partial<Record<AnnotationField, string>> = {};
    patch[spec.textField] = args.value;
    patch[spec.sourceField] = args.source;
    await ctx.db.patch(args.textId, patch);
    // A newly-landed value belongs in the cards' search string only for
    // kinds users actually type (romanization; not IPA), and the
    // empty-string "tried, failed" sentinel never does.
    if (spec.inSearchableText && args.value !== '') {
      await scheduleSearchableTextRebuild(ctx, args.textId);
    }
  }
  return null;
}

/**
 * Handler body of `processRomanizationForTranslation`: romanize an existing
 * translation (backfill). Same runner and failure rule as the source-text
 * handler above.
 */
export async function processRomanizationForTranslationHandler(
  ctx: ActionCtx,
  args: {
    textId: Id<'texts'>;
    text: string;
    language: string;
    translationId?: Id<'translations'>;
  },
): Promise<null> {
  return runTranslationAnnotation(
    ctx,
    'romanization',
    args,
    romanizeText,
    getRomanizationSource(args.language),
  );
}

/**
 * Handler body of `storeTranslationAnnotation`: store an annotation
 * (romanization or IPA) on a translation document. Same idempotence +
 * sentinel + source semantics as `storeSourceAnnotationHandler` above.
 */
export async function storeTranslationAnnotationHandler(
  ctx: MutationCtx,
  args: {
    textId: Id<'texts'>;
    language: string;
    kind: AnnotationKind;
    value: string;
    source: string;
    // See storeSourceAnnotationHandler: skip when the row's wording moved on.
    forText?: string;
    // The exact row to patch: a superseded revision (see `supersededAt` in
    // schema.ts) cannot be found by (text, language). Absent = the live row.
    translationId?: Id<'translations'>;
  },
): Promise<null> {
  const spec = TEXT_ANNOTATIONS[args.kind];
  const byId =
    args.translationId !== undefined
      ? await ctx.db.get(args.translationId)
      : null;
  const translation =
    args.translationId !== undefined
      ? byId && byId.textId === args.textId
        ? byId
        : null
      : await liveTranslation(ctx, args.textId, args.language);
  if (
    args.forText !== undefined &&
    translation &&
    translation.translatedText !== args.forText
  ) {
    return null;
  }
  if (
    translation &&
    mayStoreAnnotation(spec, translation, translation.targetLanguage)
  ) {
    const patch: Partial<Record<AnnotationField, string>> = {};
    patch[spec.textField] = args.value;
    patch[spec.sourceField] = args.source;
    await ctx.db.patch(translation._id, patch);
    // See storeSourceAnnotationHandler: only searchable kinds with a real value.
    if (spec.inSearchableText && args.value !== '') {
      await scheduleSearchableTextRebuild(ctx, args.textId);
    }
  }
  return null;
}
