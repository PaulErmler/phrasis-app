'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import type { TranslateFn } from '@/lib/tutorials/types';

/**
 * Onboarding-lesson tutorial driver.
 *
 * Fires several driver.js tutorials over the course of the embedded
 * first lesson, gated by how many cards the user has rated:
 *
 *   1. **Core** — fires on mount for the active review mode.
 *      Welcome → card → reveal (audio) / input (full) → audio controls
 *      (audio only) → rating → autoAdd → audioPlay (audio only).
 *
 *   2. **Mode switch** — fires if the user toggles the review mode via
 *      the header *after* the core tutorial has already taught the
 *      previous mode. Slim diff: welcome-for-new-mode + only the steps
 *      that actually change between modes (reveal/audioControls/audioPlay
 *      vs. input, plus the mode-specific rating description). Skipped
 *      entirely if the user switches back to a mode we've already taught.
 *
 *   3. **Card options** — fires once `cardsRated === 1` (i.e. on the
 *      second card surfacing). Auto-opens the `CardActionsMenu` so the
 *      kebab dropdown is visible while the popover explains it.
 *
 *   4. **Word-tap** — fires once `cardsRated === 3`. Highlights the
 *      longest target-language word.
 *
 *   5. **Chat** — fires once `cardsRated === 6`. Split off from word-tap
 *      so the two popovers don't pile up on small screens.
 *
 * Driver.js handles overlay dimming (header included), highlight rect,
 * auto-positioning, and keyboard nav reliably across mobile + desktop.
 *
 * All copy is supplied via the `t` translator (rooted at the
 * `OnboardingTutorial` namespace) so the tutorial is fully localizable.
 */

export interface OnboardingTutorialOptions {
  t: TranslateFn;
  reviewMode: 'audio' | 'full';
  /** Writing style is Transcribe (type what you hear) — swaps the full-mode
   *  card/input coachmark copy. */
  transcribe?: boolean;
  /** Card count — used to gate the staged tutorials. */
  cardsRated: number;
  /** Pause audio whenever a tutorial step appears so the spoken card audio
   *  doesn't compete with the popover. */
  onStepShow?: () => void;
  /** Fires the first time the core stage's driver finishes (user closed,
   *  finished, or navigated away). The parent uses this to release the
   *  autoplay gate — audio stays silent during the walkthrough. */
  onCoreComplete?: () => void;
  /** Fires `true` when any driver mounts and `false` when it tears down.
   *  Parent uses this to keep audio paused for the lifetime of staged
   *  popovers (card-actions, word-tap) — not just the core stage. */
  onActiveChange?: (active: boolean) => void;
  /** Fires synchronously inside the click that dismisses a popover — and
   *  ONLY for user dismissals, never for programmatic teardowns (stage
   *  replacement, effect cleanup). Use for work that must keep the user
   *  gesture, e.g. starting the detached card audio (iOS refuses
   *  `.play()` outside a gesture on an element that has never played). */
  onUserDismiss?: () => void;
}

type Stage = 'core' | 'mode-switch' | 'card-actions' | 'word-tap' | 'chat';

const CARDS_FOR_CARD_ACTIONS = 1; // i.e. on the second card
const CARDS_FOR_WORD_TAP = 3;
// Chat splits off `word-tap` and fires three reviews later so the two
// popovers don't pile on top of each other on small screens.
const CARDS_FOR_CHAT = CARDS_FOR_WORD_TAP + 3;

// Anchors each staged tutorial highlights — shared between the settle wait
// below and the step builders so the two can never drift apart.
const CARD_ACTIONS_SELECTOR = '[data-coachmark-anchor="card-actions"]';
const WORD_TAP_SELECTOR = '[data-coachmark-anchor="word-tap"]';
const CHAT_SELECTOR =
  '[data-coachmark-anchor="chat-button-desktop"], [data-tutorial="chat-button"]';

/**
 * Invoke `onSettled` once `selector` resolves to a visible, attached element
 * whose rect has stopped moving (identical across `stableFrames` consecutive
 * frames). The staged tutorials fire right after a rating, which also kicks
 * off the AnimatePresence card swap (~150ms exit + ~150ms enter) — and
 * driver.js draws its highlight exactly once, so a rect measured mid
 * slide-in leaves the stage sitting where the element USED to be, or on the
 * outgoing card's copy that unmounts a frame later. `minDelayMs` keeps the
 * previous 350ms floor so the check can't latch onto the outgoing card
 * while it's still stationary pre-exit; `timeoutMs` guarantees the popover
 * always mounts even if the element never shows up (runStage then falls
 * back to a centered modal, as before).
 */
