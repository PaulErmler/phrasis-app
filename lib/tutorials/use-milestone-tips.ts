'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { useQueries, type RequestForQueries } from 'convex/react';
import { driver, type Driver, type DriveStep, type Side } from 'driver.js';
import { api } from '@/convex/_generated/api';
import { TUTORIAL_IDS, type TutorialId } from '@/convex/features/tutorialIds';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import {
  useCompletedTutorials,
  getCompletedTutorialsSnapshot,
} from './use-tutorial';
import {
  baseDriverConfig,
  bindTourKeyboard,
  resolveStepAnchors,
} from './driver-common';
import {
  COACHMARK_ANCHORS,
  TUTORIAL_ANCHORS,
  coachmarkSelector,
  tutorialSelector,
} from './anchors';
import type { TranslateFn } from './types';

/**
 * One-time tips inside the real learning mode. The app's teaching layer
 * since the onboarding wizard stopped embedding a tutorial lesson
 * (2026-08).
 *
 * Two tip families, all persisted per-user through `completedTutorials`
 * (localStorage-first with DB backfill, via `useCompletedTutorials`):
 *
 * 1. **Intro concepts**. The walkthrough of the current review mode,
 *    shown on the first card. Persisted PER CONCEPT, so switching modes
 *    later replays nothing: only the new mode's own concepts (typing input
 *    and its rating scale for Writing; reveal/audio controls and its
 *    rating scale for Shadowing) appear, prefaced by a "Switched to …"
 *    welcome.
 *
 * 2. **Milestone tips**. Single popovers gated on LIFETIME reviews of the
 *    active course (`getLifetimeReviewCount`, reactive): card actions @2,
 *    chat @5, word tap @8, try-the-other-mode @11. At most
 *    one fires per card transition; when several become eligible at once
 *    the lowest threshold wins and the rest wait for later reviews.
 *
 * **Veteran guard**: when a tip first becomes eligible while the lifetime
 * count is already far past every threshold (`VETERAN_SUPPRESS_REPS`), all
 * unseen tips are silently marked completed instead of shown, existing
 * users never get walked through an app they already know, and no data
 * migration is needed.
 */

/** Shared with the one-time difficulty check (useDifficultyCheck), which
 *  applies the same "experienced users never see first-timer UI" rule. */
export const VETERAN_SUPPRESS_REPS = 50;

/** Delay before the intro mounts, so the card finishes its enter animation. */
const INTRO_DELAY_MS = 600;

// ─── Anchors ────────────────────────────────────────────────────────────────

const CARD_SELECTOR = tutorialSelector(TUTORIAL_ANCHORS.cardFlashcard);
const REVEAL_SELECTOR = tutorialSelector(TUTORIAL_ANCHORS.targetTextAudio);
const AUDIO_CONTROLS_SELECTOR = tutorialSelector(
  TUTORIAL_ANCHORS.audioControls,
);
const RATING_SELECTOR = tutorialSelector(TUTORIAL_ANCHORS.ratingButtons);
const INPUT_SELECTOR = tutorialSelector(TUTORIAL_ANCHORS.targetInputAndSubmit);
const SHOWN_TRANSLATION_SELECTOR = '[data-testid="first-exposure-answer"]';
const CARD_ACTIONS_SELECTOR = coachmarkSelector(COACHMARK_ANCHORS.cardActions);
const WORD_TAP_SELECTOR = coachmarkSelector(COACHMARK_ANCHORS.wordTap);
const CHAT_SELECTOR = `${coachmarkSelector(
  COACHMARK_ANCHORS.chatButtonDesktop,
)}, ${tutorialSelector(TUTORIAL_ANCHORS.chatButton)}`;
const SETTINGS_SELECTOR = tutorialSelector(TUTORIAL_ANCHORS.settingsButton);

// ─── Tip definitions ────────────────────────────────────────────────────────

type ReviewMode = 'audio' | 'full';

