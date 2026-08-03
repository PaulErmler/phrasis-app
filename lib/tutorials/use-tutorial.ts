'use client';

import { useEffect, useLayoutEffect, useRef, useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { reportError } from '@/lib/report-error';
import { driver, type Driver, type DriveStep } from 'driver.js';
import type { TutorialId } from '@/convex/features/tutorialIds';
import { getTutorial } from './registry';
import type { TutorialContext } from './types';

const STORAGE_PREFIX = 'phrasis_completed_tutorials';

const DRIVER_OVERLAY_OPACITY_VAR = '--driver-overlay-opacity';

/** Opaque fill + single opacity for driver.js SVG overlay (see app/globals.css). */
function getDriverOverlayOpacity(): number {
  if (typeof document === 'undefined') return 0.5;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(DRIVER_OVERLAY_OPACITY_VAR)
    .trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

let currentUserId: string | null = null;

function getStorageKey(): string {
  return currentUserId ? `${STORAGE_PREFIX}_${currentUserId}` : STORAGE_PREFIX;
}

/**
 * Switch the localStorage namespace when the authenticated user changes.
 * Invalidates the cached snapshot so subscribers re-read for the new user.
 */
function setTutorialUser(userId: string | null) {
  if (userId === currentUserId) return;
  currentUserId = userId;
  cachedRaw = null;
  cachedSnapshot = EMPTY;
  readSnapshot();
  notifyStorageListeners();
}

const storageListeners = new Set<() => void>();
let cachedSnapshot: string[] = [];
let cachedRaw: string | null = null;

const EMPTY: string[] = [];

function readSnapshot(): string[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    cachedSnapshot = raw ? JSON.parse(raw) : EMPTY;
    return cachedSnapshot;
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): string[] {
  return cachedSnapshot;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

function subscribe(onStoreChange: () => void): () => void {
  storageListeners.add(onStoreChange);
  return () => storageListeners.delete(onStoreChange);
}

function notifyStorageListeners() {
  readSnapshot();
  for (const listener of storageListeners) listener();
}

readSnapshot();

function writeCompleted(ids: string[]) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(ids));
  } catch {
    // ignore
  }
  notifyStorageListeners();
}

interface UseTutorialOptions {
  enabled?: boolean;
  delayMs?: number;
  extraSteps?: DriveStep[];
  onInteractiveStep?: () => void;
  onComplete?: () => void;
  /** When the user clicks the highlighted element on this step (0-based index), complete the tutorial and close the driver. */
  stepCompleteOnClickIndex?: number;
  /** Runtime context forwarded to the tour factory (e.g. reviewMode so the
   *  home tour anchors the Radio vs Free Study button). */
  context?: TutorialContext;
}