function whenElementSettled(
  selector: string,
  onSettled: () => void,
  { minDelayMs = 350, timeoutMs = 2000, stableFrames = 3 } = {},
): void {
  const startedAt = performance.now();
  let lastEl: Element | null = null;
  let lastRect: DOMRect | null = null;
  let stableCount = 0;
  const tick = () => {
    const elapsed = performance.now() - startedAt;
    if (elapsed >= timeoutMs) {
      onSettled();
      return;
    }
    if (elapsed >= minDelayMs) {
      let el: Element | null = null;
      let rect: DOMRect | null = null;
      for (const candidate of document.querySelectorAll(selector)) {
        const r = candidate.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          el = candidate;
          rect = r;
          break;
        }
      }
      const isStable =
        el !== null &&
        el === lastEl &&
        el.isConnected &&
        rect !== null &&
        lastRect !== null &&
        Math.abs(rect.top - lastRect.top) < 0.5 &&
        Math.abs(rect.left - lastRect.left) < 0.5 &&
        Math.abs(rect.width - lastRect.width) < 0.5 &&
        Math.abs(rect.height - lastRect.height) < 0.5;
      stableCount = isStable ? stableCount + 1 : 0;
      if (stableCount >= stableFrames) {
        onSettled();
        return;
      }
      lastEl = el;
      lastRect = rect;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function useOnboardingLessonTutorial({
  t,
  reviewMode,
  transcribe = false,
  cardsRated,
  onStepShow,
  onCoreComplete,
  onActiveChange,
  onUserDismiss,
}: OnboardingTutorialOptions) {
  const activeDriverRef = useRef<Driver | null>(null);
  const firedStagesRef = useRef<Set<Stage>>(new Set());
  const coreCompleteFiredRef = useRef(false);
  // Modes whose core/mode-switch driver has actually mounted. Used to gate
  // the core effect on mode changes: the first time a mode is taught, run
  // the full `buildCoreSteps` walkthrough; on a subsequent switch to the
  // *other* mode, only run `buildModeSwitchSteps` (the diff) so the user
  // doesn't see the entire welcome/card/auto-add chrome again.
  const seenCoreModesRef = useRef<Set<'audio' | 'full'>>(new Set());
  // One-shot seed: if the user has already rated cards before this mount
  // (e.g. they aborted mid-lesson and clicked Start again, or reloaded
  // the page mid-lesson), they have already seen every tutorial that
  // their prior rating count would have unlocked. Pre-fill the
  // bookkeeping sets so we don't re-fire them. Runs once at first render
  // — subsequent `cardsRated` bumps shouldn't re-seed.
  const didSeedFiredStagesRef = useRef(false);
  if (!didSeedFiredStagesRef.current) {
    didSeedFiredStagesRef.current = true;
    if (cardsRated >= CARDS_FOR_CARD_ACTIONS) firedStagesRef.current.add('card-actions');
    if (cardsRated >= CARDS_FOR_WORD_TAP) firedStagesRef.current.add('word-tap');
    if (cardsRated >= CARDS_FOR_CHAT) firedStagesRef.current.add('chat');
    // Prior cards rated ⇒ the user has already dismissed the welcome /
    // core walkthrough. Mark both modes as seen so neither the core nor
    // the mode-switch diff fires on resume, regardless of which mode the
    // user is currently in.
    if (cardsRated > 0) {
      seenCoreModesRef.current.add('audio');
      seenCoreModesRef.current.add('full');
      // The core "completed" callback should also not re-fire — the
      // parent already released the autoplay gate on the first run.
      coreCompleteFiredRef.current = true;
    }
  }
  const onStepShowRef = useRef(onStepShow);
  const onCoreCompleteRef = useRef(onCoreComplete);
  const onActiveChangeRef = useRef(onActiveChange);
  const onUserDismissRef = useRef(onUserDismiss);
  useEffect(() => {
    onStepShowRef.current = onStepShow;
    onCoreCompleteRef.current = onCoreComplete;
    onActiveChangeRef.current = onActiveChange;
    onUserDismissRef.current = onUserDismiss;
  });

  // Hold the translator in a ref so the effects below stay stable across
  // renders even though `t` from `useTranslations` may be a fresh function
  // each render in some next-intl versions.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  // Same for the writing style: read at drive time, but never re-fire the
  // core walkthrough just because the style setting changed mid-lesson.
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  // `onDestroyStarted` fires for programmatic destroys too (stage
  // replacement, effect cleanup) — this flag lets it tell those apart from
  // a real user dismissal so `onUserDismiss` never fires without a gesture.
  // Torn down via the module-level `teardownActiveDriver(refs)` so the
  // functions below keep a refs-only closure (stable for exhaustive-deps).
  const programmaticTeardownRef = useRef(false);

  const runStage = (
    stage: Stage,
    steps: DriveStep[],
    opts?: { animate?: boolean },
  ) => {
    // NOTE: the `firedStagesRef` claim is made by the caller (the staged
    // effect below) before scheduling — so by the time we get here the
    // stage is already marked. We re-add defensively in case `runStage` is
    // ever called outside that pattern (e.g. the core stage on mount).
    firedStagesRef.current.add(stage);

    // Tear down any in-flight driver before mounting the next.
    teardownActiveDriver(activeDriverRef, programmaticTeardownRef);

    const resolved: DriveStep[] = steps.map((step) => {
      if (typeof step.element !== 'string') return step;
      const candidates = document.querySelectorAll<HTMLElement>(step.element);
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { ...step, element: el };
        }
      }
      return { ...step, element: undefined };
    });

    const d = driver({
      animate: opts?.animate ?? true,
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      overlayColor: '#000',
      overlayOpacity: 0.5,
      stagePadding: 8,
      stageRadius: 8,
      popoverClass: `phrasis-tutorial-onboarding-${stage}`,
      steps: resolved,
      onHighlightStarted: () => {
        onStepShowRef.current?.();
      },
      onDestroyStarted: () => {
        if (stage === 'core' && !coreCompleteFiredRef.current) {
          coreCompleteFiredRef.current = true;
          onCoreCompleteRef.current?.();
        }
        activeDriverRef.current = null;
        onActiveChangeRef.current?.(false);
        // Still inside the dismissing click's call stack — the one place
        // gesture-bound work (starting the card audio) can run on iOS.
        if (!programmaticTeardownRef.current) {
          onUserDismissRef.current?.();
        }
        d.destroy();
      },
    });
    activeDriverRef.current = d;
    // Fire BOTH the active-change AND the step-show callback before driver
    // animates in. `onStepShow` (pauseAllAudio) used to rely on driver's
    // `onHighlightStarted`, which doesn't fire reliably with
    // `animate: false` and races with the menu-open animation. Calling it
    // synchronously here guarantees the audio stops the instant the
    // popover is committed.
    onActiveChangeRef.current?.(true);
    onStepShowRef.current?.();
    d.drive();
  };

  // Core tutorial — runs once per mode the user actually visits. On the
  // first mount it runs the full walkthrough for the active mode. If the
  // user then switches the review mode mid-lesson via the header, this
  // effect re-runs: we already taught the prior mode (it's in
  // `seenCoreModesRef`), so we run the slim `mode-switch` diff instead.
  // Switching *back* to a mode we've already taught is a no-op.
  useEffect(() => {
    const teachingMode = reviewMode;
    if (seenCoreModesRef.current.has(teachingMode)) return;
    const isModeSwitch = seenCoreModesRef.current.size > 0;
    // Flip `tutorialActive` true synchronously so the audio-blocking
    // effect installs its `play` listener for the full 600ms scheduling
    // window — otherwise card audio can fire up before the driver mounts.
    // For the very first core stage `tutorialActive` doesn't matter
    // because `coreTutorialDone` is still false (which also blocks
    // audio), but for the `mode-switch` stage there's no `core`-gate
    // anymore so this is load-bearing.
    onActiveChangeRef.current?.(true);
    pauseAllAudioNow();
    const timer = setTimeout(() => {
      // Mark seen the instant we actually mount the driver — not at
      // schedule time — so a fast back-and-forth toggle within the 600ms
      // window can still re-pick the original walkthrough.
      seenCoreModesRef.current.add(teachingMode);
      if (isModeSwitch) {
        runStage(
          'mode-switch',
          buildModeSwitchSteps(tRef.current, teachingMode, transcribeRef.current),
        );
      } else {
        runStage(
          'core',
          buildCoreSteps(tRef.current, teachingMode, transcribeRef.current),
        );
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      teardownActiveDriver(activeDriverRef, programmaticTeardownRef);
    };
  }, [reviewMode]);

  // Staged tutorials — fire based on card-count thresholds. Each stage
  // pauses audio synchronously, then waits for its anchor element to exist
  // AND stop moving (the card swap animation must finish — see
  // `whenElementSettled`) before mounting driver.js, so the highlight is
  // drawn at the element's final position instead of mid slide-in.
  //
  // CRITICAL: claim the stage in `firedStagesRef` BEFORE the settle wait
  // returns, otherwise an effect re-run during that window (the next
  // card rating bumps `cardsRated` again) would see the stage as unfired,
  // re-enter the branch, and skip ahead — leaving the popover unmounted
  // forever. Don't cancel the wait either; once claimed the schedule is
  // committed and the callback must fire.
  useEffect(() => {
    if (cardsRated >= CARDS_FOR_CARD_ACTIONS && !firedStagesRef.current.has('card-actions')) {
      firedStagesRef.current.add('card-actions');
      // Flip `tutorialActive` to true synchronously so the audio
      // play-blocker in `OnboardingFirstLesson` is installed BEFORE the
      // scheduling delay — without this, audio could (re)start during
      // that window because the gate is still open.
      onActiveChangeRef.current?.(true);
      pauseAllAudioNow();
      whenElementSettled(CARD_ACTIONS_SELECTOR, () => {
        // Highlight the kebab button only — the popover points at it but
        // does NOT auto-open the dropdown menu. Previously we opened it
        // automatically; that surprised users who wanted to read the
        // explanation, then tap the kebab themselves.
        runStage('card-actions', buildCardActionsSteps(tRef.current), { animate: false });
      });
    }
    if (cardsRated >= CARDS_FOR_WORD_TAP && !firedStagesRef.current.has('word-tap')) {
      firedStagesRef.current.add('word-tap');
      onActiveChangeRef.current?.(true);
      pauseAllAudioNow();
      whenElementSettled(WORD_TAP_SELECTOR, () => {
        runStage('word-tap', buildWordTapSteps(tRef.current));
      });
    }
    if (cardsRated >= CARDS_FOR_CHAT && !firedStagesRef.current.has('chat')) {
      firedStagesRef.current.add('chat');
      onActiveChangeRef.current?.(true);
      pauseAllAudioNow();
      whenElementSettled(CHAT_SELECTOR, () => {
        runStage('chat', buildChatSteps(tRef.current));
      });
    }
  }, [cardsRated]);
}

/** Destroy the in-flight driver (if any) with the programmatic-teardown
 *  flag raised, so `onDestroyStarted` can tell this apart from a user
 *  dismissal and skip the gesture-bound `onUserDismiss` work. */
function teardownActiveDriver(
  activeDriverRef: RefObject<Driver | null>,
  programmaticTeardownRef: RefObject<boolean>,
): void {
  if (!activeDriverRef.current) return;
  programmaticTeardownRef.current = true;
  try {
    activeDriverRef.current.destroy();
  } finally {
    programmaticTeardownRef.current = false;
  }
  activeDriverRef.current = null;
}

/** Pause any playing `<audio>`/`<video>` immediately. Used inside the
 *  staged-tutorial effect so audio stops the moment we decide a stage
 *  will fire, not 350ms later when driver.js finally mounts. */
function pauseAllAudioNow(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
    if (!el.paused) el.pause();
  });
}

