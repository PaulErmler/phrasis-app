'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useQueries, type RequestForQueries } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { TUTORIAL_IDS } from '@/convex/features/tutorialIds';
import { useCompletedTutorials } from '@/lib/tutorials/use-tutorial';
import { VETERAN_SUPPRESS_REPS } from '@/lib/tutorials/use-milestone-tips';

/**
 * Flip to true to show the one-time "Does the difficulty feel right?"
 * dialog before the first auto-add. Off for now; the dialog, hook, and
 * tutorial id stay in place so it can come back without a rebuild.
 */
const DIFFICULTY_CHECK_ENABLED = false;

/**
 * One-time difficulty check: before the FIRST batch of new cards is
 * auto-added, the learn view asks whether the difficulty feels right and
 * offers the level slider (with sentence previews) to move the course to a
 * different level collection.
 *
 * Show-once state rides the shared `completedTutorials` mechanism
 * (per-user: Convex `userSettings` + per-user localStorage cache), and the
 * same veteran rule as the milestone tips applies. A user whose lifetime
 * review count is already far past the beginner window has long since
 * settled on a difficulty, so the check is silently retired instead of
 * shown. That count spans every course the user has
 * (`getLifetimeReviewCount`), so opening a second course does not hand a
 * veteran a beginner's dialog.
 *
 * `pending` is the HOLD signal for `useLearningMode({ holdAutoAdd })`; the
 * dialog itself opens only when the hold actually intercepts an add
 * (`state.autoAddHeld`).
 *
 * The course's current level is resolved HERE rather than inside the dialog:
 * a course with no level collection (chat/custom, or a legacy CEFR
 * collection) has nothing for the pager to switch away from, so the check is
 * skipped entirely instead of opening a dialog whose only possible outcome is
 * "Keep". Resolving it up front also means the dialog never renders a
 * placeholder level before snapping to the real one. Not marked completed in
 * that case. A user who later moves onto a level collection still gets asked.
 */
export function useDifficultyCheck() {
  const { completed, markCompleted, isLoaded } = useCompletedTutorials(
    DIFFICULTY_CHECK_ENABLED ? [TUTORIAL_IDS.DIFFICULTY_CHECK] : [],
  );
  const done = completed.includes(TUTORIAL_IDS.DIFFICULTY_CHECK);

  // `useQueries`, not `useQuery`: a `useQuery` server error is THROWN into
  // render, and from here it unwound past LearnView's ViewErrorBoundary to
  // app/error.tsx, blanking the whole app shell over a check that only
  // decides whether to show a one-time dialog. Both reads are tiny (three
  // indexed documents between them), but the 1s query budget is wall-clock,
  // so a saturated backend times them out anyway; that limit is the same in
  // production and is not configurable on the local backend. `useQueries`
  // hands the error back as a VALUE instead, so a blip degrades to "not
  // known yet" and the live subscription recovers on its own.
  //
  // Memoised because `useQueriesHelper` keys its subscription on the
  // descriptor's identity. A fresh literal each render resubscribes both
  // queries every render.
  const queries = useMemo(() => {
    const q: RequestForQueries = {};
    if (DIFFICULTY_CHECK_ENABLED && !done) {
      q.lifetimeReps = {
        query: api.features.courses.getLifetimeReviewCount,
        args: {},
      };
      q.currentLevel = {
        query: api.features.decks.getActiveDifficultyLevel,
        args: {},
      };
    }
    return q;
  }, [done]);
  const results = useQueries(queries);
  // Both queries return `number | null`, so `typeof === 'number'` collapses
  // all three not-an-answer cases, still loading (`undefined`), genuinely
  // absent (`null`: no course, or a collection with no OGTE level), and
  // failed (`Error`), onto the same `null`. Every one of them means "don't
  // hold auto-add and don't open the dialog", and an Error must NOT count as
  // a veteran read either, or a timeout would silently retire the check.
  const lifetimeReps =
    typeof results.lifetimeReps === 'number' ? results.lifetimeReps : null;
  const currentLevel =
    typeof results.currentLevel === 'number' ? results.currentLevel : null;
  const isVeteran =
    lifetimeReps != null && lifetimeReps > VETERAN_SUPPRESS_REPS;

  useEffect(() => {
    if (!DIFFICULTY_CHECK_ENABLED || !isLoaded || !isVeteran || done) return;
    markCompleted(TUTORIAL_IDS.DIFFICULTY_CHECK, { captureEvent: false });
  }, [isLoaded, isVeteran, done, markCompleted]);

  const complete = useCallback(() => {
    markCompleted(TUTORIAL_IDS.DIFFICULTY_CHECK);
  }, [markCompleted]);

  return {
    /** Hold auto-add while true. The check still has to happen. Stays
     *  false until the per-user completion state has actually loaded, so a
     *  fresh device never blocks adds it shouldn't. */
    pending:
      DIFFICULTY_CHECK_ENABLED &&
      isLoaded &&
      !done &&
      lifetimeReps != null &&
      !isVeteran &&
      currentLevel != null,
    /** The course's OGTE level, non-null whenever `pending` is true. */
    currentLevel: currentLevel ?? null,
    /** Mark the check done (keep or switch, either way it never re-asks). */
    complete,
  };
}
