import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getAuthUser, requireAuthUser } from "../db/users";
import { getActiveCourseForUser } from "../db/courses";
import { getInitialReviewCount } from "../db/courseSettings";
import { getDeckByCourseId } from "../db/decks";
import {
  scheduleCard,
  getValidRatings,
  type ReviewRating,
  type CardSchedulingState,
} from "../../lib/scheduling";
import { fsrsStateValidator, translationValidator, audioRecordingValidator } from "../types";

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get the next card due for review in the user's active deck.
 *
 * Returns the card with the earliest dueDate that is <= now and not hidden,
 * joined with its text, translations, and audio recordings.
 */
export const getCardForReview = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("cards"),
      _creationTime: v.number(),
      textId: v.id("texts"),
      sourceText: v.string(),
      sourceLanguage: v.string(),
      translations: v.array(translationValidator),
      audioRecordings: v.array(audioRecordingValidator),
      dueDate: v.number(),
      isMastered: v.boolean(),
      isHidden: v.boolean(),
      schedulingPhase: v.string(),
      preReviewCount: v.number(),
      initialReviewCount: v.number(),
      fsrsState: v.union(fsrsStateValidator, v.null()),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const active = await getActiveCourseForUser(ctx, user._id);
    if (!active) return null;
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return null;

    // Load initialReviewCount from the separate courseSettings table
    const initialReviewCount = await getInitialReviewCount(ctx, course._id);

    const now = Date.now();

    // Get the card with the earliest due date that is neither hidden nor mastered.
    const card = await ctx.db
      .query("cards")
      .withIndex("by_deckId_and_isHidden_and_isMastered_and_dueDate", (q) =>
        q.eq("deckId", deck._id).eq("isHidden", false).eq("isMastered", false).lte("dueDate", now)
      )
      .order("asc")
      .first();
    if (!card) return null;

    // Load text
    const text = await ctx.db.get(card.textId);
    if (!text) return null;

    const sourceLanguage = text.language;
    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    // Load translations
    const translations = await Promise.all(
      allLanguages.map(async (lang) => {
        let translatedText = "";
        if (lang === sourceLanguage) {
          translatedText = text.text;
        } else {
          const translation = await ctx.db
            .query("translations")
            .withIndex("by_text_and_language", (q) =>
              q.eq("textId", card.textId).eq("targetLanguage", lang)
            )
            .first();
          translatedText = translation?.translatedText || "";
        }
        return {
          language: lang,
          text: translatedText,
          isBaseLanguage: course.baseLanguages.includes(lang),
          isTargetLanguage: course.targetLanguages.includes(lang),
        };
      })
    );

    // Load audio
    const audioRecordings = await Promise.all(
      allLanguages.map(async (lang) => {
        const audio = await ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", card.textId).eq("language", lang)
          )
          .first();
        const url = audio?.storageId
          ? await ctx.storage.getUrl(audio.storageId)
          : null;
        return {
          language: lang,
          voiceName: audio?.voiceName ?? null,
          url,
        };
      })
    );

    return {
      _id: card._id,
      _creationTime: card._creationTime,
      textId: card.textId,
      sourceText: text.text,
      sourceLanguage,
      translations,
      audioRecordings,
      dueDate: card.dueDate,
      isMastered: card.isMastered,
      isHidden: card.isHidden,
      schedulingPhase: card.schedulingPhase,
      preReviewCount: card.preReviewCount,
      initialReviewCount,
      fsrsState: card.fsrsState ?? null,
    };
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Review a card with the given rating.
 *
 * Delegates to the shared `scheduleCard()` function from lib/scheduling.ts
 * and patches the card document with the new scheduling state.
 */
export const reviewCard = mutation({
  args: {
    cardId: v.id("cards"),
    rating: v.union(
      v.literal("stillLearning"),
      v.literal("understood"),
      v.literal("again"),
      v.literal("hard"),
      v.literal("good"),
      v.literal("easy"),
    ),
  },
  returns: v.object({
    schedulingPhase: v.string(),
    preReviewCount: v.number(),
    dueDate: v.number(),
    phaseTransitioned: v.boolean(),
    fsrsState: v.union(fsrsStateValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("Card not found");

    // Load initialReviewCount from courseSettings (not course)
    const deck = await ctx.db.get(card.deckId);
    if (!deck) throw new ConvexError("Deck not found");

    const initialReviewCount = await getInitialReviewCount(ctx, deck.courseId);

    // Validate rating is appropriate for the card's current phase
    const phase = card.schedulingPhase as "preReview" | "review";
    const validRatings = getValidRatings(phase);
    if (!validRatings.includes(args.rating)) {
      throw new ConvexError(
        `Invalid rating "${args.rating}" for ${phase} phase. Valid ratings: ${validRatings.join(", ")}`,
      );
    }

    // Build current scheduling state
    const cardState: CardSchedulingState = {
      schedulingPhase: phase,
      preReviewCount: card.preReviewCount,
      dueDate: card.dueDate,
      fsrsState: card.fsrsState ?? null,
    };

    // Run the shared scheduling algorithm
    const result = scheduleCard(
      cardState,
      args.rating,
      initialReviewCount,
    );

    // Patch the card
    await ctx.db.patch(args.cardId, {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: result.dueDate,
      ...(result.fsrsState && { fsrsState: result.fsrsState }),
    });

    return {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: result.dueDate,
      phaseTransitioned: result.phaseTransitioned,
      fsrsState: result.fsrsState,
    };
  },
});

