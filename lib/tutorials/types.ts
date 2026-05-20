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

export type TutorialFactory = (t: TranslateFn) => TutorialDefinition;