interface ConceptDef {
  id: TutorialId;
  buildStep: (
    t: TranslateFn,
    mode: ReviewMode,
    transcribe: boolean,
  ) => DriveStep;
  /** Concept doesn't exist in the Transcribe writing style (e.g. the shown
   *  translation, showing it there would BE the answer). Skipped, not
   *  persisted, so it still appears if the user later switches styles. */
  skipWhenTranscribe?: boolean;
}

function conceptStep(
  t: TranslateFn,
  key: string,
  descriptionKey: string,
  element?: string,
  side?: Side,
): DriveStep {
  const popover: NonNullable<DriveStep['popover']> = {
    title: t(`${key}.title`),
    description: t(descriptionKey),
  };
  if (element !== undefined && side !== undefined) {
    popover.side = side;
    popover.align = 'center';
  }
  return element !== undefined ? { element, popover } : { popover };
}

const CONCEPT_CARD: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_CARD,
  buildStep: (t, mode, transcribe) =>
    conceptStep(
      t,
      'concept.card',
      mode === 'full'
        ? transcribe
          ? 'concept.card.descriptionFullTranscribe'
          : 'concept.card.descriptionFull'
        : 'concept.card.descriptionAudio',
      CARD_SELECTOR,
      'bottom',
    ),
};

const CONCEPT_REVEAL: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_REVEAL,
  buildStep: (t) =>
    conceptStep(
      t,
      'concept.reveal',
      'concept.reveal.description',
      REVEAL_SELECTOR,
      'bottom',
    ),
};

const CONCEPT_AUDIO_CONTROLS: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_AUDIO_CONTROLS,
  buildStep: (t) =>
    conceptStep(
      t,
      'concept.audioControls',
      'concept.audioControls.description',
      AUDIO_CONTROLS_SELECTOR,
      'top',
    ),
};

function ratingStep(t: TranslateFn, key: string): DriveStep {
  const description = t.markup
    ? t.markup(`${key}.description`, {
        strong: (chunks: string) => `<strong>${chunks}</strong>`,
      })
    : t(`${key}.description`);
  return {
    element: RATING_SELECTOR,
    popover: {
      title: t(`${key}.title`),
      description,
      side: 'top',
      align: 'center',
    },
  };
}

const CONCEPT_RATING_AUDIO: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_RATING_AUDIO,
  buildStep: (t) => ratingStep(t, 'concept.ratingAudio'),
};

const CONCEPT_RATING_FULL: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_RATING_FULL,
  buildStep: (t) => ratingStep(t, 'concept.ratingFull'),
};

const CONCEPT_SHOWN_TRANSLATION: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_SHOWN_TRANSLATION,
  // Translate style only: on a brand-new sentence the answer is shown above
  // the input to copy-type; later reviews hide it. Transcribe never shows
  // it (the shown target would be the answer), so the concept is skipped
  // there rather than explained.
  skipWhenTranscribe: true,
  buildStep: (t) =>
    conceptStep(
      t,
      'concept.shownTranslation',
      'concept.shownTranslation.description',
      SHOWN_TRANSLATION_SELECTOR,
      'bottom',
    ),
};

const CONCEPT_INPUT: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_INPUT,
  buildStep: (t, _mode, transcribe) =>
    conceptStep(
      t,
      transcribe ? 'concept.inputTranscribe' : 'concept.input',
      transcribe
        ? 'concept.inputTranscribe.description'
        : 'concept.input.description',
      INPUT_SELECTOR,
      'top',
    ),
};

const CONCEPT_AUTOADD: ConceptDef = {
  id: TUTORIAL_IDS.TIP_CONCEPT_AUTOADD,
  buildStep: (t) =>
    conceptStep(t, 'concept.autoAdd', 'concept.autoAdd.description'),
};

/** Intro walkthrough order per mode. Shared concepts (card, autoAdd) appear
 *  in whichever mode the user meets first and never again. The shown
 *  translation is explained right BEFORE the input it sits above. */
