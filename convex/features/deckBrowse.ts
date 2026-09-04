import { cardPinAt, liveTranslation } from '../db/translationReads';
import { QueryCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { getAuthUserId, getUserSettings } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import { getDeckByCourseId } from '../db/decks';
import {
  getActiveDataset,
  getCollectionProgress as getCollectionProgressHelper,
  getNextTextsFromRank,
  getPremadeLevelCollections,
  hasPendingCustomCardsToAdd,
} from '../db/collections';
import {
  ogteLevelToCollectionCode,
  collectionCodeToOgteLevel,
} from '../../lib/constants/onboarding';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import {
  LEGACY_LEVEL_ORDER,
  effectiveTextCount,
  isCollectionComplete,
} from '../lib/collections';
import type { Infer } from 'convex/values';
import type { translationValidator, audioRecordingValidator } from '../types';

/**
 * Deck/collection browse queries: the deck-card listing with assembled
 * content, per-collection progress for the levels screen, and the
 * difficulty-check dialog's level/preview reads. The registered queries stay
 * in features/decks.ts and delegate here.
 */

type Translation = Infer<typeof translationValidator>;
type AudioRecording = Infer<typeof audioRecordingValidator>;

/** Handler body of `getDeckCards`. */
export async function getDeckCardsHandler(
  ctx: QueryCtx,
  args: { limit?: number },
): Promise<
  {
    _id: Id<'cards'>;
    _creationTime: number;
    textId: Id<'texts'>;
    sourceText: string;
    sourceLanguage: string;
    translations: Translation[];
    audioRecordings: AudioRecording[];
    dueDate: number;
    isMastered: boolean;
    isHidden: boolean;
    isFavorite: boolean;
    hasMissingContent: boolean;
    audioSpeedOverrides?: Record<string, number>;
  }[]
> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return [];
  const { course } = active;

  const deck = await getDeckByCourseId(ctx, course._id);
  if (!deck) return [];

  const maxCards = args.limit ?? 20;
  const cards = await ctx.db
    .query('cards')
    .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
    .take(maxCards);

  const texts = await Promise.all(cards.map((c) => ctx.db.get(c.textId)));

  const inputs = cards
    .map((card, i) => {
      const text = texts[i];
      if (!text) return null;
      return {
        key: String(i),
        textId: card.textId,
        sourceText: text.text,
        sourceLanguage: text.language,
        sourceRomanization: text.romanizedText ?? undefined,
        sourceIpa: text.ipaText ?? undefined,
        sourceFurigana: text.furiganaText ?? undefined,
        userCreated: text.userCreated,
        pinAt: cardPinAt(card),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const contentMap = await buildTextContentBatchForLanguages(
    ctx,
    inputs,
    course.baseLanguages,
    course.targetLanguages,
  );

  const result = cards.map((card, i) => {
    const text = texts[i];
    if (!text) return null;
    const content = contentMap.get(String(i));
    if (!content) return null;

    return {
      _id: card._id,
      _creationTime: card._creationTime,
      textId: card.textId,
      sourceText: text.text,
      sourceLanguage: text.language,
      translations: content.translations,
      audioRecordings: content.audioRecordings,
      dueDate: card.dueDate,
      isMastered: card.isMastered,
      isHidden: card.isHidden,
      isFavorite: card.isFavorite ?? false,
      hasMissingContent: content.hasMissingContent,
      audioSpeedOverrides: card.audioSpeedOverrides,
    };
  });

  return result.filter(
    (card): card is NonNullable<typeof card> => card !== null,
  );
}

/** Handler body of `getCollectionProgress`. */
export async function getCollectionProgressQueryHandler(ctx: QueryCtx): Promise<
  {
    collectionId: Id<'collections'>;
    collectionName: string;
    cardsAdded: number;
    ignoredCount: number;
    prioritizedCount: number;
    totalTexts: number;
    order?: number;
  }[]
> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  const settings = await getUserSettings(ctx, userId);
  if (!settings?.activeCourseId) return [];

  const courseId = settings.activeCourseId;

  // Fetch only the premade rows actually displayed: the active dataset's ~20
  // collections (one indexed scan) or the seven legacy CEFR rows by name.
  // See getPremadeLevelCollections for the read pattern.
  const { collections } = await getPremadeLevelCollections(ctx);

  const result = await Promise.all(
    collections.map(async (collection) => {
      const progress = await getCollectionProgressHelper(
        ctx,
        userId,
        courseId,
        collection._id,
      );

      return {
        collectionId: collection._id,
        collectionName: collection.name,
        cardsAdded: progress?.cardsAdded ?? 0,
        ignoredCount: progress?.ignoredCount ?? 0,
        prioritizedCount: progress?.prioritizedCount ?? 0,
        // Carry-widened, exactly like getHomeSummary: `cardsAdded` already
        // contains the cutover credit, so the raw textCount would make
        // `collectionRemaining` read 0 on a level that still has texts.
        totalTexts: effectiveTextCount(collection.textCount, progress),
        order: collection.order,
      };
    }),
  );

  // Sort by `order` when present (new dataset), else by legacy CEFR position.
  // Items with `order` set always sort before legacy items to keep new
  // dataset on top once it's loaded.
  const legacyPosition = (name: string) => {
    const idx = LEGACY_LEVEL_ORDER.indexOf(
      name as (typeof LEGACY_LEVEL_ORDER)[number],
    );
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  result.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined)
      return a.order - b.order;
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return legacyPosition(a.collectionName) - legacyPosition(b.collectionName);
  });

  return result;
}

