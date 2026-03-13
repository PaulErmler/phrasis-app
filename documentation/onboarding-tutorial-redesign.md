# Onboarding & Tutorial Redesign — Agent Context Document

This document provides everything needed to implement the redesigned onboarding and post-onboarding tutorial system.

---

## 1. Libraries to Use

### Onboarding: onboardjs

- **Repo**: https://github.com/Somafet/onboardjs
- **Purpose**: Replace the current custom wizard with onboardjs for a more polished multi-step onboarding experience
- **Install**: The user will add the required packages

### Tutorial: driver.js

- **Repo / Docs**: https://driverjs.com/
- **Purpose**: Guided product tours triggered after onboarding and by specific user actions
- **Install**: The user will add the required packages

---

## 2. Current Onboarding — What Exists

### Files to modify

| File | Purpose |
|------|---------|
| `app/app/onboarding/page.tsx` | Main 7-step onboarding page |
| `app/app/onboarding/types.ts` | `OnboardingData`, `LearningStyle`, `ReviewMode`, `CurrentLevel` types |
| `app/app/onboarding/onboarding_steps/WelcomeStep.tsx` | Step 1: Welcome greeting (TO BE REMOVED) |
| `app/app/onboarding/onboarding_steps/LearningStyleStep.tsx` | Step 2: Casual/Focused/Advanced choice (TO BE REMOVED) |
| `app/app/onboarding/onboarding_steps/ReviewModeStep.tsx` | Step 3: Audio vs Full review mode |
| `app/app/onboarding/onboarding_steps/TargetLanguagesStep.tsx` | Step 4: Target language selection |
| `app/app/onboarding/onboarding_steps/CurrentLevelStep.tsx` | Step 5: Difficulty/CEFR level selection |
| `app/app/onboarding/onboarding_steps/BaseLanguagesStep.tsx` | Step 6: Base language selection |
| `app/app/onboarding/onboarding_steps/LoadingStep.tsx` | Step 7: "You're all set!" final step |

### Current flow (7 steps)

1. **Welcome** — greeting, "Get Started" button → **REMOVE**
2. **Learning Style** — casual / focused / advanced → **REMOVE**
3. **Review Mode** — full review vs audio review → **KEEP** (may reorder)
4. **Target Languages** — select one target language → **KEEP**
5. **Current Level** — beginner/elementary/intermediate/upper_intermediate/advanced → **REDESIGN** (word frequency based)
6. **Base Languages** — select one base language → **KEEP** (reorder to be first or second)
7. **Loading/Finish** — "Start Learning" button → **KEEP/ADAPT**

### Current types (`app/app/onboarding/types.ts`)

```typescript
export type LearningStyle = 'casual' | 'focused' | 'advanced';
export type ReviewMode = 'audio' | 'full';
export type CurrentLevel = 'beginner' | 'elementary' | 'intermediate' | 'upper_intermediate' | 'advanced';

export interface OnboardingData {
  learningStyle: LearningStyle | null;
  reviewMode: ReviewMode | null;
  targetLanguages: string[];
  currentLevel: CurrentLevel | null;
  baseLanguages: string[];
}
```

### Backend types (`convex/types.ts`)

```typescript
export const learningStyleValidator = v.union(v.literal('casual'), v.literal('focused'), v.literal('advanced'));
export const currentLevelValidator = v.union(v.literal('beginner'), v.literal('elementary'), v.literal('intermediate'), v.literal('upper_intermediate'), v.literal('advanced'));
export const reviewModeValidator = v.union(v.literal('audio'), v.literal('full'));
```

### Backend mutations (`convex/features/courses.ts`)

- `saveOnboardingProgress` — upserts step + data to `onboardingProgress` table
- `completeOnboarding` — creates course, deck, courseSettings; sets `hasCompletedOnboarding: true`; maps `currentLevel` → collection via `LEVEL_TO_COLLECTION`

### Schema tables involved

- `onboardingProgress` — temporary: `userId`, `step`, `learningStyle`, `reviewMode`, `currentLevel`, `targetLanguages`, `baseLanguages`
- `userSettings` — `userId`, `hasCompletedOnboarding`, `learningStyle`, `activeCourseId`
- `courses` — `userId`, `baseLanguages`, `targetLanguages`, `currentLevel`
- `courseSettings` — `courseId`, `initialReviewCount`, `activeCollectionId`, `reviewMode`, ...

### Level-to-Collection mapping (`convex/lib/collections.ts`)

```typescript
export const LEVEL_TO_COLLECTION: Record<string, string> = {
  beginner: 'Essential',
  elementary: 'A2',
  intermediate: 'B1',
  upper_intermediate: 'B2',
  advanced: 'C1',
};

export const LEVEL_ORDER = ['Essential', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
```

