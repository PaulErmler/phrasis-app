import { ConvexError } from 'convex/values';
import { MutationCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { asVoiceGender } from '../types';
import {
  carriedAnnotationFields,
  clearedAnnotationFields,
} from '../lib/textAnnotations';
import { USER_PROVIDED_TRANSLATION_SOURCE } from '../../lib/translationProvenance';
import { deleteAudioRowsForTextLanguage } from '../lib/audio';
import { soundsSame } from '../lib/textComparison';
import { canonicalizeApostrophes } from '../../lib/languages';
import { MAX_CARD_TEXT_LENGTH } from '../../lib/constants/learning';
import {
  languageRole,
  recordCardEdit,
  type CardEditChange,
} from './cardEditAudit';
import { buildCardSearchableText } from '../lib/cardContent';
import {
  cardPinAt,
  cardRowLanguage,
  liveTranslation,
  resolveServedFromLive,
  viewOfCard,
  type ServedTranslation,
} from '../db/translationReads';
import { patchCard } from '../db/stats/cardAggregates';
import { randomOrderKey } from '../lib/freePlay';
import { updateWordTextsForEdit } from '../db/stats/wordTracking';
import { scheduleMissingContent } from '../lib/contentScheduling';

/**
 * Implementation phases of `applyCardEdit` (which stays in
 * convex/features/scheduling.ts as the orchestrator, shared by the `editCard`
 * mutation and the chat "also correct" replace path). The orchestrator reads
 * as: diff plan → length validation → billing → audit start → Path A/B →
 * card repoint → derived-content propagation → audit tail.
 */

/**
 * Everything `applyCardEdit`'s downstream phases need to know about the diff
 * between the submitted texts and the card's stored content, resolved once
 * up front by `resolveCardEditPlan`.
 */
export type CardEditPlan = {
  sourceLanguage: string;
  /** Deduped course base + target languages. */
  allLanguages: string[];
  /**
   * Course language to the row language the card reads for it
   * (`cardRowLanguage`). That is the language itself, except the source
   * slot of a Mixed English card, which reads its accent row (`en` to
   * `en_gb`). Every map below is keyed by the course language, the one the
   * dialog submits.
   */
  rowLanguages: Map<string, string>;
  /** language → submitted text, for the languages the caller sent. */
  submittedMap: Map<string, string>;
  /**
   * language to LIVE translations row, for every language backed by a row.
   * Those are the non-source languages, and the source slot when it reads
   * an accent row.
   */
  existingTranslationMap: Map<string, Doc<'translations'>>;
  /**
   * language → what the learner's card shows. Equals the live row unless the
   * card is pinned to a superseded revision (convex/db/translationReads.ts).
   * The diff, the audit's "before" and the fork's carried-over wording all
   * read this; Path A patches the live rows by id.
   */
  servedTranslationMap: Map<string, ServedTranslation>;
  /**
   * The wording the card shows for a course language. The served row, or
   * the source text for the source slot, also while the accent row it
   * should read has not landed. Every submitted line is diffed against
   * this, so an untouched line never counts as an edit.
   */
  shownText: (lang: string) => string;
  /** Languages whose stored text differs from the submitted text. */
  changedLanguages: Set<string>;
  /**
   * The source wording changed. The source line was edited on a card that
   * shows the source text itself. False when the edited source line is an
   * accent row, which is a translation row like any other, since the
   * other lines still describe the same curriculum sentence.
   */
  sourceWordingChanged: boolean;
  /** Audio-relevant subset of `changedLanguages` (see `resolveCardEditPlan`). */
  audioChangedLanguages: Set<string>;
  /** The text row is user-created and owned by this user (Path A). */
  isUserOwned: boolean;
  /** Path B must run: shared text with changes, or ownership demanded. */
  needsCopy: boolean;
  /** Gender to stamp onto written translation rows (see `resolveCardEditPlan`). */
  audioGenderStamp: 'male' | 'female' | undefined;
};

/**
 * Diff the submitted texts against the stored source text + translations and
 * decide which path the edit takes. Pure reads; the one Path A/B decision
 * input beyond the diff is text ownership.
 *
 * A no-op edit is the caller's early return: `changedLanguages` empty and
 * `needsCopy` false means nothing to write.
 */
export async function resolveCardEditPlan(
  ctx: MutationCtx,
  params: {
    userId: string;
    card: Doc<'cards'>;
    text: Doc<'texts'>;
    course: Doc<'courses'>;
    translations: { language: string; text: string }[];
    ensureUserOwnedText: boolean | undefined;
    proposedAudioSpeakerGender: 'male' | 'female' | undefined;
  },
): Promise<CardEditPlan> {
  const { userId, card, text, course, translations } = params;

  // Narrow the card's resolved voice gender once for stamping onto the
  // translation rows below. `texts.audioSpeakerGender` is typed as a loose
  // string but is always 'male' | 'female' in practice; the stamped
  // `translations.speakerGender` field is strict. A proposed gender wins.
  // The re-stamped rows must agree with the voice the edit enqueues.
  const audioGenderStamp = asVoiceGender(
    params.proposedAudioSpeakerGender ?? text.audioSpeakerGender,
  );

  const sourceLanguage = text.language;
  const allLanguages = [
    ...new Set([...course.baseLanguages, ...course.targetLanguages]),
  ];
  const view = viewOfCard(card);
  const rowLanguages = new Map(
    allLanguages.map((lang) => [lang, cardRowLanguage(text, view, lang)]),
  );

  // Load the live row of every language the card reads a row for. Those
  // are the non-source languages, and the source slot when it reads an
  // accent row.
  const rowBackedLanguages = [...rowLanguages].filter(
    ([, rowLang]) => rowLang !== sourceLanguage,
  );
  const existingTranslations = await Promise.all(
    rowBackedLanguages.map(([, rowLang]) =>
      liveTranslation(ctx, card.textId, rowLang),
    ),
  );
  const existingTranslationMap = new Map<string, Doc<'translations'>>();
  rowBackedLanguages.forEach(([lang], i) => {
    const row = existingTranslations[i];
    if (row) existingTranslationMap.set(lang, row);
  });
  const servedTranslationMap = new Map<string, ServedTranslation>();
  for (const [lang, live] of existingTranslationMap) {
    servedTranslationMap.set(
      lang,
      await resolveServedFromLive(ctx, live, view.pinAt),
    );
  }
  const shownText = (lang: string): string => {
    const served = servedTranslationMap.get(lang)?.row.translatedText;
    if (served !== undefined) return served;
    return lang === sourceLanguage ? text.text : '';
  };

  // Build a map of submitted texts
  const submittedMap = new Map<string, string>();
  for (const t of translations) {
    submittedMap.set(t.language, t.text);
  }

  // Diff: determine which languages actually changed
  const changedLanguages = new Set<string>();
  for (const lang of allLanguages) {
    const submitted = submittedMap.get(lang);
    if (submitted === undefined) continue;
    if (submitted !== shownText(lang)) changedLanguages.add(lang);
  }
  const sourceWordingChanged =
    changedLanguages.has(sourceLanguage) &&
    !servedTranslationMap.has(sourceLanguage);

  const isUserOwned = text.userCreated && text.userId === userId;
  // Path B must also run for a no-text-change call that requires ownership
  // (metadata-only "also correct" replace on a shared text): the pure
  // logical copy gives the caller a user-owned row to patch.
  const needsCopy =
    !isUserOwned &&
    (changedLanguages.size > 0 || params.ensureUserOwnedText === true);

  // Audio-relevant subset of the diff: an edit that only touches
  // punctuation/'_' (`soundsSame`) sounds identical spoken aloud, so the
  // language keeps its audio. Path A skips the delete, Path B copies the
  // rows like an unchanged language (word timings still align; the words
  // are the same). Text/romanization writes keep using the full
  // `changedLanguages` set.
  const audioChangedLanguages = new Set<string>();
  for (const lang of changedLanguages) {
    if (!soundsSame(submittedMap.get(lang)!, shownText(lang))) {
      audioChangedLanguages.add(lang);
    }
  }

  return {
    sourceLanguage,
    allLanguages,
    rowLanguages,
    submittedMap,
    existingTranslationMap,
    servedTranslationMap,
    shownText,
    changedLanguages,
    sourceWordingChanged,
    audioChangedLanguages,
    isUserOwned,
    needsCopy,
    audioGenderStamp,
  };
}

/** Reject any submitted text over the per-card length cap. */
export function assertTranslationLengths(
  translations: { language: string; text: string }[],
): void {
  for (const { language, text } of translations) {
    if (text.length > MAX_CARD_TEXT_LENGTH) {
      throw new ConvexError({
        code: 'TEXT_TOO_LONG',
        message: `Text for language "${language}" exceeds the maximum length of ${MAX_CARD_TEXT_LENGTH} characters.`,
        language,
        maxLength: MAX_CARD_TEXT_LENGTH,
      });
    }
  }
}

/**
 * Write the `cardEdits` audit row before the paths diverge: Path B's
 * curriculum-fix enqueue needs its id and runs before the replacement card
 * exists. The after-ids therefore start as the before-ids and are corrected
 * at the end (`setCardEditResult`), on the fork path only.
 *
 * Skipped when no wording changed. `ensureUserOwnedText` reaches here with
 * an empty diff (the metadata-only "also correct" replace, which forks
 * purely to get a user-owned row): a real card replacement, but not an
 * edit, and logging it as one would put a changeless row in a feed whose
 * whole subject is before/after wording.
 */
export async function recordCardEditAuditStart(
  ctx: MutationCtx,
  params: {
    userId: string;
    course: Doc<'courses'>;
    card: Doc<'cards'>;
    text: Doc<'texts'>;
    plan: CardEditPlan;
    auditKind: 'manual_edit' | 'chat_also_correct';
  },
): Promise<Id<'cardEdits'> | undefined> {
  const { userId, course, card, text, plan, auditKind } = params;
  const {
    sourceLanguage,
    submittedMap,
    existingTranslationMap,
    servedTranslationMap,
    shownText,
    changedLanguages,
    audioChangedLanguages,
    isUserOwned,
  } = plan;

  const auditChanges: CardEditChange[] = [...changedLanguages].map((lang) => {
    const isSourceLanguage = lang === sourceLanguage;
    // The source slot of a Mixed English card is an accent row, so it
    // carries row provenance like any translation.
    const served = servedTranslationMap.get(lang);
    return {
      language: lang,
      role: languageRole(course, lang),
      isSourceLanguage,
      before: shownText(lang),
      after: submittedMap.get(lang)!,
      ...(served
        ? {
            beforeTranslationSource: served.row.translationSource,
            beforeFlagCount: existingTranslationMap.get(lang)?.flagCount,
          }
        : {}),
      soundsSame: !audioChangedLanguages.has(lang),
    };
  });
  if (auditChanges.length === 0) return undefined;
  return recordCardEdit(ctx, {
    userId,
    course,
    kind: auditKind,
    path: isUserOwned ? 'in_place' : 'fork',
    cardIdBefore: card._id,
    cardIdAfter: card._id,
    textIdBefore: card.textId,
    textIdAfter: card.textId,
    collectionOrigin: card.collectionOrigin,
    textWasUserCreated: text.userCreated,
    sourceLanguage,
    sourceText: shownText(sourceLanguage),
    changes: auditChanges,
  });
}

/**
 * Path A: the text row is user-owned, so patch the source text, the changed
 * translation rows, and the now-stale audio pointers in place. The card
 * keeps its textId.
 */
export async function applyInPlaceTextEdit(
  ctx: MutationCtx,
  params: {
    card: Doc<'cards'>;
    text: Doc<'texts'>;
    plan: CardEditPlan;
  },
): Promise<void> {
  const { card, text, plan } = params;
  const {
    sourceLanguage,
    allLanguages,
    submittedMap,
    existingTranslationMap,
    changedLanguages,
    audioChangedLanguages,
    audioGenderStamp,
  } = plan;

  if (changedLanguages.has(sourceLanguage)) {
    // Annotation values and their provenance tags travel as units. The
    // old transliteration/IPA no longer matches the new text, so the
    // tags go with them (mirrors the translation branch below).
    await ctx.db.patch(text._id, {
      text: submittedMap.get(sourceLanguage)!,
      ...clearedAnnotationFields(),
    });
  }

  for (const lang of allLanguages) {
    if (lang === sourceLanguage) continue;
    if (!changedLanguages.has(lang)) continue;
    const existing = existingTranslationMap.get(lang);
    if (existing) {
      // User edited an existing translation. Drop the annotations (they
      // don't match the new text), drop their source tags, and re-tag
      // as user-provided so a future strategy swap doesn't overwrite
      // the user's edit.
      await ctx.db.patch(existing._id, {
        translatedText: canonicalizeApostrophes(lang, submittedMap.get(lang)!),
        ...clearedAnnotationFields(),
        translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        // Stamp with the card's current gender so the mismatch sweep in
        // `scheduleMissingContent` sees agreement (the user-provided
        // branch is already skipped by the sweep, but keeping this in
        // sync avoids relying on that skip).
        ...(audioGenderStamp ? { speakerGender: audioGenderStamp } : {}),
      });
    } else {
      await ctx.db.insert('translations', {
        textId: card.textId,
        targetLanguage: lang,
        translatedText: canonicalizeApostrophes(lang, submittedMap.get(lang)!),
        translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        ...(audioGenderStamp ? { speakerGender: audioGenderStamp } : {}),
      });
    }
  }

  // Detach audio pointers for audibly-changed languages only.
  // Punctuation-only edits keep their audio. keepAsset: the old audio is
  // still correct for the old sentence, so it stays in the audioAssets
  // cache (only the regenerate button and TTS-system migrations fully
  // delete audio).
  for (const lang of audioChangedLanguages) {
    await deleteAudioRowsForTextLanguage(ctx, card.textId, lang, {
      keepAsset: true,
    });
  }
}

/**
 * Path B: fork the shared/dataset text into a user-owned logical copy —
 * new text row (carrying pipeline metadata), translations rows (user-edited
 * ones re-tagged, unchanged ones copied with their annotations/provenance),
 * and audio-recording pointers for languages whose audio is still valid.
 * Returns the forked text's id.
 */
export async function forkSharedTextForEdit(
  ctx: MutationCtx,
  params: {
    userId: string;
    card: Doc<'cards'>;
    text: Doc<'texts'>;
    plan: CardEditPlan;
  },
): Promise<Id<'texts'>> {
  const { userId, card, text, plan } = params;
  const {
    sourceLanguage,
    allLanguages,
    rowLanguages,
    submittedMap,
    servedTranslationMap,
    changedLanguages,
    audioChangedLanguages,
    audioGenderStamp,
  } = plan;

  const submittedSource = submittedMap.get(sourceLanguage);
  const sourceChanged = changedLanguages.has(sourceLanguage);
  // The copy's own text is the wording the learner saw. On a Mixed English
  // card that is the accent row, with that row's annotations, else the
  // source text. A user-owned copy has no accent rows of its own.
  const sourceRow = servedTranslationMap.get(sourceLanguage)?.row;
  const newTextId = await ctx.db.insert('texts', {
    text:
      sourceChanged && submittedSource
        ? submittedSource
        : (sourceRow?.translatedText ?? text.text),
    language: text.language,
    // Annotations (romanization, IPA) travel with their source tags:
    // copy when unchanged (so we keep pointing at whichever engine
    // produced the carried-over text); drop when changed (next
    // ensureContent regenerates and re-tags).
    ...(sourceChanged ? {} : carriedAnnotationFields(sourceRow ?? text)),
    userCreated: true,
    userId,
    collectionId: text.collectionId,
    collectionRank: text.collectionRank,
    // This row is a logical copy of `text`. The user only edited
    // translations, not the source, so preserve all pipeline-derived
    // metadata rather than regenerating it. speakerGender specifically
    // also prevents the downstream `scheduleMissingContent` sweep from
    // coin-flipping a new gender that disagrees with the copied audio
    // rows and deletes them.
    speakerGender: text.speakerGender,
    audioSpeakerGender: text.audioSpeakerGender,
    register: text.register,
    addresseeNumber: text.addresseeNumber,
    addresseeGender: text.addresseeGender,
    addressesSomeone: text.addressesSomeone,
    referentGender: text.referentGender,
    tenseAspect: text.tenseAspect,
    sentenceType: text.sentenceType,
    literalFigurative: text.literalFigurative,
  });

  // Create translations rows for all non-source languages.
  // Sources travel with their values:
  //   - User-edited rows: tag as `'user-provided'`; carry no annotations.
  //   - Unchanged rows: copy `translatedText` + `translationSource` +
  //     every present annotation pair (romanization, IPA) so we don't
  //     lose the original tags on the logical-copy operation. The copy is
  //     of the SERVED revision: a card pinned to a superseded wording forks
  //     the wording the learner has been studying, not the live row.
  for (const lang of allLanguages) {
    if (lang === sourceLanguage) continue;
    const existing = servedTranslationMap.get(lang)?.row;
    const changed = changedLanguages.has(lang);
    const translatedText = changed
      ? canonicalizeApostrophes(lang, submittedMap.get(lang) ?? '')
      : (existing?.translatedText ?? '');
    // Never persist a blank row. `scheduleLanguageContent` treats any row as
    // "translation exists", and the stale-translation sweep never deletes a
    // row for being blank, so a blank insert would permanently block the
    // language and enqueue TTS for the empty string. Skipping the insert
    // lets the normal missing-translation path fill it like a new text.
    if (translatedText.trim() === '') continue;
    await ctx.db.insert('translations', {
      textId: newTextId,
      targetLanguage: lang,
      translatedText,
      ...(changed
        ? { translationSource: USER_PROVIDED_TRANSLATION_SOURCE }
        : existing?.translationSource
          ? { translationSource: existing.translationSource }
          : {}),
      ...(changed || !existing ? {} : carriedAnnotationFields(existing)),
      // Copy the prior row's speakerGender on the carry-over path so the
      // logical copy doesn't trigger a gender-mismatch regeneration on
      // the new text. For user-edited (changed) rows, stamp with the
      // new text's current gender (which copies `text.audioSpeakerGender`
      // a few lines above).
      ...(changed
        ? audioGenderStamp
          ? { speakerGender: audioGenderStamp }
          : {}
        : existing?.speakerGender
          ? { speakerGender: existing.speakerGender }
          : {}),
      // Carry the source row's translationVersion on the unchanged carry-over
      // branch so the logical copy is faithful (matching the audio copy and
      // the stamping done everywhere else). User-edited rows are tagged
      // user-provided and left unstamped (user-owned). Benign today since the
      // version sweep exempts userCreated + user-provided rows, but this keeps
      // the copy honest if those exemptions ever change.
      ...(!changed && existing?.translationVersion !== undefined
        ? { translationVersion: existing.translationVersion }
        : {}),
    });
  }

  // Copy audio recordings for languages whose audio is still valid.
  // Unchanged ones AND punctuation-only edits (audibly identical). A pinned
  // language points at the asset its archived revision recorded (the live
  // pointer now speaks the new wording); an archived revision without audio
  // gets none, and the fork's own ensure sweep fills it for the carried
  // wording.
  for (const lang of allLanguages) {
    if (audioChangedLanguages.has(lang)) continue;
    const served = servedTranslationMap.get(lang);
    if (served?.archived) {
      if (served.audioAssetId) {
        await ctx.db.insert('audioRecordings', {
          textId: newTextId,
          language: lang,
          assetId: served.audioAssetId,
        });
      }
      continue;
    }
    // The clip the card played for this slot. For the source slot of a
    // Mixed English card that is the accent row's clip, stored under the
    // copy's own language since the copy shows that wording as its text.
    const audioRows = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q
          .eq('textId', card.textId)
          .eq('language', rowLanguages.get(lang) ?? lang),
      )
      .take(20);
    for (const row of audioRows) {
      // The copy shares the same asset. Staleness (the asset's
      // ttsVersion stamp) travels with the asset itself.
      await ctx.db.insert('audioRecordings', {
        textId: newTextId,
        language: lang,
        assetId: row.assetId,
      });
    }
  }

  return newTextId;
}

