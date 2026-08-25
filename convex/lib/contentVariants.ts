import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type ReadCtx = QueryCtx | MutationCtx;

/**
 * Variant-tolerant reads for the per-(textId, language) content tables.
 *
 * Since the speaker-gender-preference feature, `translations` may hold up to
 * one row per gender slot ('male' / 'female' / 'neutral') plus at most one
 * legacy unstamped row per (textId, targetLanguage), and `audioRecordings`
 * one pointer per asset voice-gender. NO read may assume a single row —
 * `.unique()` throws on the second variant and `.first()` picks an arbitrary
 * one. Fetch bounded row sets with these helpers and pick deliberately.
 *
 * Gender-AWARE picking (per-user effective gender) lives in
 * lib/speakerGender.ts (`pickTranslationVariant`) and is used by the serve
 * batch (convex/lib/cardContent.ts) and the ensure sweep (features/decks.ts).
 * The display pick below is for sites WITHOUT a preference context.
 */

/**
 * Upper bound on rows per (textId, targetLanguage): three gender slots plus
 * at most one legacy unstamped row.
 */
export const MAX_TRANSLATION_VARIANTS = 4;

/** Upper bound on audio pointer rows per (textId, language): one per
 * voice gender, with slack for transient duplicates. */
export const MAX_AUDIO_POINTER_ROWS = 4;

/** All translation variant rows of one (textId, targetLanguage), in creation
 * order. */
export async function fetchTranslationRows(
  ctx: ReadCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'translations'>[]> {
  return await ctx.db
    .query('translations')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('targetLanguage', targetLanguage),
    )
    .take(MAX_TRANSLATION_VARIANTS);
}

/** All audio pointer rows of one (textId, language), in creation order. */
export async function fetchAudioRows(
  ctx: ReadCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<Doc<'audioRecordings'>[]> {
  return await ctx.db
    .query('audioRecordings')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .take(MAX_AUDIO_POINTER_ROWS);
}

/**
 * Preference-INDEPENDENT display pick for read sites without a user/course
 * context (placement test, onboarding first lesson, chat card context,
 * new-word stats, collection level previews): prefer the gender-independent
 * rendering ('neutral'), then the legacy/canonical carrier (unstamped), then
 * whatever exists. Deterministic, and identical to the old `.first()` on
 * single-row data.
 */
export function pickDisplayTranslationRow<
  T extends { speakerGender?: string },
>(rows: readonly T[]): T | null {
  return (
    rows.find((r) => r.speakerGender === 'neutral') ??
    rows.find((r) => r.speakerGender === undefined) ??
    rows[0] ??
    null
  );
}

/** Fetch + display-pick in one call. */
export async function getDisplayTranslation(
  ctx: ReadCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'translations'> | null> {
  return pickDisplayTranslationRow(
    await fetchTranslationRows(ctx, textId, targetLanguage),
  );
}