const INTRO_SEQUENCES: Record<ReviewMode, ConceptDef[]> = {
  audio: [
    CONCEPT_CARD,
    CONCEPT_REVEAL,
    CONCEPT_AUDIO_CONTROLS,
    CONCEPT_RATING_AUDIO,
    CONCEPT_AUTOADD,
  ],
  full: [
    CONCEPT_CARD,
    CONCEPT_SHOWN_TRANSLATION,
    CONCEPT_INPUT,
    CONCEPT_RATING_FULL,
    CONCEPT_AUTOADD,
  ],
};

/** The concepts the intro would show right now. Mode sequence minus the
 *  ones that don't exist in the current writing style. */
function introSequenceFor(mode: ReviewMode, transcribe: boolean): ConceptDef[] {
  return INTRO_SEQUENCES[mode].filter(
    (c) => !(transcribe && c.skipWhenTranscribe),
  );
}

interface MilestoneDef {
  id: TutorialId;
  /** Lifetime review count at which the tip becomes eligible. */
  threshold: number;
  selector: string;
  buildStep: (t: TranslateFn, mode: ReviewMode) => DriveStep;
}

function milestoneStep(
  t: TranslateFn,
  key: string,
  element: string,
  side: 'top' | 'bottom' | 'left' | 'right',
  align: 'start' | 'center' | 'end' = 'center',
  descriptionKey?: string,
): DriveStep {
  return {
    element,
    popover: {
      title: t(`${key}.title`),
      description: t(descriptionKey ?? `${key}.description`),
      side,
      align,
    },
  };
}

/** Ordered by threshold. Evaluation picks the first unseen eligible tip. */
const MILESTONE_TIPS: MilestoneDef[] = [
  {
    id: TUTORIAL_IDS.TIP_CARD_ACTIONS,
    threshold: 2,
    selector: CARD_ACTIONS_SELECTOR,
    buildStep: (t) =>
      milestoneStep(t, 'cardActions', CARD_ACTIONS_SELECTOR, 'bottom', 'end'),
  },
  {
    id: TUTORIAL_IDS.TIP_CHAT,
    threshold: 5,
    selector: CHAT_SELECTOR,
    buildStep: (t) => milestoneStep(t, 'chat', CHAT_SELECTOR, 'left'),
  },
  {
    id: TUTORIAL_IDS.TIP_WORD_TAP,
    threshold: 8,
    selector: WORD_TAP_SELECTOR,
    buildStep: (t) => milestoneStep(t, 'wordTap', WORD_TAP_SELECTOR, 'bottom'),
  },
  {
    id: TUTORIAL_IDS.TIP_MODE_SWITCH,
    threshold: 11,
    selector: SETTINGS_SELECTOR,
    buildStep: (t, mode) =>
      milestoneStep(
        t,
        'modeSwitch',
        SETTINGS_SELECTOR,
        'bottom',
        'end',
        mode === 'audio'
          ? 'modeSwitch.descriptionAudio'
          : 'modeSwitch.descriptionFull',
      ),
  },
];

/** Shown tips only. `TIP_SETTINGS` stays in `ALL_TIP_IDS` so veterans
 *  still get it pre-marked; drop it back into `MILESTONE_TIPS` to restore. */
const HIDDEN_MILESTONE_IDS: TutorialId[] = [TUTORIAL_IDS.TIP_SETTINGS];

/** Every id this hook owns. The `useCompletedTutorials` sync set and the
 *  veteran guard's pre-marking set. */
const ALL_TIP_IDS: TutorialId[] = [
  ...INTRO_SEQUENCES.audio.map((c) => c.id),
  ...INTRO_SEQUENCES.full.map((c) => c.id),
  ...MILESTONE_TIPS.map((m) => m.id),
  ...HIDDEN_MILESTONE_IDS,
].filter((id, i, arr) => arr.indexOf(id) === i);

// ─── Element settling (ported from the retired onboarding-lesson tutorial) ──