// ─── Step builders (exported for testing) ───────────────────────────────────

/** Steps shared verbatim between `buildCoreSteps` and `buildModeSwitchSteps`
 *  — the reveal/input/audio/rating steps (including the mode-specific rating
 *  copy) are identical in both walkthroughs, so they're built once here and
 *  destructured by each builder. */
function buildSharedModeSteps(
  t: TranslateFn,
  reviewMode: 'audio' | 'full',
  transcribe: boolean,
): {
  reveal: DriveStep;
  input: DriveStep;
  audioControls: DriveStep;
  audioPlay: DriveStep;
  rating: DriveStep;
} {
  // Full review shows Again/Hard/Good/Easy from the very first card, while
  // audio review starts in the 2-button "still learning / understood"
  // warm-up. The rating-step copy differs accordingly.
  const ratingKey = reviewMode === 'full'
    ? 'core.rating.descriptionFull'
    : 'core.rating.descriptionAudio';
  const ratingDescription = t.markup
    ? t.markup(ratingKey, {
      strong: (chunks: string) => `<strong>${chunks}</strong>`,
    })
    : t(ratingKey);

  const reveal: DriveStep = {
    element: '[data-tutorial="target-text-audio"]',
    popover: {
      title: t('core.reveal.title'),
      description: t('core.reveal.description'),
      side: 'bottom',
      align: 'center',
    },
  };
  const inputKey = transcribe ? 'core.inputTranscribe' : 'core.input';
  const input: DriveStep = {
    element: '[data-tutorial="target-input-and-submit"]',
    popover: {
      title: t(`${inputKey}.title`),
      description: t(`${inputKey}.description`),
      side: 'top',
      align: 'center',
    },
  };
  const audioControls: DriveStep = {
    element: '[data-tutorial="audio-controls"]',
    popover: {
      title: t('core.audioControls.title'),
      description: t('core.audioControls.description'),
      side: 'top',
      align: 'center',
    },
  };
  const audioPlay: DriveStep = {
    element: '[data-tutorial="audio-play"]',
    popover: {
      title: t('core.audioPlay.title'),
      description: t('core.audioPlay.description'),
      side: 'top',
      align: 'center',
    },
  };
  const rating: DriveStep = {
    element: '[data-tutorial="rating-buttons"]',
    popover: {
      title: t('core.rating.title'),
      description: ratingDescription,
      side: 'top',
      align: 'center',
    },
  };

  return { reveal, input, audioControls, audioPlay, rating };
}