export function useTutorial(tutorialId: TutorialId, options: UseTutorialOptions = {}) {
  const {
    enabled = true,
    delayMs = 800,
    extraSteps,
    onInteractiveStep,
    onComplete,
    stepCompleteOnClickIndex,
    context,
  } = options;
  const driverRef = useRef<Driver | null>(null);
  // When true, the next onDestroyStarted tears down without marking complete
  // (e.g. host view hid mid-tour — we want to re-offer later, not persist).
  const suppressCompleteRef = useRef(false);
  const [isActive, setIsActive] = useState(false);
  const t = useTranslations('Tutorial');

  // ---- bind localStorage to the current authenticated user ----
  const authUser = useQuery(api.auth.getAuthUser);
  const authSubject =
    authUser != null
      ? authUser.userId != null && authUser.userId !== ''
        ? authUser.userId
        : authUser._id
      : null;
  const userId =
    authSubject != null && authSubject !== '' ? String(authSubject) : null;
  const prevUserIdRef = useRef(userId);

  useEffect(() => {
    setTutorialUser(userId);
    prevUserIdRef.current = userId;
  }, [userId]);

  // ---- localStorage is the primary source of truth for UI decisions ----
  const completed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isCompleted = completed.includes(tutorialId);

  const tutorial = getTutorial(tutorialId, t, context);
  const prerequisiteMet = tutorial?.prerequisite
    ? completed.includes(tutorial.prerequisite)
    : true;

  const shouldStart = enabled && !isCompleted && prerequisiteMet;

  // ---- Convex: persist completions & one-time sync from DB ----
  const completeMutation = useMutation(api.features.courses.completeTutorial);

  // Only subscribe to the Convex query when localStorage says this tutorial
  // (or its prerequisite) is NOT yet completed. Once localStorage has the
  // data we need, skip the query to avoid unnecessary reads.
  const needsDbSync = !isCompleted || (tutorial?.prerequisite && !prerequisiteMet);
  const dbCompleted = useQuery(
    api.features.courses.getCompletedTutorials,
    needsDbSync ? {} : 'skip',
  );

  // One-time backfill: if the DB knows about completions that localStorage
  // doesn't, merge them into localStorage so the user doesn't re-see tutorials
  // they already finished on another device.
  const didSyncRef = useRef(false);
  const syncedForUserRef = useRef(userId);

  useEffect(() => {
    if (userId !== syncedForUserRef.current) {
      didSyncRef.current = false;
      syncedForUserRef.current = userId;
    }
    if (!dbCompleted || didSyncRef.current) return;
    didSyncRef.current = true;

    const local = getSnapshot();
    const missing = dbCompleted.filter((id) => !local.includes(id));
    if (missing.length > 0) {
      writeCompleted([...local, ...missing]);
    }
  }, [dbCompleted, userId]);

  // ---- callbacks ----
  const onInteractiveStepRef = useRef(onInteractiveStep);
  const onCompleteRef = useRef(onComplete);
  const extraStepsRef = useRef(extraSteps);
  useLayoutEffect(() => {
    onInteractiveStepRef.current = onInteractiveStep;
    onCompleteRef.current = onComplete;
    extraStepsRef.current = extraSteps;
  });

  const completeTutorial = useCallback(() => {
    const prev = getSnapshot();
    if (!prev.includes(tutorialId)) {
      // Only on the first completion — re-running a tutorial should not count
      // again, or the completion rate can exceed its own start count.
      writeCompleted([...prev, tutorialId]);
      capture(CLIENT_EVENTS.TUTORIAL_COMPLETED, { tutorial_id: tutorialId });
    }
    completeMutation({ tutorialId }).catch((e) =>
      reportError(e, { op: 'tutorial.persistCompletion', tutorialId }),
    );
  }, [tutorialId, completeMutation]);

  const launchDriver = useCallback(() => {
    if (!tutorial) return;

    const allSteps = [...tutorial.steps, ...(extraStepsRef.current ?? [])];

    const resolvedSteps = allSteps.map((step) => {
      if (typeof step.element !== 'string') return step;
      const candidates = document.querySelectorAll<HTMLElement>(step.element);
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        // `visibility: hidden` keeps its layout box (e.g. the due-count
        // pills reserve their width while counts load), so a pure rect
        // check would highlight a blank rectangle — treat it as absent and
        // let the step degrade to a centered popover instead.
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(el).visibility !== 'hidden'
        ) {
          return { ...step, element: el };
        }
      }
      return step;
    });

    const isInteractiveStep = (stepIndex: number) => {
      const step = resolvedSteps[stepIndex];
      return step?.popover && 'popoverClass' in step.popover && step.popover.popoverClass === 'tutorial-try-card';
    };

    const completeOnClickIndices = new Set<number>();
    if (
      stepCompleteOnClickIndex != null &&
      stepCompleteOnClickIndex >= 0 &&
      stepCompleteOnClickIndex < resolvedSteps.length
    ) {
      completeOnClickIndices.add(stepCompleteOnClickIndex);
    }
    // The closing step of a tour is a call-to-action that highlights the
    // element the user is invited to click. That click must count as
    // finishing the tour: it often navigates away (e.g. the home tour's
    // Learn + Review CTA opens the learn view), which hides the host and
    // would otherwise hit the suppress-complete path below — leaving the
    // tour unfinished and re-running it on every visit.
    if (resolvedSteps.length > 0) {
      completeOnClickIndices.add(resolvedSteps.length - 1);
    }
    for (const index of completeOnClickIndices) {
      const step = resolvedSteps[index];
      let clickHandler: (() => void) | null = null;
      let targetElement: Element | null = null;
      step.onHighlighted = (element, _s, opts) => {
        targetElement = element ?? null;
        if (!targetElement) return;
        clickHandler = () => {
          opts.driver.destroy();
        };
        targetElement.addEventListener('click', clickHandler, true);
      };
      step.onDeselected = () => {
        if (targetElement && clickHandler) {
          targetElement.removeEventListener('click', clickHandler, true);
        }
        targetElement = null;
        clickHandler = null;
      };
    }

    capture(CLIENT_EVENTS.TUTORIAL_STARTED, {
      tutorial_id: tutorialId,
      step_count: resolvedSteps.length,
    });

    const d = driver({
      animate: true,
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      overlayColor: '#000',
      overlayOpacity: getDriverOverlayOpacity(),
      stagePadding: 8,
      stageRadius: 8,
      popoverClass: `phrasis-tutorial-${tutorialId}`,
      steps: resolvedSteps,
      onDestroyStarted: () => {
        const skipComplete = suppressCompleteRef.current;
        suppressCompleteRef.current = false;
        if (!skipComplete) {
          completeTutorial();
          onCompleteRef.current?.();
        }
        setIsActive(false);
        driverRef.current = null;
        d.destroy();
      },
      onHighlightStarted: (_element, _step, opts) => {
        const stepIndex = opts.state.activeIndex ?? 0;
        if (isInteractiveStep(stepIndex)) {
          onInteractiveStepRef.current?.();
        }
      },
    });

    driverRef.current = d;
    setIsActive(true);
    d.drive();
  }, [tutorial, tutorialId, completeTutorial, stepCompleteOnClickIndex]);

  const launchDriverRef = useRef(launchDriver);
  useLayoutEffect(() => {
    launchDriverRef.current = launchDriver;
  });

  useEffect(() => {
    if (!shouldStart) return;

    const timer = setTimeout(() => {
      launchDriverRef.current();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [shouldStart, delayMs]);

  // Hide an in-flight tour when the host disables it (e.g. user left Home)
  // without marking it complete, so it can auto-start again on return.
  useEffect(() => {
    if (enabled) return;
    const active = driverRef.current;
    if (!active) return;
    suppressCompleteRef.current = true;
    active.destroy();
  }, [enabled]);

  const moveToInteractiveWait = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
      setIsActive(false);
    }
  }, []);

  const showCompletionStep = useCallback((title: string, description: string) => {
    const d = driver({
      showButtons: ['close'],
      overlayColor: '#000',
      overlayOpacity: getDriverOverlayOpacity(),
      popoverClass: 'phrasis-tutorial-completion',
      steps: [{
        popover: { title, description },
      }],
      onDestroyStarted: () => {
        d.destroy();
      },
    });
    d.drive();
  }, []);

  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  });

  const showChatStep = useCallback(() => {
    const tr = tRef.current;
    const d = driver({
      showButtons: ['close'],
      overlayColor: '#000',
      overlayOpacity: getDriverOverlayOpacity(),
      popoverClass: 'phrasis-tutorial-chat',
      steps: [{
        element: '[data-tutorial="chat-button"]',
        popover: {
          title: tr('chat.title'),
          description: tr('chat.description'),
          side: 'top' as const,
          align: 'center' as const,
        },
      }],
      onDestroyStarted: () => {
        completeTutorial();
        onCompleteRef.current?.();
        d.destroy();
      },
    });
    d.drive();
  }, [completeTutorial]);

  const restartTutorial = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    setIsActive(false);
    launchDriver();
  }, [launchDriver]);

  return {
    isActive,
    isCompleted,
    startTutorial: launchDriver,
    restartTutorial,
    moveToInteractiveWait,
    showCompletionStep,
    showChatStep,
    completeTutorial,
  };
}