/**
 * Invoke `onSettled` once `selector` resolves to a visible, attached element
 * whose rect has stopped moving (identical across `stableFrames` consecutive
 * frames). Tips fire right after a rating, which also kicks off the card
 * swap animation, and driver.js draws its highlight exactly once, so a rect
 * measured mid slide-in leaves the stage sitting where the element USED to
 * be. `minDelayMs` keeps a floor so the check can't latch onto the outgoing
 * card while it's still stationary pre-exit; `timeoutMs` guarantees the
 * callback always runs even if the element never shows up.
 *
 * `found` distinguishes the two exits: `true` = settled on a real element,
 * `false` = timed out with nothing matching. A whole-card step can degrade to
 * a centered popover on `false`, but a step ABOUT one specific control can't
 * See the milestone caller, which defers instead of teaching an anchor the
 * user cannot see.
 */
function whenElementSettled(
  selector: string,
  onSettled: (found: boolean) => void,
  { minDelayMs = 350, timeoutMs = 2000, stableFrames = 3 } = {},
): void {
  const startedAt = performance.now();
  let lastEl: Element | null = null;
  let lastRect: DOMRect | null = null;
  let stableCount = 0;
  const tick = () => {
    const elapsed = performance.now() - startedAt;
    if (elapsed >= timeoutMs) {
      onSettled(false);
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
        onSettled(true);
        return;
      }
      lastEl = el;
      lastRect = rect;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Pause any playing DOM `<audio>`/`<video>` immediately. The merged card
 *  audio lives in a detached element the DOM query can't reach. The host
 *  pauses that one through the `onWillShow` callback. */
function pauseAllAudioNow(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
    if (!el.paused) el.pause();
  });
}

/** Destroy the in-flight driver (if any) with the programmatic-teardown flag
 *  raised, so `onDestroyStarted` (if the driver version fires it) can tell
 *  this apart from a user dismissal and skip persistence + gesture work. */
function teardownActiveDriver(
  activeDriverRef: RefObject<Driver | null>,
  programmaticTeardownRef: RefObject<boolean>,
  unbindKeyboardRef: RefObject<(() => void) | null>,
): void {
  unbindKeyboardRef.current?.();
  unbindKeyboardRef.current = null;
  if (!activeDriverRef.current) return;
  programmaticTeardownRef.current = true;
  try {
    activeDriverRef.current.destroy();
  } finally {
    programmaticTeardownRef.current = false;
  }
  activeDriverRef.current = null;
}

// ─── The hook ───────────────────────────────────────────────────────────────

export interface UseMilestoneTipsOptions {
  /** Master gate, reviewing, not free play, settings closed. While false,
   *  nothing fires and no lifetime-count query is subscribed. */
  enabled: boolean;
  reviewMode: ReviewMode;
  /** Writing style is Transcribe (type what you hear), swaps the full-mode
   *  card/input copy. */
  transcribe?: boolean;
  /** Fires synchronously right before a tip mounts. Pause the (detached)
   *  card audio here so it doesn't compete with the popover. */
  onWillShow?: () => void;
  /** Fires inside the click that closed a tip (user gesture preserved).
   *  Kick card audio back off here. */
  onClosed?: () => void;
}