### Shared component: DifficultySelector (`components/course/DifficultySelector.tsx`)

A reusable list of difficulty buttons. Props: `title`, `subtitle`, `selectedLevel`, `onSelectLevel`, `levelOptions` (array of `{ id, icon, title, description }`). Also used by `CreateCourseDialog`.

### Shared component: LanguageSelector (`components/course/LanguageSelector.tsx`)

Reusable language picker. Props: `title`, `subtitle`, `selectedLanguages`, `excludeLanguages`, `onToggleLanguage`, `multiSelect`. Uses `SUPPORTED_LANGUAGES` from `lib/languages.ts`.

### i18n strings (`messages/en.json`, namespace "Onboarding")

All text is internationalized under `Onboarding.*`. The current keys include `welcome`, `step1` (learning style), `reviewMode`, `step2` (target lang), `step3` (base lang), `step4` (level), `continue`, `back`, `getStarted`, `finish`, `loading`, `finished`.

---

## 3. New Onboarding Design

### New flow (using onboardjs)

1. **Base Language** — "What language will you learn from?" (reuse `LanguageSelector`, single select)
2. **Target Language** — "What language do you want to learn?" (reuse `LanguageSelector`, single select)
3. **Difficulty** — Word-frequency based difficulty selection (see below)
4. **Review Mode** — Full Review vs Audio Review (reuse `ReviewModeStep`)
5. **Finish** — "You're all set!" (reuse/adapt `LoadingStep`)

### Steps removed

- Welcome greeting (step 1) — removed to start sooner
- Learning Style / customization level (step 2) — removed entirely

### Reactive feedback

When the user selects an option (e.g., picks a language or difficulty), show reactive feedback (animation, confirmation text, or visual response) confirming their choice before they continue.

### Difficulty selection redesign

Replace CEFR labels (A1–C2) with word-frequency descriptions. The `currentLevel` type values (`beginner`, `elementary`, etc.) should remain the same for backend compatibility, but the UI labels change:

| Level Value | New UI Label | Description | Word Count |
|-------------|-------------|-------------|-----------|
| `beginner` | Absolute Beginner | "I know almost no words" | ~0 words |
| `elementary` | Basic | "I know the most common words" | ~500 words |
| `intermediate` | Elementary | "I can understand common phrases" | ~1,000 words |
| `upper_intermediate` | Intermediate | "I understand everyday conversations" | ~2,000 words |
| `advanced` | Upper Intermediate | "I can discuss many topics" | ~3,500 words |
| *(new level needed or map to advanced)* | Advanced | "I have a broad vocabulary" | ~5,000 words |
| *(new level needed or map to advanced)* | Proficient | "I know 5,000+ words" | 5,000+ words |

**IMPORTANT**: The current `currentLevel` type only has 5 values. The new design wants 7 difficulty tiers. Options:
- Add new values (`basic`, `proficient`) to the `currentLevelValidator` in `convex/types.ts` and update the `LEVEL_TO_COLLECTION` mapping
- OR collapse "Advanced" and "Proficient" into the existing `advanced` value but display differently
- The `Essential` collection stays unchanged for "Absolute Beginner"

The `LEVEL_TO_COLLECTION` mapping needs to be updated to match:

| New Level | Collection |
|-----------|-----------|
| Absolute Beginner (~0 words) | Essential |
| Basic (~500 words) | A1 |
| Elementary (~1,000 words) | A2 |
| Intermediate (~2,000 words) | B1 |
| Upper Intermediate (~3,500 words) | B2 |
| Advanced (~5,000 words) | C1 |
| Proficient (5,000+ words) | C2 |

This also affects `CreateCourseDialog` (`components/course/CreateCourseDialog.tsx`) which reuses `DifficultySelector` — it should get the same new labels.

### Add initial sentences from selected difficulty

After onboarding completes, the first 5 sentences from the user's selected difficulty collection should be automatically added to their deck. This happens in `completeOnboarding` — after creating the course/deck, call `addCardsFromCollection` (from `convex/features/decks.ts`) with `batchSize: 5` for the active collection.

---

## 4. Post-Onboarding Tutorial System (driver.js)

### Architecture Requirements

- Tutorials should be modular and cleanly separated so individual tutorials can be easily adapted
- Only implement in English for now (German will be added later)
- Track which tutorials the user has completed (new DB table or field on `userSettings`)
- Tutorials are triggered by specific conditions (first app load after onboarding, first time entering a learning mode, navigation events)

### Tutorial tracking

