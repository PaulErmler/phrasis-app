'use client';

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { driver, type Driver, type DriveStep } from 'driver.js';
import { getTutorial } from './registry';

const LOCAL_STORAGE_KEY = 'phrasis_completed_tutorials';

const storageListeners = new Set<() => void>();
let cachedSnapshot: string[] = [];
let cachedRaw: string | null = null;

const EMPTY: string[] = [];

function readSnapshot(): string[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
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
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ids));
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
}

export function useTutorial(tutorialId: string, options: UseTutorialOptions = {}) {
  const {
    enabled = true,
    delayMs = 800,
    extraSteps,
    onInteractiveStep,
    onComplete,
    stepCompleteOnClickIndex,
  } = options;
  const driverRef = useRef<Driver | null>(null);
  const [isActive, setIsActive] = useState(false);
  const t = useTranslations('Tutorial');

  // ---- localStorage is the primary source of truth for UI decisions ----
  const completed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isCompleted = completed.includes(tutorialId);

  const tutorial = getTutorial(tutorialId, t);
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
  useEffect(() => {
    if (!dbCompleted || didSyncRef.current) return;
    didSyncRef.current = true;

    const local = getSnapshot();
    const missing = dbCompleted.filter((id) => !local.includes(id));
    if (missing.length > 0) {
      writeCompleted([...local, ...missing]);
    }
  }, [dbCompleted]);

  // ---- callbacks ----
  const onInteractiveStepRef = useRef(onInteractiveStep);
  onInteractiveStepRef.current = onInteractiveStep;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const extraStepsRef = useRef(extraSteps);
  extraStepsRef.current = extraSteps;

  const completeTutorial = useCallback(() => {
    const prev = getSnapshot();
    if (!prev.includes(tutorialId)) {
      writeCompleted([...prev, tutorialId]);
    }
    completeMutation({ tutorialId }).catch((e) =>
      console.error('Failed to persist tutorial completion:', e),
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
        if (rect.width > 0 && rect.height > 0) {
          return { ...step, element: el };
        }
      }
      return step;
    });

    const isInteractiveStep = (stepIndex: number) => {
      const step = resolvedSteps[stepIndex];
      return step?.popover && 'popoverClass' in step.popover && step.popover.popoverClass === 'tutorial-try-card';
    };

    if (
      stepCompleteOnClickIndex != null &&
      stepCompleteOnClickIndex >= 0 &&
      stepCompleteOnClickIndex < resolvedSteps.length
    ) {
      const step = resolvedSteps[stepCompleteOnClickIndex];
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

    const d = driver({
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      stagePadding: 8,
      stageRadius: 8,
      steps: resolvedSteps,
      onDestroyStarted: () => {
        completeTutorial();
        setIsActive(false);
        onCompleteRef.current?.();
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
  }, [tutorial, completeTutorial, stepCompleteOnClickIndex]);

  const launchDriverRef = useRef(launchDriver);
  launchDriverRef.current = launchDriver;

  useEffect(() => {
    if (!shouldStart) return;

    const timer = setTimeout(() => {
      launchDriverRef.current();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [shouldStart, delayMs]);

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
  tRef.current = t;

  const showChatStep = useCallback(() => {
    const tr = tRef.current;
    const d = driver({
      showButtons: ['close'],
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