export function buildCoreSteps(
  t: TranslateFn,
  reviewMode: 'audio' | 'full',
  transcribe = false,
): DriveStep[] {
  const { reveal, input, audioControls, audioPlay, rating } =
    buildSharedModeSteps(t, reviewMode, transcribe);

  const welcome: DriveStep = {
    popover: {
      title: reviewMode === 'full' ? t('core.welcomeFull.title') : t('core.welcomeAudio.title'),
      description:
        reviewMode === 'full'
          ? t('core.welcomeFull.description')
          : t('core.welcomeAudio.description'),
    },
  };
  const card: DriveStep = {
    element: '[data-tutorial="card-flashcard"]',
    popover: {
      title: t('core.card.title'),
      description:
        reviewMode === 'full'
          ? t(
            transcribe
              ? 'core.card.descriptionFullTranscribe'
              : 'core.card.descriptionFull',
          )
          : t('core.card.descriptionAudio'),
      side: 'bottom',
      align: 'center',
    },
  };
  // Auto-add explanation — no element to anchor to (the user doesn't see
  // "auto-add" in the UI; it's a background behaviour). Without an
  // element, driver.js renders the popover as a centered modal.
  const autoAdd: DriveStep = {
    popover: {
      title: t('core.autoAdd.title'),
      description: t('core.autoAdd.description'),
    },
  };

  return reviewMode === 'full'
    ? [welcome, card, input, rating, autoAdd]
    : [welcome, card, reveal, audioControls, rating, autoAdd, audioPlay];
}

