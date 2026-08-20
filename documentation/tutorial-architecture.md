# Tutorial System Architecture

This document describes the implemented tutorial system, how it works, how to modify existing tutorials, and how to add new ones.

---

## Overview

The teaching layer uses [driver.js](https://driverjs.com/) and has two parts
(since 2026-08, when the onboarding wizard stopped embedding a tutorial
lesson):

1. **Tours** (`useTutorial`) — multi-step walkthroughs registered in
   `registry.ts`. Only `home_tour` remains; the review-mode tours were
   retired in favour of the tips below.
2. **Learning-mode tips** (`useMilestoneTips`) — one-time popovers inside
   the real learning session: an intro walkthrough on the first card
   (persisted PER CONCEPT so switching review modes never re-explains
   shared concepts) and milestone tips gated on lifetime reviews
   (card actions @2, chat @5, word tap @8, try-the-other-mode @11,
   settings @15). A veteran guard silently retires all tips for users whose
   lifetime review count is already far past the thresholds.

Shared traits:

- **Persistent** — completion state is stored in `userSettings.completedTutorials` (Convex) and cached in localStorage (`phrasis_completed_tutorials`) to avoid a database call on every load once tutorials have run (shared plumbing: `useCompletedTutorials` in `use-tutorial.ts`)
- **Prerequisite-aware** — a tour can require another to be completed first
- **Auto-triggered** — the hooks start automatically when conditions are met

---

## File Structure

```
lib/tutorials/
├── types.ts               — TutorialDefinition / TutorialFactory / TranslateFn types
├── tour-step.ts           — tourStep() helper: builds a DriveStep from an i18n key prefix
├── registry.ts            — Central registry (tours only); re-exports TUTORIAL_IDS
├── use-tutorial.ts        — Tour lifecycle hook + shared useCompletedTutorials
├── use-milestone-tips.ts  — One-time learning-mode tips (intro concepts + milestones)
└── home-tour.ts           — Home screen overview tour
```

---

## Core Concepts

### TutorialDefinition (`types.ts`)

```typescript
interface TutorialDefinition {
  id: string;              // Unique ID stored in completedTutorials
  steps: DriveStep[];      // driver.js step configuration
  prerequisite?: string;   // ID of a tutorial that must complete first
  popoverClass?: string;   // Optional extra CSS class for the popovers
}
```

Tutorials are defined as **factories** (`TutorialFactory = (t: TranslateFn) => TutorialDefinition`) so step titles and descriptions come from `next-intl` — `useTutorial` calls `useTranslations('Tutorial')` and passes `t` through to the factory.

### Registry (`registry.ts`)

All tutorial factories live in a static `tutorialFactories` record (tutorial ID → factory) inside `registry.ts`. The registry exposes:

- `getTutorial(id, t)` — look up the factory for `id` (own keys only, so prototype keys like `toString` never resolve) and invoke it with a translate function; returns the `TutorialDefinition` (or `undefined` for unknown IDs)
- `TUTORIAL_IDS` — typed constant object for referencing IDs. It lives in `convex/features/tutorialIds.ts` (single source of truth shared with the backend's `tutorialIdValidator`) and is re-exported by `registry.ts`

```typescript
// convex/features/tutorialIds.ts (re-exported by lib/tutorials/registry.ts)
export const TUTORIAL_IDS = {
  HOME_TOUR: 'home_tour',
  // retired tour ids kept valid for historical rows, plus the tip_* ids
  // used by useMilestoneTips — see the file for the full list
  ...
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
    extraSteps: [...],  // Extra DriveSteps appended after the tour's own steps
    onInteractiveStep: () => { ... },  // Called when a "try card" step is reached
    onComplete: () => { ... },         // Called when the tutorial finishes
    stepCompleteOnClickIndex: 2,       // Clicking the highlighted element on this
                                       // step (0-based) completes the tour and
                                       // closes the driver (HomeView uses this)
  }
);
```

**Auto-start logic:**

The hook uses an effective completed list: Convex `getCompletedTutorials` when available, otherwise the localStorage cache. It auto-starts when all of these are true:
1. `enabled` is `true`
2. The tutorial is not already in the effective completed list
3. The prerequisite tutorial (if any) is in the effective completed list
4. Either the Convex query has returned or the localStorage cache has a value (so we don’t start before we know completion state)

When Convex returns, the result is written to localStorage. When a tutorial is completed via `completeTutorial`, the mutation runs and the ID is appended to localStorage so the UI stays in sync.

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

### Learning-mode tips (`use-milestone-tips.ts`)

**IDs:** `tip_concept_*` (intro concepts) and `tip_card_actions` / `tip_chat`
/ `tip_word_tap` / `tip_mode_switch` / `tip_settings` (milestones).
**Trigger:** `LearnView` calls `useMilestoneTips({ enabled, reviewMode, transcribe, … })`
with `enabled` gated on `state.status === 'reviewing' && !settingsOpen &&
!isFreePlay && !difficultyDialogOpen` (held back while the one-time
difficulty-check dialog is up so a popover can't stack on top of it).

- The **intro walkthrough** fires on the first card of a mode and shows only
  concepts not yet persisted: shared concepts (`tip_concept_card`,
  `tip_concept_autoadd`) appear once ever, mode-specific ones
  (reveal/audio-controls/rating for Shadowing; shown-translation/input/rating
  for Writing) per mode. Switching modes later shows a "Switched to …"
  welcome plus only the new mode's concepts. Concepts can opt out of the
  Transcribe writing style via `skipWhenTranscribe` (the shown-translation
  step does — skipped, not persisted, so it still appears if the user later
  switches to Translate).
- **Milestone tips** are single popovers gated on
  `api.features.courses.getLifetimeReviewCount` (the active course's
  `courseStats.totalRepetitions`, reactive) — at most one per card
  transition, lowest threshold first.
- **Veteran guard:** if a tip becomes eligible while the lifetime count is
  already `> 50`, every unseen tip is marked completed silently (no
  popover, no analytics event) — this is what keeps existing users from
  seeing beginner tips, with no data migration.
- Popover CSS classes are `phrasis-tip-<id>` (`phrasis-tip-intro_audio` /
  `phrasis-tip-intro_full` for the intro walkthroughs) — e2e helpers map
  legacy tour ids onto these.
- Copy lives in the `Tips` namespace of `messages/en.json` / `de.json`.
- The learn header's Help dialog "restart tutorial" action calls the hook's
  `restartIntro` (replays the current mode's full intro).

### Difficulty check (`useDifficultyCheck.ts`)

**ID:** `difficulty_check`
**Trigger:** Before the FIRST auto-add of new cards in the learn view, the
hook's `pending` signal holds the add (`useLearningMode({ holdAutoAdd })`);
the `DifficultyCheckDialog` opens when the hold actually intercepts an add.

Not a driver.js tour — a regular dialog whose show-once state rides the
shared `completedTutorials` mechanism, with the same veteran rule as the
milestone tips (lifetime reviews past the beginner window retire it
silently). Skipped entirely — and not marked completed — when the active
collection isn't a dataset level (custom/chat/legacy CEFR), so the check
still fires if the user later moves onto one.

---

## data-tutorial Attributes

These attributes are placed on components to serve as driver.js selectors.

Home (the home tour):

| Attribute | Component | File |
|-----------|-----------|------|
| `collection-carousel` | Section wrapper (heading + carousel) | `SegmentedHomeSection.tsx` |
| `collection-detail` | Collection detail dialog content | `CollectionDetailDialog.tsx` |
| `progress-stats` | Progress stats card | `ProgressStatsCard.tsx` |
| `start-learning` | Learning mode buttons wrapper | `StartLearningButton.tsx` |
| `learn-and-review` / `learn-new` / `radio-mode` / `free-study-mode` | Individual mode buttons (via the `tutorial:` prop) | `StartLearningButton.tsx` |
| `review-mode-toggle` | Shadowing↔Writing toggle | `StartLearningButton.tsx` |
| `due-counts` | Due-count pills | `DueCountsPills.tsx` |
| `content-source-filter` | Content filter dropdown trigger | `ContentFilterDropdown.tsx` |
| `projections` | Rotating projection block | `RotatingProjection.tsx` |

Learn view (the in-lesson tips):

| Attribute | Component | File |
|-----------|-----------|------|
| `card-flashcard` | Card surface wrapper | `CardShell.tsx` |
| `base-languages` | Base language texts wrapper | `CardShell.tsx` |
| `card-content` | Audio review card wrapper | `LearningCardContent.tsx` |
| `target-text-audio` | First target translation block (click to unblur) | `LearningCardContent.tsx` |
| `card-content-full` | Full review card wrapper | `FullReviewCardContent.tsx` |
| `target-input-full` | First target input wrapper (full review) | `FullReviewCardContent.tsx` |
| `target-input-and-submit` | First target input + submit row (full review) | `FullReviewCardContent.tsx` |
| `submit-answer` | Submit-answer button (first target, full review) | `FullReviewCardContent.tsx` |
| `audio-controls` | Audio controls row | `LearningControls.tsx` |
| `audio-play` | Play/pause button | `LearningControls.tsx` |
| `rating-buttons` | Rating buttons row | `LearningControls.tsx` |
| `undo-restart` | Undo/restart buttons | `LearningControls.tsx` |
| `chat-button` | Chat open button (mobile) | `LearningMode.tsx` |
| `settings-button` | Settings button | `LearningHeader.tsx` |

The tips also anchor on selectors outside the `data-tutorial` namespace:
`[data-coachmark-anchor="card-actions"]` (`CardActionsMenu.tsx`),
`[data-coachmark-anchor="word-tap"]` (the longest base-language word, tagged
via `ClickableWords`/`CardShell`), `[data-coachmark-anchor="chat-button-desktop"]`
(`LearningChatLayout.tsx`), and `[data-testid="first-exposure-answer"]`
(the shown translation on new cards, `FullReviewCardContent.tsx`).

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

Create `lib/tutorials/my-new-tour.ts`. The factory receives a translate
function (`Tutorial` namespace in `messages/en.json` / `de.json`). Build
steps with `tourStep(t, key, element?, side?, align?)`, which reads
`${key}.title` / `${key}.description`; omit `element`/`side`/`align` for a
centered modal-style popover. Raw `DriveStep` literals are still fine for
special cases (e.g. an empty description or `onPopoverRender` hooks):

```typescript
import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';
import { tourStep } from './tour-step';

export function createMyNewTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    tourStep(t, 'myNewTour.welcome'),  // centered welcome popover
    tourStep(t, 'myNewTour.step1', '[data-tutorial="my-element"]', 'bottom', 'center'),
    // ... more steps
  ];

  return {
    id: 'my_new_tour',
    prerequisite: 'home_tour',  // optional
    steps,
  };
}
```

### 2. Add the ID

In `convex/features/tutorialIds.ts` (single source of truth, shared with the backend):

```typescript
export const TUTORIAL_IDS = {
  // ... existing
  MY_NEW_TOUR: 'my_new_tour',
} as const;
```

Also add the matching `v.literal('my_new_tour')` to `tutorialIdValidator` in the same file.

### 3. Register it

In `registry.ts`, add an entry to the static `tutorialFactories` record:

```typescript
import { createMyNewTour } from './my-new-tour';

const tutorialFactories: Record<string, TutorialFactory> = {
  // ... existing entries
  my_new_tour: createMyNewTour,
};
```

### 4. Add data-tutorial attributes

On the target component(s):

```tsx
<div data-tutorial="my-element">...</div>
```

### 5. Trigger it

In the component where the tutorial should auto-start (`driver.js/dist/driver.css` is already imported globally in `app/globals.css`):

```tsx
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';

function MyComponent() {
  useTutorial(TUTORIAL_IDS.MY_NEW_TOUR, {
    enabled: someCondition,
    delayMs: 1000,
  });
  // ...
}
```

### 6. Interactive steps

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

### 7. Disabling interaction during a step

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

There is no reset mutation or reset button. To make tutorials auto-fire again, clear `completedTutorials` on the user's `userSettings` doc (Convex dashboard) and remove the per-user localStorage cache (`phrasis_completed_tutorials_<userId>`) in the browser devtools.

To re-run a tour without resetting completion state, `useTutorial` returns `restartTutorial` (destroys any active driver instance and relaunches the tour):

- `HomeView` passes its `restartTutorial` up via the `onTutorialReady` prop; the main layout (`app/app/(main)/layout.tsx`) stores it in a ref and wires it to `HelpDialog`'s `onRestartTutorial` action (home view only).
- `LearnView` passes `restartTutorial` into the learning UI as `onRestartTutorial`.