export function useMilestoneTips({
  enabled,
  reviewMode,
  transcribe = false,
  onWillShow,
  onClosed,
}: UseMilestoneTipsOptions) {
  const t = useTranslations('Tips') as unknown as TranslateFn;
  const [isActive, setIsActive] = useState(false);

  const activeDriverRef = useRef<Driver | null>(null);
  const unbindKeyboardRef = useRef<(() => void) | null>(null);
  const programmaticTeardownRef = useRef(false);
  // Ids claimed by this mount. Set the moment a tip is scheduled (before
  // the settle wait), so a re-render mid-wait can't double-fire it. Cleared
  // only by unmount; persistence via completedTutorials happens on close.
  const claimedRef = useRef<Set<string>>(new Set());
  // True from claim until the driver is torn down. A second tip must not
  // stack on top of an open one.
  const busyRef = useRef(false);

  const onWillShowRef = useRef(onWillShow);
  const onClosedRef = useRef(onClosed);
  const tRef = useRef(t);
  const transcribeRef = useRef(transcribe);
  // Mirrors `enabled` for the fire-time liveness check in `runTip`. The
  // settle waits outlive the effect that scheduled them (see below), so the
  // host can close the session or open the settings sheet inside the wait.
  // The render-closure `enabled` captured at schedule time would be stale.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    onWillShowRef.current = onWillShow;
    onClosedRef.current = onClosed;
    tRef.current = t;
    transcribeRef.current = transcribe;
    enabledRef.current = enabled;
  });

  const { completed, markCompleted, isLoaded } =
    useCompletedTutorials(ALL_TIP_IDS);

  const allTipsDone = ALL_TIP_IDS.every((id) => completed.includes(id));
  // `useQueries`, not `useQuery`: a `useQuery` server error is THROWN into
  // render, and from this hook it unwound past LearnView's ViewErrorBoundary
  // to app/error.tsx, blanking the whole app shell over the teaching layer.
  // The query is three indexed documents, but the 1s budget is wall-clock, so
  // a saturated backend times it out anyway (the same limit applies in
  // production and is not configurable on the local backend). `useQueries`
  // returns the error as a VALUE instead. Memoised because the subscription
  // is keyed on the descriptor's identity.
  const repsQuery = useMemo(() => {
    const q: RequestForQueries = {};
    if (enabled && !allTipsDone) {
      q.lifetimeReps = {
        query: api.features.courses.getLifetimeReviewCount,
        args: {},
      };
    }
    return q;
  }, [enabled, allTipsDone]);
  const repsResult = useQueries(repsQuery).lifetimeReps;
  const repsFailed = repsResult instanceof Error;
  const lifetimeReps = typeof repsResult === 'number' ? repsResult : null;

  // Effect-time check against the LIVE store. The DB backfill effect (in
  // useCompletedTutorials, registered earlier in hook order) may merge new
  // completions in the same commit this hook's effects run in, and a
  // render-closure `completed` would still be pre-merge.
  const seen = useCallback(
    (id: string) =>
      getCompletedTutorialsSnapshot().includes(id) ||
      claimedRef.current.has(id),
    [],
  );

  // Blocks any tip work after unmount. The settle waits are rAF loops that
  // outlive effect cleanup on purpose (a claimed schedule is committed), so
  // the mount itself has to be re-checked at fire time.
  const unmountedRef = useRef(false);

  const runTip = useCallback(
    (steps: DriveStep[], tipIds: TutorialId[], analyticsId: string) => {
      if (unmountedRef.current || !enabledRef.current) {
        // The claim was made but the popover must not mount. Release the
        // slot and the audio gates. Without this, a wrongly-latched flag
        // (StrictMode dev double-mount, before the reset below existed)
        // left `isActive` stuck true, permanently disabling autoplay and
        // auto-advance in audio mode with no popover on screen.
        //
        // `!enabled` is the mid-wait case: the settings sheet opened or the
        // session ended inside the ≤2s settle window. Un-claim so the tip is
        // offered again later instead of mounting unanchored over whatever
        // is now on screen and being marked done on dismiss.
        for (const id of tipIds) claimedRef.current.delete(id);
        busyRef.current = false;
        setIsActive(false);
        return;
      }
      teardownActiveDriver(
        activeDriverRef,
        programmaticTeardownRef,
        unbindKeyboardRef,
      );

      const resolved: DriveStep[] = resolveStepAnchors(steps, {
        onMiss: 'unanchor',
      });

      capture(CLIENT_EVENTS.TUTORIAL_STARTED, {
        tutorial_id: analyticsId,
        step_count: resolved.length,
      });

      const d = driver({
        ...baseDriverConfig(),
        showProgress: resolved.length > 1,
        popoverClass: `phrasis-tip-${analyticsId}`,
        steps: resolved,
        onDestroyStarted: () => {
          unbindKeyboardRef.current?.();
          unbindKeyboardRef.current = null;
          activeDriverRef.current = null;
          busyRef.current = false;
          setIsActive(false);
          if (!programmaticTeardownRef.current) {
            // Finished or user-dismissed, either way, don't re-offer
            // (re-offering a tip someone deliberately closed is worse than
            // dropping it). Every concept in the sequence persists, matching
            // the tour semantics in use-tutorial.ts.
            for (const id of tipIds) markCompleted(id);
            // Still inside the dismissing click's call stack. The one place
            // gesture-bound work (starting the card audio) can run on iOS.
            onClosedRef.current?.();
          }
          d.destroy();
        },
      });
      unbindKeyboardRef.current?.();
      unbindKeyboardRef.current = bindTourKeyboard(d);
      activeDriverRef.current = d;
      setIsActive(true);
      onWillShowRef.current?.();
      pauseAllAudioNow();
      d.drive();
    },
    [markCompleted],
  );

  // ---- veteran guard: silently retire everything for experienced users ----
  const isVeteran =
    lifetimeReps != null && lifetimeReps > VETERAN_SUPPRESS_REPS;
  useEffect(() => {
    if (!enabled || !isLoaded || !isVeteran) return;
    for (const id of ALL_TIP_IDS) {
      if (!seen(id)) {
        claimedRef.current.add(id);
        markCompleted(id, { captureEvent: false });
      }
    }
  }, [enabled, isLoaded, isVeteran, seen, markCompleted]);

  // Whether the current mode's intro still has unseen concepts (ignoring
  // this mount's claims, a claimed-but-unfinished intro is still pending).
  const introPendingForMode = introSequenceFor(reviewMode, transcribe).some(
    (c) => !completed.includes(c.id),
  );
  // The host keeps autoplay gated while this is true so card audio can't
  // start underneath the intro (or before we even know whether one is
  // needed, unknown counts stay gated).
  // A FAILED count is not the same as an unknown one. `introReady` below
  // requires `lifetimeReps != null`, so on failure no intro will ever run,
  // leaving this true would gate card autoplay for the rest of the session
  // waiting on a walkthrough that cannot start. If we can't tell where the
  // user is, teach nothing and gate nothing.
  const introPending =
    !repsFailed &&
    (!isLoaded ||
      (!allTipsDone && lifetimeReps == null) ||
      (!isVeteran && introPendingForMode));

  const buildIntroSteps = useCallback(
    (
      mode: ReviewMode,
      concepts: ConceptDef[],
      freshWelcome: boolean,
    ): DriveStep[] => {
      const tr = tRef.current;
      const welcomeKey = freshWelcome
        ? mode === 'audio'
          ? 'welcome.audio'
          : 'welcome.full'
        : mode === 'audio'
          ? 'welcome.switchedAudio'
          : 'welcome.switchedFull';
      const welcome: DriveStep = {
        popover: {
          title: tr(`${welcomeKey}.title`),
          description: tr(`${welcomeKey}.description`),
        },
      };
      return [
        welcome,
        ...concepts.map((c) => c.buildStep(tr, mode, transcribeRef.current)),
      ];
    },
    [],
  );

  // ---- intro walkthrough for the current mode ----
  const introReady = enabled && isLoaded && lifetimeReps != null && !isVeteran;
  useEffect(() => {
    if (!introReady || busyRef.current) return;
    const mode = reviewMode;
    const sequence = introSequenceFor(mode, transcribeRef.current);
    const unseenConcepts = sequence.filter((c) => !seen(c.id));
    if (unseenConcepts.length === 0) return;

    // A partial sequence means the shared concepts were taught in the other
    // mode. Open with the "Switched to …" welcome instead of the full one.
    const freshWelcome = unseenConcepts.length === sequence.length;

    // Claim before the settle wait: a re-render inside the wait must not
    // re-enter and double-schedule. (Local alias so the cleanup below reads
    // the same set instance. The ref never repoints, but the lint rule
    // can't know that.)
    const claimed = claimedRef.current;
    for (const c of unseenConcepts) claimed.add(c.id);
    busyRef.current = true;
    setIsActive(true);
    onWillShowRef.current?.();
    pauseAllAudioNow();

    const tipIds = unseenConcepts.map((c) => c.id);
    let cancelled = false;
    const timer = setTimeout(() => {
      whenElementSettled(CARD_SELECTOR, () => {
        if (cancelled) return;
        runTip(
          buildIntroSteps(mode, unseenConcepts, freshWelcome),
          tipIds,
          `intro_${mode}`,
        );
      });
    }, INTRO_DELAY_MS);
    return () => {
      // Host disabled or mode flipped mid-wait/mid-show: hide without
      // persisting so the intro is offered again. Un-claim so a later run
      // of this effect can reschedule.
      cancelled = true;
      clearTimeout(timer);
      teardownActiveDriver(
        activeDriverRef,
        programmaticTeardownRef,
        unbindKeyboardRef,
      );
      for (const id of tipIds) claimed.delete(id);
      busyRef.current = false;
      setIsActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introReady, reviewMode]);

  // ---- milestone tips, one per card transition ----
  useEffect(() => {
    if (!introReady || busyRef.current || lifetimeReps == null) return;
    // The intro owns the first slot. Milestones wait until the current
    // mode's concepts are all persisted.
    if (
      introSequenceFor(reviewMode, transcribeRef.current).some(
        (c) => !seen(c.id),
      )
    ) {
      return;
    }

    const tip = MILESTONE_TIPS.find(
      (m) => lifetimeReps >= m.threshold && !seen(m.id),
    );
    if (!tip) return;

    claimedRef.current.add(tip.id);
    busyRef.current = true;
    setIsActive(true);
    onWillShowRef.current?.();
    pauseAllAudioNow();
    whenElementSettled(tip.selector, (found) => {
      if (!found) {
        // Every milestone tip is ABOUT one specific control, so an
        // unanchored centered popover would explain something the user
        // cannot see, and dismissing it would burn the one-time tip for
        // good. Release the slot instead and re-offer on a later card, when
        // the control is on screen (e.g. the chat button in a layout that
        // hides it, or a card state that hasn't rendered the anchor yet).
        claimedRef.current.delete(tip.id);
        busyRef.current = false;
        setIsActive(false);
        return;
      }
      runTip([tip.buildStep(tRef.current, reviewMode)], [tip.id], tip.id);
    });
    // No cleanup: once claimed, the settle wait is committed (see the
    // onboarding-tutorial precedent), cancelling mid-wait would strand the
    // claim and the tip would never show. `runTip` re-checks liveness at
    // mount time instead.
    //
    // `completed` is deliberately NOT a dependency. Closing a tip persists
    // it, so including it would re-run this effect the moment one is
    // dismissed and immediately fire the next eligible tip. A user between
    // the last threshold and VETERAN_SUPPRESS_REPS would get every remaining
    // milestone popover chained on a single card. `lifetimeReps` is the intended
    // clock: it ticks once per review, giving the documented at-most-one-
    // per-card-transition. `seen()` reads the live store, so the eligibility
    // check inside the body is still current without re-triggering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introReady, lifetimeReps, reviewMode]);

  // Never leave an orphaned overlay behind if the host unmounts mid-tip,
  // and block any still-pending settle wait from mounting one afterwards.
  // The flag MUST be re-armed in the effect body: React StrictMode's dev
  // double-mount runs this cleanup once on the same component instance, and
  // a latched `true` would block every tip for the whole session.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      teardownActiveDriver(
        activeDriverRef,
        programmaticTeardownRef,
        unbindKeyboardRef,
      );
    };
  }, []);

  /** Replay the CURRENT mode's full intro (help-dialog affordance). Runs
   *  every concept regardless of completion; persistence is a no-op for
   *  already-completed ids. */
  const restartIntro = useCallback(() => {
    const sequence = introSequenceFor(reviewMode, transcribeRef.current);
    busyRef.current = true;
    setIsActive(true);
    onWillShowRef.current?.();
    pauseAllAudioNow();
    whenElementSettled(CARD_SELECTOR, () => {
      runTip(
        buildIntroSteps(reviewMode, sequence, true),
        sequence.map((c) => c.id),
        `intro_${reviewMode}`,
      );
    });
  }, [reviewMode, runTip, buildIntroSteps]);

  return {
    /** A tip popover is mounted (or committed to mount) right now. */
    isActive,
    /** The current mode's intro hasn't fully run yet. Keep autoplay off. */
    introPending,
    restartIntro,
  };
}