/** Slim diff walkthrough shown when the user switches review modes during
 *  the embedded first lesson. Skips welcome chrome, the card overview, and
 *  auto-add (all of which the user already saw in the original core stage)
 *  and only highlights the elements + rating semantics that actually change
 *  between modes. */
export function buildModeSwitchSteps(
  t: TranslateFn,
  reviewMode: 'audio' | 'full',
  transcribe = false,
): DriveStep[] {
  const { reveal, input, audioControls, audioPlay, rating } =
    buildSharedModeSteps(t, reviewMode, transcribe);

  const welcome: DriveStep = {
    popover: {
      title: reviewMode === 'full'
        ? t('modeSwitch.full.welcome.title')
        : t('modeSwitch.audio.welcome.title'),
      description: reviewMode === 'full'
        ? t('modeSwitch.full.welcome.description')
        : t('modeSwitch.audio.welcome.description'),
    },
  };

  return reviewMode === 'full'
    ? [welcome, input, rating]
    : [welcome, reveal, audioControls, rating, audioPlay];
}

export function buildCardActionsSteps(t: TranslateFn): DriveStep[] {
  return [
    {
      element: CARD_ACTIONS_SELECTOR,
      popover: {
        title: t('cardActions.title'),
        description: t('cardActions.description'),
        side: 'bottom',
        align: 'end',
      },
    },
  ];
}

export function buildWordTapSteps(t: TranslateFn): DriveStep[] {
  return [
    {
      element: WORD_TAP_SELECTOR,
      popover: {
        title: t('wordTap.title'),
        description: t('wordTap.description'),
        side: 'bottom',
        align: 'center',
      },
    },
  ];
}

export function buildChatSteps(t: TranslateFn): DriveStep[] {
  return [
    {
      element: CHAT_SELECTOR,
      popover: {
        title: t('chat.title'),
        description: t('chat.description'),
        side: 'left',
        align: 'center',
      },
    },
  ];
}