Add a field to `userSettings` or create a new table to track completed tutorials:

```typescript
// Option A: field on userSettings
completedTutorials: v.optional(v.array(v.string())), // e.g. ["home_overview", "audio_review_intro", "full_review_intro", "chat_intro"]

// Option B: separate table
tutorialProgress: defineTable({
  userId: v.string(),
  tutorialId: v.string(),
  completedAt: v.number(),
}).index('by_userId', ['userId'])
```

### Tutorial 1: Home Screen Overview

**Trigger**: First time the user reaches the home screen after onboarding.

**Steps**:

1. **Highlight: Collection Carousel** (`components/app/CollectionCarousel.tsx` / `CollectionCarouselUI.tsx`)
   - Explain what collections are ("These are your sentence collections, organized by difficulty")
   - Guide the user to open/tap a collection

2. **Highlight: Collection Detail Dialog** (`components/app/CollectionDetailDialog.tsx`)
   - Show the future sentences preview
   - Ask the user: "Do these sentences seem appropriate for your level, or are they too difficult?"
   - If too difficult → guide them to change the active collection to an easier one (select a different collection in the carousel)

3. **Highlight: Progress Stats Card** (`components/app/ProgressStatsCard.tsx`)
   - Explain the stats: streak, repetitions, sentences, time

4. **Highlight: Start Learning Buttons** (`components/app/StartLearningButton.tsx`)
   - Explain the two learning modes:
     - **Full Review**: "Practice writing by typing translations"
     - **Audio Review**: "Listen and recall — great for learning on the go"
   - Ask the user to choose one to start

### Tutorial 2: Learning Mode Introduction (per mode)

**Trigger**: First time the user enters a specific learning mode (audio review or full review). There should be separate tutorial sequences for each mode.

**Steps for Audio Review** (`tutorial_id: "audio_review_intro"`):

1. **Highlight: Flashcard content area** (`LearningCardContent` in `components/app/learning/LearningCardContent.tsx`)
   - Explain the card layout: base language text on top, target language text below (possibly hidden)
   - Explain audio buttons for each language

2. **Highlight: Rating buttons** (in `LearningControls` → rating buttons section)
   - Explain pre-review ratings: "Still learning" vs "Understood"
   - Explain that after enough reviews, they'll see FSRS ratings (Again/Hard/Good/Easy)

3. **Highlight: Settings button** (in `LearningHeader` → Settings icon)
   - Explain that they can customize playback speed, language order, auto-advance, etc.

4. **Audio-mode specifics**:
   - Explain hide/blur target text feature
   - Explain auto-advance and auto-play features

5. **Guide through one card**:
   - Listen to the audio
   - Rate the card
   - Proceed to the next card

6. **Highlight: Chat button** (in `LearningControls` → MessageCircle button, mobile; sidebar on desktop)
   - ONLY on the first learning mode tutorial (not repeated for the second mode)
   - Explain: "Use the chat to ask about grammar, get explanations, or create new flashcards"

**Steps for Full Review** (`tutorial_id: "full_review_intro"`):

1. **Highlight: Flashcard content area** (`FullReviewCardContent` in `components/app/learning/FullReviewCardContent.tsx`)
   - Explain: base language shown, user types the target language translation
   - Explain the diff display (green = correct, red = mistakes, gray = missing)

2. **Highlight: Rating buttons**
   - In full review mode, all cards use FSRS ratings (Again/Hard/Good/Easy) — no pre-review phase

3. **Highlight: Settings button**
   - Explain target audio settings (after submit, always, never)

4. **Full-review specifics**:
   - Explain the text input and submit flow
   - Explain accuracy percentage

5. **Guide through one card**:
   - Type a translation
   - Submit and see the diff
   - Rate the card
   - Proceed to the next card

6. **Highlight: Chat button** (only if not shown in a previous learning mode tutorial)

### Tutorial 3+: Navigation-Triggered Tutorials

These are future tutorials triggered by specific user navigation. Design the system so adding new ones is straightforward:

```typescript
interface TutorialDefinition {
  id: string;
  trigger: 'onMount' | 'onNavigate' | 'onAction';
  triggerCondition?: string; // e.g., route path or action name
  steps: TutorialStep[];
  prerequisite?: string; // another tutorial ID that must be completed first
}
```

---

## 5. Key Files Reference

### Onboarding (modify/replace)

