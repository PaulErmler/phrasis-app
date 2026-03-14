import type { DriveStep } from 'driver.js';

export type TranslateFn = (key: string) => string;

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
