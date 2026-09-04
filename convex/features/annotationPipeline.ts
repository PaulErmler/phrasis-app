import { ActionCtx, MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { romanizeText } from './translation';
import { getRomanizationSource } from '../lib/localRomanization';
import {
  TEXT_ANNOTATIONS,
  type AnnotationField,
  type AnnotationKind,
} from '../lib/textAnnotations';
import { scheduleSearchableTextRebuild } from './searchRebuild';
import { liveTranslation } from '../db/translationReads';

/**
 * Romanization/annotation pipeline: the worker actions that romanize source
 * texts and translations, and the idempotent store mutations every
 * annotation producer (romanization here, IPA/furigana in their Node-runtime
 * modules) writes through. Owns the empty-string "tried and failed" sentinel
 * and the `forText` wording-race guard. The registered functions stay in
 * features/decks.ts and delegate here.
 */

/**
 * Handler body of `processRomanizationForSourceText`: romanize a source text
 * (in the texts table). (The IPA sibling lives in convex/features/ipa.ts:
 * espeak needs the Node runtime; both write through the generic store
 * mutations below.)
 */
export async function processRomanizationForSourceTextHandler(
  ctx: ActionCtx,
  args: { textId: Id<'texts'>; text: string; language: string },
): Promise<null> {
  let romanized: string;
  try {
    romanized = await romanizeText(args.text, args.language);
  } catch (err) {
    // `romanizeText` already retried up to 3 times before throwing.
    // Persist an empty-string sentinel so `scheduleMissingContent` doesn't
    // reschedule another 3-retry burst on every ensureContent call.
    console.error('Source romanization error (persisting sentinel):', err);
    romanized = '';
  }
  // Source recorded even on failure: lets a strategy swap target failed
  // rows by the source that produced the sentinel.
  await ctx.runMutation(internal.features.decks.storeSourceAnnotation, {
    textId: args.textId,
    kind: 'romanization',
    value: romanized,
    source: getRomanizationSource(args.language),
    forText: args.text,
  });
  return null;
}

/**
 * Handler body of `storeSourceAnnotation`: store an annotation (romanization
 * or IPA) on a source text document.
 *
 * Idempotent against a real-value race: only patches when the row hasn't
 * been written yet (`=== undefined` on the kind's value field). The
 * empty-string sentinel for "tried and failed" also wins on first write but
 * never overwrites a previously-stored real value. `source` is recorded so
 * a future strategy swap can find + invalidate the row.
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
  if (text && text[spec.textField] === undefined) {
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
 * translation (backfill). (IPA sibling: processIpaForTranslation in
 * convex/features/ipa.ts.)
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
  let romanized: string;
  try {
    romanized = await romanizeText(args.text, args.language);
  } catch (err) {
    // `romanizeText` already retried up to 3 times before throwing.
    // Persist an empty-string sentinel so `scheduleMissingContent` doesn't
    // reschedule another 3-retry burst on every ensureContent call.
    console.error('Translation romanization error (persisting sentinel):', err);
    romanized = '';
  }
  // Source recorded even on failure: lets a strategy swap target failed
  // rows by the source that produced the sentinel.
  await ctx.runMutation(internal.features.decks.storeTranslationAnnotation, {
    textId: args.textId,
    language: args.language,
    kind: 'romanization',
    value: romanized,
    source: getRomanizationSource(args.language),
    forText: args.text,
    translationId: args.translationId,
  });
  return null;
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
  if (translation && translation[spec.textField] === undefined) {
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