| File | Purpose |
|------|---------|
| `app/app/onboarding/page.tsx` | Main onboarding page — replace wizard with onboardjs |
| `app/app/onboarding/types.ts` | Types — update `OnboardingData`, possibly add new level values |
| `app/app/onboarding/onboarding_steps/WelcomeStep.tsx` | DELETE — no welcome step |
| `app/app/onboarding/onboarding_steps/LearningStyleStep.tsx` | DELETE — no learning style step |
| `app/app/onboarding/onboarding_steps/ReviewModeStep.tsx` | KEEP — review mode selection |
| `app/app/onboarding/onboarding_steps/TargetLanguagesStep.tsx` | KEEP — target language selection |
| `app/app/onboarding/onboarding_steps/CurrentLevelStep.tsx` | REDESIGN — word frequency labels |
| `app/app/onboarding/onboarding_steps/BaseLanguagesStep.tsx` | KEEP — base language selection |
| `app/app/onboarding/onboarding_steps/LoadingStep.tsx` | KEEP/ADAPT — finish step |

### Backend (modify)

| File | Purpose |
|------|---------|
| `convex/types.ts` | May need new `currentLevel` values |
| `convex/schema.ts` | Add tutorial tracking field/table; update `onboardingProgress` step count |
| `convex/features/courses.ts` | Update `saveOnboardingProgress`, `completeOnboarding` (add initial 5 cards) |
| `convex/lib/collections.ts` | Update `LEVEL_TO_COLLECTION` mapping for new difficulty tiers |
| `convex/features/decks.ts` | `addCardsFromCollection` — called during `completeOnboarding` |

### Shared components (modify)

| File | Purpose |
|------|---------|
| `components/course/DifficultySelector.tsx` | Update labels to word-frequency based |
| `components/course/LanguageSelector.tsx` | No changes needed (reuse as-is) |
| `components/course/CreateCourseDialog.tsx` | Gets new difficulty labels automatically via DifficultySelector |

### Tutorial target components (highlight with driver.js)

| Component | File | CSS selectors / element IDs to target |
|-----------|------|--------------------------------------|
| Collection Carousel | `components/app/CollectionCarouselUI.tsx` | Add `data-tutorial="collection-carousel"` |
| Collection Detail Dialog | `components/app/CollectionDetailDialog.tsx` | Add `data-tutorial="collection-detail"` |
| Progress Stats Card | `components/app/ProgressStatsCard.tsx` | Add `data-tutorial="progress-stats"` |
| Start Learning Buttons | `components/app/StartLearningButton.tsx` | Add `data-tutorial="start-learning"` |
| Learning Card Content (audio) | `components/app/learning/LearningCardContent.tsx` | Add `data-tutorial="card-content"` |
| Learning Card Content (full) | `components/app/learning/FullReviewCardContent.tsx` | Add `data-tutorial="card-content-full"` |
| Rating Buttons | `components/app/learning/LearningControls.tsx` | Add `data-tutorial="rating-buttons"` |
| Play/Next Controls | `components/app/learning/LearningControls.tsx` | Add `data-tutorial="playback-controls"` |
| Chat Button (mobile) | `components/app/learning/LearningControls.tsx` | Add `data-tutorial="chat-button"` |
| Settings Button | `components/app/learning/LearningHeader.tsx` | Add `data-tutorial="settings-button"` |
| Learning Settings Panel | `components/app/LearningModeSettings.tsx` | Add `data-tutorial="learning-settings"` |

### Home screen layout (for tutorial context)

```
HomeView (components/app/HomeView.tsx)
├── ProgressStatsCard — stats + StartLearningButton (Full Review / Audio Review)
├── NewChatInput — quick chat entry
├── CollectionCarousel — difficulty collections (Essential → C2)
└── CustomCollectionCarousel — user-created collections
```

### Learning view layout (for tutorial context)

```
LearnView (components/app/learning/LearnView.tsx)
├── LearningHeader — back, info popover, theme, settings
├── LearningChatLayout — wraps learning + chat panel
│   ├── LearningMode — card + controls
│   │   ├── LearningCardContent (audio mode) / FullReviewCardContent (full mode)
│   │   ├── LearningControls — ratings, progress bar, play/next, chat button
│   │   └── LearningModeSettings (sheet)
│   └── ChatPanel (sidebar/slide)
```

### Main layout navigation context

```
MainLayout (app/app/(main)/layout.tsx)
├── Header — course button (home) / view title (other tabs) + theme switcher
├── Main — tab content (home / content / library / settings)
├── BottomNav — Home, Content, [Play], Library, Settings
└── LearnView overlay (z-50, full screen)
```

---

## 6. Authentication & Redirect Flow

1. User signs up/logs in at `/auth/[path]`
2. Redirected to `/app/onboarding`
3. Onboarding completes → `hasCompletedOnboarding: true` → redirect to `/app`
4. `MainLayout` checks `hasCompletedOnboarding === false` → redirects back to `/app/onboarding`