/**
 * Handler body of `hasPendingCustomCards`.
 *
 * The learn view's answer to "can auto-add still produce a card without
 * credits?". Custom/chat texts cost no `SENTENCES` quota, so with this true
 * the view keeps auto-adding (and keeps showing the seamless loading state)
 * on an empty balance instead of dropping to the no-cards-due screen.
 *
 * Cheap by construction: one doc + one progress row per selected custom
 * collection, and users have a handful at most.
 */
export async function hasPendingCustomCardsHandler(
  ctx: QueryCtx,
): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return false;
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return false;
  const settings = await getCourseSettings(ctx, active.course._id);
  // The 'course' filter makes the add path set `skipCustomSources`, so pending
  // custom texts cannot produce a card no matter how many are waiting. Saying
  // yes here would keep the view on its seamless-loading state for a run that
  // adds nothing (see `addCardsHandler`'s `skipCustomSources`).
  if ((settings?.studyContentFilter ?? 'both') === 'course') return false;
  return hasPendingCustomCardsToAdd(
    ctx,
    userId,
    active.course._id,
    settings?.activeCustomCollectionIds,
  );
}

/** Handler body of `getActiveDifficultyLevel`. */
export async function getActiveDifficultyLevelHandler(
  ctx: QueryCtx,
): Promise<number | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return null;
  const settings = await getCourseSettings(ctx, active.course._id);
  if (!settings?.activeCollectionId) return null;
  const collection = await ctx.db.get(settings.activeCollectionId);
  return collectionCodeToOgteLevel(collection?.code);
}

/** Handler body of `getUpcomingSentencesForLevel`. */
export async function getUpcomingSentencesForLevelHandler(
  ctx: QueryCtx,
  args: { ogteLevel: number; count?: number },
): Promise<{
  exists: boolean;
  switchable: boolean;
  sentences: {
    position: number;
    sourceText: string;
    targetText?: string;
    targetRomanization?: string;
  }[];
}> {
  const MISSING = { exists: false, switchable: false, sentences: [] };

  const userId = await getAuthUserId(ctx);
  if (!userId) return MISSING;
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return MISSING;
  const course = active.course;

  const code = ogteLevelToCollectionCode(args.ogteLevel);
  if (!code) return MISSING;
  const activeDataset = await getActiveDataset(ctx);
  if (!activeDataset) return MISSING;
  const collection = await ctx.db
    .query('collections')
    .withIndex('by_datasetId_and_code', (q) =>
      q.eq('datasetId', activeDataset._id).eq('code', code),
    )
    .first();
  if (!collection) return MISSING;

  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    course._id,
    collection._id,
  );

  // Mirror `setActiveCollectionByLevel`'s guard so the UI can't offer a
  // step the mutation would reject. The already-active level stays
  // switchable, selecting it is a no-op there, not an error.
  const courseSettings = await getCourseSettings(ctx, course._id);
  const isActiveLevel = courseSettings?.activeCollectionId === collection._id;
  const isComplete =
    progress != null &&
    effectiveTextCount(collection.textCount, progress) > 0 &&
    isCollectionComplete(collection.textCount, progress);
  const switchable = isActiveLevel || !isComplete;

  const frontier = progress?.lastRankProcessed ?? 0;
  const count = Math.min(Math.max(args.count ?? 5, 1), 10);
  const texts = await getNextTextsFromRank(
    ctx,
    collection._id,
    frontier,
    count,
    {
      onlyCurriculum: true,
    },
  );

  const sourceLanguage = course.baseLanguages[0];
  const targetLanguage = course.targetLanguages[0];
  const sentences = await Promise.all(
    texts.map(async (text, position) => {
      let sourceText = text.text;
      if (sourceLanguage && sourceLanguage !== text.language) {
        const sourceTranslation = await liveTranslation(
          ctx,
          text._id,
          sourceLanguage,
        );
        if (sourceTranslation) sourceText = sourceTranslation.translatedText;
      }

      let targetText: string | undefined;
      let targetRomanization: string | undefined;
      if (targetLanguage && targetLanguage !== text.language) {
        const targetTranslation = await liveTranslation(
          ctx,
          text._id,
          targetLanguage,
        );
        if (targetTranslation) {
          targetText = targetTranslation.translatedText;
          // Empty string is the "tried and failed" romanization sentinel.
          targetRomanization = targetTranslation.romanizedText || undefined;
        }
      } else if (targetLanguage && targetLanguage === text.language) {
        targetText = text.text;
        targetRomanization = text.romanizedText || undefined;
      }

      return { position, sourceText, targetText, targetRomanization };
    }),
  );

  return { exists: true, switchable, sentences };
}
