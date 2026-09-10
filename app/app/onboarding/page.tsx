'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Authenticated,
  AuthLoading,
  useMutation,
  usePreloadedQuery,
  useQuery,
  useAction,
  useConvexAuth,
} from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAppData } from '@/components/app/AppDataProvider';
import { isLegacyFlowRow, resumeStepId, type StepId } from './lib/resumeStep';
import type {
  OnboardingData,
  CurrentLevel,
  ReviewMode,
  WritingInputMode,
  AcquisitionSource,
  LearningReason,
  PriorApp,
  DailyTimeGoalMinutes,
} from './types';
import type { PolitenessLevel } from '@/lib/languageForms';
import { EMPTY_ONBOARDING_DATA } from './types';
import { CURRENT_PLACEMENT_STRATEGY_VERSION } from './lib/placementStrategies';
import { OnboardingWizard, reportOnboardingFailure } from './OnboardingWizard';

/**
 * Onboarding wizard. Survey + placement only; learning starts for real the
 * moment it ends.
 *
 * Step / id / next:
 *   1.  language-pair         → politeness | acquisition
 *   1b. politeness            → acquisition (Japanese / Korean targets only;
 *                               every other target starts on every level)
 *   2.  acquisition           → prior-apps
 *   3.  prior-apps            → goal
 *   4.  goal                  → daily-time
 *   5.  daily-time            → proficiency
 *   6.  proficiency           → cefr-pick | placement-test | review-mode (depends on branch)
 *   7a. cefr-pick             → review-mode
 *   7b. placement-test        → review-mode
 *   8.  review-mode           → done: Continue runs `completeOnboarding`
 *                               (course + deck + seeded cards) then
 *                               `finalizeOnboarding`, and lands the user in
 *                               the REAL learning mode at /app/learn: no
 *                               filler screen, no embedded tutorial lesson
 *                               (the in-session milestone tips took that
 *                               job, see lib/tutorials/use-milestone-tips.ts),
 *                               no plan-pick step.
 *
 * Persisted step numbers follow PROGRESS_STEP_ORDER (append-only), the
 * walking order FLOW_ORDER; see lib/resumeStep.ts.
 *
 * `hasCompletedOnboarding` is the single source of truth for the auto-redirect
 * It stays false until `finalizeOnboarding`, so mid-flow reloads resume
 * from `onboardingProgress.step`.
 *
 * The wizard itself (state, step order, footer) lives in OnboardingWizard.tsx
 * so the local-only /dev/onboarding-preview route can render it without a
 * session.
 */

export default function OnboardingPage() {
  return (
    <>
      <AuthLoading>
        <div className="h-dvh" />
      </AuthLoading>
      <Authenticated>
        <OnboardingContent />
      </Authenticated>
    </>
  );
}

