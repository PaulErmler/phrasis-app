import type { DriveStep } from 'driver.js';

/**
 * DriveStep plus app extensions. `skipIfMissing`: drop the step at launch
 * when its selector has no visible match — for steps anchored to
 * conditionally mounted UI whose gate lives in query data the tour factory
 * can't see (e.g. the workload card below its minimum-activity gate).
 * Like the ctx-gated steps, dropping one shifts the indices of later steps,
 * so `stepCompleteOnClickIndex` must only target steps before any
 * skippable one.
 */
export type AppDriveStep = DriveStep & { skipIfMissing?: boolean };

type MarkupValues = Record<string, (chunks: string) => string>;

export type TranslateFn = ((key: string) => string) & {
  markup?: (key: string, values: MarkupValues) => string;
};

export interface TutorialCallbacks {
  onComplete: () => void;
  onDismiss: () => void;
}

export interface TutorialDefinition {
  id: string;
  steps: AppDriveStep[];
  prerequisite?: string;
  popoverClass?: string;
}

/**
 * Optional runtime context a tour factory can branch on. The home tour uses
 * `reviewMode` to anchor the free-play step to the button that actually
 * renders: Radio in Shadowing, Free Study in Writing.
 */
export interface TutorialContext {
  reviewMode?: 'audio' | 'full';
  /** When true, skip the due-counts tour step — those pills are not on screen. */
  hideDueCounts?: boolean;
}

export type TutorialFactory = (
  t: TranslateFn,
  ctx?: TutorialContext,
) => TutorialDefinition;