After onboarding, the tutorial system takes over on the home screen.

---

## 7. i18n Notes

- All strings must use `next-intl` (`useTranslations`)
- For now, only add English strings
- Tutorial strings should go under a new `Tutorial` namespace in `messages/en.json`
- Onboarding strings are under the `Onboarding` namespace
- Difficulty selector strings are under `Onboarding.step4` and need updating

---

## 8. Styling Notes

Follow the style guide (`documentation/style_guide.md`):

- Use Tailwind CSS v4 + shadcn/ui components
- Cards: `rounded-xl border bg-card shadow-sm` or `Card` component
- Page layout: `max-w-xl mx-auto space-y-6`
- Sheet headers: `sticky top-0 z-10 border-b bg-background px-4 h-14 flex items-center justify-between`
- Icons: `h-4 w-4` (standard), `h-5 w-5` (large)
- Buttons: see style guide for variants
- Animations: the app uses `motion` (Framer Motion) for transitions

---

## 9. Word Frequency Context

The data pipeline (`data_preparation/language_intelligence/spacy_classifier.py`) already maps word ranks to difficulty:

The authoritative source for collection boundaries is `data_preparation/dataset_creation.py::SAMPLING_CONFIG`, which filters sentences by their **max word rank** (the highest-ranked word in the sentence):

| Collection | max_max_rank | Meaning |
|-----------|-------------|---------|
| Essential | 30000 | Curated survival sentences (rank is not the filter) |
| A1 | 500 | All words among the 500 most common |
| A2 | 2000 | Hardest word in top 2000 |
| B1 | 5000 | Hardest word in top 5000 |
| B2 | 10000 | Hardest word in top 10000 |
| C1 | 10000 | Hardest word 5000–10000 (min_max_rank=5000) |
| C2 | 20000 | Hardest word 8000–20000 |

Per-word CEFR (`spacy_classifier.py::get_cefr_from_rank`) maps individual word ranks: ≤500→A1, ≤1000→A2, ≤2000→B1, ≤5000→B2, ≤10000→C1, >10000→C2.

The onboarding difficulty tiers should be based on the number of words the user knows (approximately corresponding to these max_rank boundaries).

The sentence CSV data (`data_preparation/data/output/sentences.csv`) has columns: `id`, `text`, `difficulty`, `max_rank`, `rank`, `topics`. Sentences are already classified and uploaded into collections.

---

## 10. Tutorial Code Architecture Recommendation

Design the tutorial system with a clean separation:

```
lib/tutorials/
├── types.ts          — TutorialDefinition, TutorialStep interfaces
├── registry.ts       — All tutorial definitions registered here
├── home-tour.ts      — Home screen tutorial steps
├── audio-review-tour.ts  — Audio review learning tutorial steps
├── full-review-tour.ts   — Full review learning tutorial steps
└── chat-tour.ts      — Chat feature tutorial steps (shared)

hooks/
├── use-tutorial.ts   — Main hook: checks completion status, triggers tours
└── use-tutorial-progress.ts — Read/write tutorial completion state

components/tutorial/
└── TutorialProvider.tsx — Context provider that wraps the app and manages driver.js instances
```

Each tutorial file exports a function that returns driver.js configuration:

```typescript
export function createHomeTour(driver: Driver, callbacks: TutorialCallbacks): void {
  driver.highlight({
    element: '[data-tutorial="collection-carousel"]',
    popover: {
      title: 'Your Sentence Collections',
      description: 'These collections contain sentences organized by difficulty...',
    },
  });
  // ... more steps
}
```

---

## 11. Summary of Changes

### Onboarding changes:
1. Remove Welcome step (step 1)
2. Remove Learning Style step (step 2 — casual/focused/advanced)
3. Reorder: Base Language → Target Language → Difficulty → Review Mode → Finish
4. Replace CEFR labels with word-frequency descriptions
5. Add reactive feedback on selection
6. Use onboardjs for the flow
7. Auto-add first 5 sentences on completion

### Tutorial additions:
1. Home screen tour (post-onboarding)
2. Audio review learning mode tour (first entry)
3. Full review learning mode tour (first entry)
4. Chat feature introduction (first learning mode only)
5. Navigation-triggered tutorials (extensible system)

### Backend changes:
1. Update `currentLevel` values if adding new tiers
2. Update `LEVEL_TO_COLLECTION` mapping
3. Add tutorial progress tracking
4. Update `completeOnboarding` to add initial cards
5. Update `onboardingProgress` schema (fewer steps, no `learningStyle`)