function OnboardingContent() {
  const router = useRouter();
  // Through AppDataProvider's SSR-seeded handle (B25; the onboarding page
  // renders inside app/app/layout.tsx's provider). Same getUserSettings
  // query key, so the finalize optimistic update below still reaches it.
  const { preloadedSettings } = useAppData();
  const userSettings = usePreloadedQuery(preloadedSettings);
  const onboardingProgress = useQuery(
    api.features.courses.getOnboardingProgress,
  );
  const saveProgress = useMutation(api.features.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(
    api.features.courses.completeOnboarding,
  );
  // `withOptimisticUpdate` flips `hasCompletedOnboarding` to `true` in the
  // local Convex cache the moment the wizard finishes, before the server
  // roundtrip and before `router.push('/app/learn')`. Without it, the
  // `OnboardingGuard` on `/app/*` would briefly see the still-`false`
  // preloaded value (Next.js doesn't re-execute server preloads on soft
  // navigation within the same `/app/*` segment) and bounce the user back
  // to `/app/onboarding` until the live subscription delivered the true
  // value. A visible flicker. The optimistic update makes the
  // post-finalize value visible synchronously to every consumer of
  // `getUserSettings`, including the layout-preloaded query.
  const finalizeOnboarding = useMutation(
    api.features.onboarding.finalizeOnboarding,
  ).withOptimisticUpdate((localStore) => {
    const current = localStore.getQuery(
      api.features.courses.getUserSettings,
      {},
    );
    if (current) {
      localStore.setQuery(
        api.features.courses.getUserSettings,
        {},
        { ...current, hasCompletedOnboarding: true },
      );
    }
  });
  const prepareLanguagePair = useMutation(
    api.features.onboarding.prepareLanguagePair,
  );
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const { isAuthenticated } = useConvexAuth();
  const syncedRef = useRef(false);
  // True while the wizard's own finish flow is driving navigation. It
  // targets /app/learn, and the generic already-onboarded bounce below must
  // not race it with a competing push to /app.
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;
    syncQuotas().catch((err) => {
      // Non-fatal, but it decides whether `completeOnboarding` can consume a
      // COURSES unit later. A failure here surfaces as an unexplained
      // USAGE_LIMIT at the final step, so it needs to be visible.
      reportOnboardingFailure(err, {
        op: 'onboarding.syncQuotas',
        step: 'mount',
        reason: 'sync_quotas_failed',
      });
    });
  }, [syncQuotas, isAuthenticated]);

  // Once `hasCompletedOnboarding` is true (set only by `finalizeOnboarding`,
  // the very last step of the wizard), bounce the user out. This is the
  // single source of truth, no session/local-storage gating.
  useEffect(() => {
    if (userSettings?.hasCompletedOnboarding && !finishingRef.current) {
      router.push('/app');
    }
  }, [userSettings, router]);

  // Graduate old-flow rows that are already past the embedded first lesson.
  // Those users have a course, a review mode, and a completed (or skipped)
  // first session; the only steps they hadn't finished are ones that no
  // longer exist. Walking them back into the wizard to re-pick a mode they
  // already chose is worse than just letting them in, so finalize and let
  // the effect above bounce them to the dashboard, where the home tour plays
  // once and Start Learning takes them into the session.
  //
  // `finalizeOnboarding` is idempotent (`alreadyFinalized`) and its
  // optimistic update flips `hasCompletedOnboarding` synchronously, which is
  // what drives that bounce. The ref keeps a re-render from firing it twice
  // before the mutation lands.
  const isLegacyGraduate =
    !!userSettings?.activeCourseId &&
    !userSettings.hasCompletedOnboarding &&
    !!onboardingProgress &&
    isLegacyFlowRow(onboardingProgress);
  // Set only when finalize fails. The user then falls back to the wizard
  // (resumed at the mode pick) instead of being stranded on a blank screen.
  const [graduationFailed, setGraduationFailed] = useState(false);
  const graduatedRef = useRef(false);
  useEffect(() => {
    if (!isLegacyGraduate || graduatedRef.current) return;
    graduatedRef.current = true;
    finalizeOnboarding().catch((err) => {
      setGraduationFailed(true);
      reportOnboardingFailure(err, {
        op: 'onboarding.finalizeOnboarding',
        step: 'legacy-graduation',
        reason: 'finalize_onboarding_failed',
        will_bounce_back: true,
      });
    });
  }, [isLegacyGraduate, finalizeOnboarding]);

  if (userSettings === undefined || onboardingProgress === undefined) {
    return <div className="h-dvh" />;
  }

  if (userSettings?.hasCompletedOnboarding) {
    return <div className="h-dvh" />;
  }

  // Graduating (see the effect above), hold a blank screen rather than
  // flashing the mode-pick step for the frame or two before the redirect.
  if (isLegacyGraduate && !graduationFailed) {
    return <div className="h-dvh" />;
  }

  // Rehydrate wizard state + resume step from `onboardingProgress`. Mid-flow
  // refreshes return to the same step the user left off on.
  const initialStepId: StepId = onboardingProgress?.step
    ? resumeStepId(onboardingProgress.step, onboardingProgress)
    : 'language-pair';
  const initialFlowData: OnboardingData = {
    ...EMPTY_ONBOARDING_DATA,
    ...(onboardingProgress
      ? {
          reviewMode: (onboardingProgress.reviewMode as ReviewMode) ?? null,
          writingInputMode:
            (onboardingProgress.writingInputMode as WritingInputMode) ?? null,
          targetLanguages: onboardingProgress.targetLanguages ?? [],
          baseLanguages: onboardingProgress.baseLanguages ?? [],
          currentLevel:
            (onboardingProgress.currentLevel as CurrentLevel) ?? null,
          acquisitionSource:
            (onboardingProgress.acquisitionSource as AcquisitionSource) ?? null,
          acquisitionSourceFreeText:
            onboardingProgress.acquisitionSourceFreeText ?? null,
          learningGoals:
            (onboardingProgress.learningGoals as
              | LearningReason[]
              | undefined) ?? [],
          learningGoalFreeText: onboardingProgress.learningGoalFreeText ?? null,
          priorApps: (onboardingProgress.priorApps as PriorApp[]) ?? [],
          priorAppsFreeText: onboardingProgress.priorAppsFreeText ?? null,
          dailyTimeGoalMinutes:
            (onboardingProgress.dailyTimeGoalMinutes as DailyTimeGoalMinutes) ??
            null,
          politenessLevels:
            (onboardingProgress.politenessLevels as PolitenessLevel[]) ?? [],
          placementTest:
            onboardingProgress.placementTest &&
            onboardingProgress.placementTest.strategyVersion ===
              CURRENT_PLACEMENT_STRATEGY_VERSION
              ? {
                  strategyVersion:
                    onboardingProgress.placementTest.strategyVersion,
                  strategy: onboardingProgress.placementTest.strategy,
                  history: onboardingProgress.placementTest.history,
                  finalLevel: onboardingProgress.placementTest.finalLevel,
                }
              : null,
        }
      : {}),
  };

  return (
    <OnboardingWizard
      initial={initialFlowData}
      initialStepId={initialStepId}
      saveProgress={saveProgress}
      completeOnboarding={completeOnboarding}
      finalizeOnboarding={finalizeOnboarding}
      prepareLanguagePair={prepareLanguagePair}
      finishingRef={finishingRef}
      router={router}
    />
  );
}