/**
 * Point the card at the edited/forked text row and refresh its searchable
 * text via the aggregate-aware patch. Both paths leave the SAME card
 * document in place: Path A edited its existing text row, Path B forked the
 * shared text into a private copy and re-points the card at it (for Path A
 * `resolvedTextId` is the card's current `textId`, so that part of the
 * patch is a no-op). An edit used to REPLACE the card on Path B
 * (insert + delete), which demanded a hand-carried list of every progress
 * field, −1ms due-date tiebreak tricks to keep the queue position, an
 * alternatives migration, and sibling-approval retargeting — and still left
 * `reviewHistory.cardId` dangling. Patching in place keeps `_id`,
 * `_creationTime` and `dueDate`, so all of that machinery is unnecessary:
 * every by-id reference (accepted writing alternatives, pending approvals,
 * reviewHistory, the audit log, the undo stack) stays valid by construction.
 *
 * Returns the resolved text row (fetched after any metadata patch, so the
 * downstream `scheduleMissingContent` sees the final row).
 */
export async function repointCardAtEditedText(
  ctx: MutationCtx,
  params: {
    card: Doc<'cards'>;
    course: Doc<'courses'>;
    resolvedTextId: Id<'texts'>;
  },
): Promise<Doc<'texts'>> {
  const { card, course, resolvedTextId } = params;

  // Build searchable text for the new card
  const resolvedText = await ctx.db.get(resolvedTextId);
  if (!resolvedText)
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Resolved text not found',
    });

  const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
  // A user-owned text has no accent rows. Path B forks into one and Path A
  // edits one, so the card's accent is cleared with the repoint and the
  // search string holds the copy's own words.
  const { searchableText, searchableTextLanguages } =
    await buildCardSearchableText(ctx, resolvedTextId, courseLanguages, {
      text: resolvedText,
      view: { pinAt: cardPinAt(card) },
    });

  await patchCard(
    ctx,
    card._id,
    {
      textId: resolvedTextId,
      accentLanguage: undefined,
      searchableText,
      searchableTextLanguages,
      // Backfill defaults for cards predating these fields, applied on
      // edit as before.
      isGraduated: card.isGraduated ?? false,
      radioRoundCounter: card.radioRoundCounter ?? 0,
      radioOrderKey: card.radioOrderKey ?? randomOrderKey(),
      freeStudyRoundCounter: card.freeStudyRoundCounter ?? 0,
      freeStudyOrderKey: card.freeStudyOrderKey ?? randomOrderKey(),
    },
    card,
  );

  return resolvedText;
}

