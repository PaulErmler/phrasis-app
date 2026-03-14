# Tutorial System Architecture

This document describes the implemented tutorial system, how it works, how to modify existing tutorials, and how to add new ones.

---

## Overview

The tutorial system uses [driver.js](https://driverjs.com/) to guide users through the app after onboarding. Tutorials are:

- **Declarative** — each tutorial is a list of `DriveStep` objects in its own file
- **Persistent** — completion state is stored in `userSettings.completedTutorials` (Convex) and cached in localStorage (`phrasis_completed_tutorials`) to avoid a database call on every load once tutorials have run
- **Prerequisite-aware** — a tutorial can require another to be completed first
- **Auto-triggered** — the `useTutorial` hook starts a tutorial automatically when conditions are met

---

## File Structure

```
lib/tutorials/
├── types.ts               — TutorialDefinition interface
├── registry.ts            — Central registry, TUTORIAL_IDS constants
├── use-tutorial.ts        — React hook that manages lifecycle
├── home-tour.ts           — Home screen overview tour
├── audio-review-tour.ts   — Audio review learning mode tour
└── full-review-tour.ts    — Full review learning mode tour
```

---

## Core Concepts

### TutorialDefinition (`types.ts`)

```typescript
interface TutorialDefinition {
  id: string;              // Unique ID stored in completedTutorials
  steps: DriveStep[];      // driver.js step configuration
  prerequisite?: string;   // ID of a tutorial that must complete first
}
```

### Registry (`registry.ts`)

All tutorials are registered at import time via `registerTutorial()`. The registry exposes:

- `getTutorial(id)` — look up a definition
- `getAllTutorials()` — list all definitions
- `TUTORIAL_IDS` — typed constant object for referencing IDs

```typescript
export const TUTORIAL_IDS = {
  HOME_TOUR: 'home_tour',
  AUDIO_REVIEW_INTRO: 'audio_review_intro',
  FULL_REVIEW_INTRO: 'full_review_intro',
} as const;
```

### useTutorial Hook (`use-tutorial.ts`)

The main integration point. Call it in any component to auto-trigger a tutorial.

```typescript
const { isActive, restartTutorial, completeTutorial } = useTutorial(
  TUTORIAL_IDS.HOME_TOUR,
  {
    enabled: true,      // Gate on a condition (default: true)
    delayMs: 1200,      // Delay before auto-starting (default: 800)
    onInteractiveStep: () => { ... },  // Called when a "try card" step is reached
    onComplete: () => { ... },         // Called when the tutorial finishes
  }
);
```

**Auto-start logic:**

The hook uses an effective completed list: Convex `getCompletedTutorials` when available, otherwise the localStorage cache. It auto-starts when all of these are true:
1. `enabled` is `true`
2. The tutorial is not already in the effective completed list
3. The prerequisite tutorial (if any) is in the effective completed list
4. Either the Convex query has returned or the localStorage cache has a value (so we don’t start before we know completion state)

When Convex returns, the result is written to localStorage. When a tutorial is completed via `completeTutorial`, the mutation runs and the ID is appended to localStorage so the UI stays in sync. When `resetTutorials` is used (e.g. from the reset buttons), call `clearTutorialsLocalStorage()` so the cache is cleared.

When `enabled` transitions from `false` → `true`, the auto-start guard resets, allowing the tutorial to fire. This is how the learning mode tutorials work: `enabled` is `state.status === 'reviewing'`, which becomes `true` once the card data has loaded.

**Returned values:**

| Value | Description |
|-------|-------------|
| `isActive` | Whether the tutorial overlay is currently showing |
| `isCompleted` | Whether this tutorial has been completed |
| `startTutorial` | Manually launch the tutorial |
| `restartTutorial` | Reset guard + launch (for testing) |
| `moveToInteractiveWait` | Destroy the driver overlay to let the user interact freely |
| `showCompletionStep` | Show a standalone popover (title + description) |
| `showChatStep` | Show the chat button highlight step |
| `completeTutorial` | Mark the tutorial as complete in the DB (and update localStorage cache) |

The module also exports `clearTutorialsLocalStorage()`: call it after `resetTutorials()` so the localStorage cache is cleared (e.g. from "Restart Home Tutorial" and "Reset All Tutorials" buttons).

---

## Backend

### Schema (`convex/schema.ts`)

Tutorial completion is stored on the `userSettings` table:

```typescript
completedTutorials: v.optional(v.array(v.string()))
```

### Mutations & Queries (`convex/features/courses.ts`)

| Endpoint | Type | Purpose |
|----------|------|---------|
| `getCompletedTutorials` | query | Returns `string[]` of completed tutorial IDs |
| `completeTutorial` | mutation | Appends a tutorial ID to the array |
| `resetTutorials` | mutation | Clears the array (for testing) |

---

## Existing Tutorials

### Home Tour (`home-tour.ts`)

**ID:** `home_tour`
**Prerequisite:** none
**Trigger:** Auto-starts in `HomeView` after a 1200ms delay on first visit after onboarding.

| Step | Element | Description |
|------|---------|-------------|
| 1 | *(none — centered popover)* | Welcome message |
| 2 | `[data-tutorial="collection-carousel"]` | Explains sentence collections |
| 3 | `[data-tutorial="start-learning"]` | Explains Full Review vs Audio Review (buttons disabled during this step) |
| 4 | *(none — centered popover)* | Closing message: review difficulty, pick a mode |

**Integration:** `components/app/HomeView.tsx` calls `useTutorial(TUTORIAL_IDS.HOME_TOUR)`.

### Audio Review Tour (`audio-review-tour.ts`)

**ID:** `audio_review_intro`
**Prerequisite:** `home_tour`
**Trigger:** Auto-starts in `LearnView` when `reviewMode === 'audio'` and `state.status === 'reviewing'`.

| Step | Element | Description |
|------|---------|-------------|
| 1 | *(none — centered popover)* | Welcome to Audio Review |
| 2 | `[data-tutorial="card-content"]` | The card: base and target, optional blur |
| 3 | `[data-tutorial="target-text-audio"]` | First target text: click to unblur |
| 4 | `[data-tutorial="rating-buttons"]` | Initial reviews, "Understood" skips them; then Again / Hard / Good / Easy |
| 5 | `[data-tutorial="settings-button"]` | Audio mode settings (speed, order, auto-advance, blur, etc.) |
| 6 | `[data-tutorial="chat-button"]` | Chat: grammar, explanations, create cards |

### Full Review Tour (`full-review-tour.ts`)

**ID:** `full_review_intro`
**Prerequisite:** `home_tour`
**Trigger:** Auto-starts in `LearnView` when `reviewMode === 'full'` and `state.status === 'reviewing'`.

| Step | Element | Description |
|------|---------|-------------|
| 1 | *(none — centered popover)* | Welcome to Full Review |
| 2 | `[data-tutorial="card-content-full"]` | The card: type translation, get feedback |
| 3 | `[data-tutorial="base-languages"]` | Base language sentence(s) |
| 4 | `[data-tutorial="target-input-full"]` | First target input: enter translation |
| 5 | `[data-tutorial="submit-answer"]` | Submit to get feedback (diff, accuracy) |
| 6 | `[data-tutorial="rating-buttons"]` | Rate answer: Again, Hard, Good, Easy |
| 7 | `[data-tutorial="settings-button"]` | Full review settings (target audio, instant proceed, mode switch) |
| 8 | `[data-tutorial="chat-button"]` | Chat: grammar, explanations, create cards |

---

## data-tutorial Attributes

These attributes are placed on components to serve as driver.js selectors.

| Attribute | Component | File |
|-----------|-----------|------|
| `collection-carousel` | Section wrapper (heading + carousel) | `HomeView.tsx` |
| `active-collection` | The currently active collection card | `CollectionCarouselUI.tsx` |
| `collection-detail` | Collection detail dialog content | `CollectionDetailDialog.tsx` |
| `progress-stats` | Progress stats card | `ProgressStatsCard.tsx` |
| `start-learning` | Learning mode buttons wrapper | `StartLearningButton.tsx` |
| `card-content` | Audio review card wrapper | `LearningCardContent.tsx` |
| `target-text-audio` | First target translation block (click to unblur) | `LearningCardContent.tsx` |
| `card-content-full` | Full review card wrapper | `FullReviewCardContent.tsx` |
| `base-languages` | Base language texts wrapper | `CardShell.tsx` |
| `target-input-full` | First target input wrapper (full review) | `FullReviewCardContent.tsx` |
| `submit-answer` | Submit-answer button (first target, full review) | `FullReviewCardContent.tsx` |
| `rating-buttons` | Rating buttons row | `LearningControls.tsx` |
| `chat-button` | Chat open button (mobile) | `LearningControls.tsx` |
| `settings-button` | Settings button | `LearningHeader.tsx` |

---

## Styling

Tutorial popover styles are in `app/globals.css` under the `driver.js tutorial overrides` section. The styles use CSS variables from the app's theme so popovers match the app's design:

- Background: `hsl(var(--card))`
- Text: `hsl(var(--card-foreground))`
- Next button: `hsl(var(--primary))` background
- Previous button: outline style with `hsl(var(--border))`
- Close button: `hsl(var(--muted-foreground))`

The driver instance is configured with `stagePadding: 8` and `stageRadius: 8` for visual spacing around highlighted elements.

---

## How to Add a New Tutorial

### 1. Create the tour file

Create `lib/tutorials/my-new-tour.ts`:

```typescript
import type { DriveStep } from 'driver.js';
import type { TutorialDefinition } from './types';

export function createMyNewTour(): TutorialDefinition {
  const steps: DriveStep[] = [
    {
      element: '[data-tutorial="my-element"]',
      popover: {
        title: 'Step Title',
        description: 'Step description.',
        side: 'bottom',
        align: 'center',
      },
    },
    // ... more steps
  ];

  return {
    id: 'my_new_tour',
    prerequisite: 'home_tour',  // optional
    steps,
  };
}
```

### 2. Register it

In `registry.ts`:

```typescript
import { createMyNewTour } from './my-new-tour';

registerTutorial(createMyNewTour());

export const TUTORIAL_IDS = {
  // ... existing
  MY_NEW_TOUR: 'my_new_tour',
} as const;
```

### 3. Add data-tutorial attributes

On the target component(s):

```tsx
<div data-tutorial="my-element">...</div>
```

### 4. Trigger it

In the component where the tutorial should auto-start:

```tsx
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';
import 'driver.js/dist/driver.css';

function MyComponent() {
  useTutorial(TUTORIAL_IDS.MY_NEW_TOUR, {
    enabled: someCondition,
    delayMs: 1000,
  });
  // ...
}
```

### 5. Interactive steps

To pause the tutorial and let the user interact (e.g., complete a card), mark the step with `popoverClass: 'tutorial-try-card'` and use the `onInteractiveStep` callback:

```typescript
useTutorial(TUTORIAL_IDS.MY_NEW_TOUR, {
  onInteractiveStep: () => {
    // The hook's moveToInteractiveWait() destroys the overlay.
    // Watch for a condition (e.g., card ID change) to show
    // a completion popover via showCompletionStep().
    moveToInteractiveWait();
  },
});
```

### 6. Disabling interaction during a step

Use `onPopoverRender` on the step to disable clicks, and clean up in the next step:

```typescript
{
  element: '[data-tutorial="some-buttons"]',
  popover: {
    title: 'Look but don\'t touch',
    description: '...',
    onPopoverRender: () => {
      const el = document.querySelector<HTMLElement>('[data-tutorial="some-buttons"]');
      if (el) el.style.pointerEvents = 'none';
    },
  },
},
{
  popover: {
    title: 'Next step',
    description: '...',
    onPopoverRender: () => {
      const el = document.querySelector<HTMLElement>('[data-tutorial="some-buttons"]');
      if (el) el.style.pointerEvents = '';
    },
  },
},
```

---

## Testing

The `HomeView` includes two testing buttons (intended for development):

- **Restart Home Tutorial** — calls `resetTutorials()`, then `clearTutorialsLocalStorage()`, then restarts the home tour after a short delay
- **Reset All Tutorials** — calls `resetTutorials()` and `clearTutorialsLocalStorage()` so all tutorials will trigger again on their next natural condition (e.g., entering a learning mode)

The `resetTutorials` mutation clears `completedTutorials` in the DB; `clearTutorialsLocalStorage()` clears the localStorage cache so the hook’s effective completed list stays in sync.
