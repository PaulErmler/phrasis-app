import type { DriveStep } from 'driver.js';

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
  steps: DriveStep[];
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