/**
 * Propagate the edit to derived data: re-link tracked words for the changed
 * languages and trigger TTS + romanization for the resolved text's gaps.
 */
export async function propagateEditToDerivedContent(
  ctx: MutationCtx,
  params: {
    userId: string;
    course: Doc<'courses'>;
    card: Doc<'cards'>;
    plan: CardEditPlan;
    resolvedTextId: Id<'texts'>;
    resolvedText: Doc<'texts'>;
  },
): Promise<void> {
  const { userId, course, card, plan, resolvedTextId, resolvedText } = params;
  const { changedLanguages, submittedMap } = plan;

  // Update word-text links for changed languages (only if words were previously tracked)
  if (card.wordsTrackedLanguages && card.wordsTrackedLanguages.length > 0) {
    const changedLangTexts: Array<{ language: string; text: string }> = [];
    for (const lang of changedLanguages) {
      const submitted = submittedMap.get(lang);
      if (submitted) changedLangTexts.push({ language: lang, text: submitted });
    }
    if (changedLangTexts.length > 0) {
      await updateWordTextsForEdit(ctx, {
        userId,
        courseId: course._id,
        textId: resolvedTextId,
        languages: changedLangTexts,
      });
    }
  }

  // Trigger TTS + romanization for changed languages, billed to the editor.
  await scheduleMissingContent(
    ctx,
    resolvedTextId,
    resolvedText,
    course.baseLanguages,
    course.targetLanguages,
    { requestedByUserId: userId },
  );
}
