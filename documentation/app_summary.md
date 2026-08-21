# Flexling app summary

Flexling is a language-learning web app (Next.js + Convex) that teaches vocabulary through spaced-repetition flashcards built from frequency-ranked sentence collections.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Backend / DB | Convex (real-time, serverless) |
| Auth | Better Auth (`@convex-dev/better-auth`) |
| Styling | Tailwind CSS v4, shadcn/ui (New York), Geist fonts |
| AI | OpenRouter via `@convex-dev/agent`, `z-ai/glm-5.2:nitro` tutor chat, Gemini Flash Lite models for metadata/titles/TTS validation (see `convex/config/aiModels.ts`) |
| Billing | Autumn (`@useautumn/convex`) |
| i18n | `next-intl` (en + de) |
| Scheduling | ts-fsrs (spaced repetition) |
| Package manager | pnpm |
| Animations | motion (Framer Motion) |

## Core concepts

### Collections & texts

- **Collections** group sentences by difficulty: `Essential`, `A1`, `A2`, `B1`, `B2`, `C1`, `C2`
- **Texts** are English sentences with a `collectionRank` for ordered access
- Sentences are seeded from CSVs (`data_preparation/data/output/sentences_by_difficulty/`) using `pnpm run seed-texts`
- Each text can have **translations** and **audio recordings** (Google Cloud TTS, Chirp3 HD voices) generated on demand

### Courses, decks & cards

- A **course** = one combination of base language(s) + target language(s) + difficulty level
- Each course has one **deck** that holds **cards** (references to texts)
- Cards are added from collections in batches; translations and audio are generated asynchronously
- **Course settings** are stored in a separate `courseSettings` table to avoid re-fetches when settings change

### Spaced repetition (two-phase)

1. **Pre-review.** Cards shown with simple ratings ("Still learning" / "Understood") for `initialReviewCount` times
2. **FSRS review.** Full algorithm ratings (Again / Hard / Good / Easy) for long-term scheduling

### Two learning modes

1. **Audio Review.** Listen and recall; target text can be hidden/blurred; auto-advance supported
2. **Full Review.** Type the translation; character-level diff shown; no pre-review phase (always FSRS)

### Chat / AI assistant

- AI chat powered by OpenRouter `z-ai/glm-5.2:nitro` via `@convex-dev/agent` (model roster in `convex/config/aiModels.ts`)
- Can create flashcards through a tool-call → approval workflow
- Available on the home page (`NewChatInput`) and inside the learning view (sidebar/slide panel)

### Feature gating & billing

- Autumn manages subscription plans and usage quotas
- Feature IDs (11, single source of truth in `convex/features/featureIds.ts`): `chat_messages`, `courses`, `sentences`, `custom_sentences`, `multiple_languages`, `transcriptions`, `card_edits`, `translation_auto_fill`, `audio_regenerations`, `translation_flags`, `credits`. Credit-backed features (`chat_messages`, `custom_sentences`, `translation_auto_fill`) draw from the shared `credits` pool via `CREDIT_COSTS`
- `FeatureGatedButton` and `useFeatureQuota` handle UI enforcement
- Quotas synced from Autumn and cached locally in `usageQuotas` table

## App structure

### Routing

| Path | Purpose |
|------|---------|
| `/` | Landing page |
| `/auth/[path]` | Authentication (Better Auth) → redirects to `/app/onboarding` |
| `/app/onboarding` | Multi-step onboarding wizard (see `StepId` in `app/app/onboarding/page.tsx`) |
| `/app` | Main app (home view, tab-based) |
| `/app/content` | Content management tab |
| `/app/library` | Library tab (card search) |
| `/app/settings` | Settings tab |
| `/app/stats` | Learning statistics dashboard |
| `/app/learn` | Full-screen learning overlay (pushState, not a real route) |
| `/app/chat/[threadId]` | Full chat page |

### Main layout (`app/app/(main)/layout.tsx`)

- Wraps the four tabs (home, content, library, settings) + learn overlay
- `BottomNav`: 5 columns: Home, Content, [central Play button], Library, Settings
- Learn overlay is a fixed `z-50` div that covers everything when active
- Redirects to `/app/onboarding` if `hasCompletedOnboarding === false`

### Home view (`components/app/HomeView.tsx`)

Top to bottom:
1. `ProgressStatsCard`: streak, reps, sentences, time + `StartLearningButton` (Full Review / Audio Review)
2. `NewChatInput`: quick chat entry
3. `SegmentedHomeSection`: segmented collection browser (course level chips Essential → C2 / custom collections, with a compact switcher) rendering inline collection detail via `InlineCollectionDetail` from `components/app/CollectionCarouselUI.tsx`

### Learning view (`components/app/learning/LearnView.tsx`)

- `LearningChatLayout`: desktop sidebar + mobile slide panel for chat
- `LearningHeader`: back button, info popover, theme switcher, settings button
- `LearningMode`: card content + controls
  - `LearningCardContent` (audio mode) / `FullReviewCardContent` (full mode)
  - `LearningControls`: rating buttons, progress bar, play/pause/restart/next, chat button (mobile)
- `LearningModeSettings`: sheet with all playback and review settings

### Key hooks

| Hook | Purpose |
|------|---------|
| `useLearningMode` | Card fetching, review logic, auto-add, state machine |
| `useLearningAudio` | Merged audio pipeline, playback controls |
| `useAudioPlayer` | Low-level audio element management |
| `useChat` | Unified chat composition (messages + sending + voice) |
| `useThread` | Thread lifecycle (auto-create or explicit) |
| `useFeatureQuota` | Read usage quotas for a feature |

## Database schema (key tables)

| Table | Key Fields |
|-------|-----------|
| `userSettings` | `userId`, `hasCompletedOnboarding`, `learningStyle`, `activeCourseId` |
| `onboardingProgress` | `userId`, `step`, `learningStyle`, `reviewMode`, `currentLevel`, `targetLanguages`, `baseLanguages` |
| `courses` | `userId`, `baseLanguages`, `targetLanguages`, `currentLevel` |
| `courseSettings` | `courseId`, `initialReviewCount`, `activeCollectionId`, `reviewMode`, + many audio/UI settings |
| `decks` | `courseId`, `name`, `cardCount` |
| `cards` | `deckId`, `textId`, `collectionId`, `dueDate`, `schedulingPhase`, `fsrsState`, ... |
| `collections` | `name`, `textCount` |
| `texts` | `text`, `language`, `collectionId`, `collectionRank` |
| `translations` | `textId`, `targetLanguage`, `translatedText` |
| `audioRecordings` | `textId`, `language`, `voiceName`, `storageId` |
| `collectionProgress` | `userId`, `courseId`, `collectionId`, `cardsAdded`, `lastRankProcessed` |
| `courseStats` | `userId`, `courseId`, `totalRepetitions`, `totalTimeMs`, `totalCards`, `currentStreak`, `totalWordCount`, `totalReviewsByMode`, `totalAccuracySum/Count` |
| `dailyStats` | `userId`, `courseId`, `date`, `reps`, `newCards`, `timeMs`, `hourBuckets`, `ratingCounts`, `reviewsByCardState` |
| `weeklyStats` | `userId`, `courseId`, `week`, `totalRepetitions`, `activeDays`, `reviewsByMode` |
| `monthlyStats` | `userId`, `courseId`, `month`, `totalRepetitions`, `activeDays`, `activeWeeks` |
| `yearlyStats` | `userId`, `courseId`, `year`, `totalRepetitions`, `activeDays`, `activeWeeks`, `activeMonths` |
| `dailyLanguageStats` | `userId`, `courseId`, `date`, `language`, `reps`, `newWordsCount` |
| `languageStats` | `userId`, `courseId`, `language`, `totalRepetitions`, `totalWords` |
| `userWords` | `userId`, `language`, `word` |
| `reviewDepthAccuracy` | `userId`, `courseId`, `reviewNumber`, `accuracySum`, `count` |
| `usageQuotas` | `userId`, `features` (record of balances) |

## Scheduling & shared content helpers

### Shared scheduling logic (`lib/scheduling.ts`)

All card-scheduling logic lives in one pure TypeScript module (its only dependency is `ts-fsrs`; no Convex or React imports), so the backend (`convex/features/scheduling.ts`) and the frontend (`components/app/learning/useLearningMode.ts`) share the exact same math:

- `DEFAULT_INITIAL_REVIEW_COUNT = 5`: single source of truth (bounds `MIN_INITIAL_REVIEW_COUNT = 2` / `MAX_INITIAL_REVIEW_COUNT = 10`, checked by `validateInitialReviewCount`)
- `scheduleCard(cardState, rating, initialReviewCount, now?, requestRetention?)`: the single entry-point for all scheduling, handling both phases. The `requestRetention` override is frontend-only; the backend always uses `DEFAULT_REQUEST_RETENTION` (0.95)
- `createInitialCardState(now?)`: factory for a brand-new card's scheduling state
- `getPreReviewInterval(reviewCount)`: pre-review interval in ms (1m, 3m, 5m, then 10m)
- `getValidRatings(phase)` / `getDefaultRating(phase)`: UI helpers
- `formatInterval(ms)`: human-readable interval strings
- `simulateReviews(initialReviewCount, ratings, startTime?, requestRetention?)`: simulates a review sequence with each review at its exact due time (exercised by `tests/unit/lib/scheduling.test.ts`)

FSRS configuration: `request_retention: 0.95`, `maximum_interval: 36500` (days), `enable_fuzz: false`, `enable_short_term: true`, `learning_steps: ['1m', '10m']`, `relearning_steps: ['10m']`.

The pre-review → FSRS transition happens when the user selects "Understood", or when `preReviewCount` reaches `initialReviewCount − 2`. The −2 accounts for the 2 FSRS learning-step reviews needed to graduate, so total initial exposure = `initialReviewCount`.

### Collection preview & content generation

The collection preview dialog (driven by `components/app/useCollectionDetail.ts`) is a paginated browse over functions in `convex/features/collections.ts`:

- `browseCollectionTexts` (query): paginated rows anchored at the sequential frontier (`collectionProgress.lastRankProcessed`), snapshotted once when the dialog opens so the range never shifts mid-session. `direction: 'after'` streams the not-yet-added zone; `'upTo'` pages the added-history feed. Each row carries `missingTranslationLanguages` for the client to batch into translation requests.
- `requestPreviewTranslations` (mutation): generates missing translations (never audio) for up to `MAX_PREVIEW_PAGE_SIZE` (25) texts as pages are revealed; deduped via per-(textId, language) claims and deliberately not quota-gated (translations are cheap; audio is the dominant cost and only happens on an explicit click or once a text becomes a card).
- `prewarmPreviewTranslations` (mutation): schedules the next page's translations whenever a page finishes loading, so "show more" usually renders instantly.
- `requestPreviewAudio` (mutation): generates audio for one (text, language) on an explicit audio-icon click; no-ops if audio exists or a TTS claim is in flight.

Card content self-heals via the `useEnsureContent` hook (`hooks/use-ensure-content.ts`), which calls `decks.ensureCardContent` for cards flagged `hasMissingContent` (module-level dedup `Set`, batches of 5). At course creation, `ensureFirstSentencesAcrossLevelCollections` fans out one mutation per premade level collection to pre-generate content for each level's first `COLLECTION_PREVIEW_SIZE` (5) texts, so drilling into a level later shows no spinner. `COLLECTION_PREVIEW_SIZE` (defined in `convex/lib/collections.ts`) is also the default batch size for the collection "Add N" button.

### Shared database & content helpers

**Database helpers (`convex/db/collections.ts`):**

- `getCollectionProgress(ctx, userId, courseId, collectionId)`: indexed `collectionProgress` lookup (`by_userId_and_courseId_and_collectionId`); `getCollectionProgressForCourse(ctx, userId, courseId)` fetches all rows for a course in one indexed scan (used by the home view).
- `getNextTextsFromRank(ctx, collectionId, afterRank, limit, options?)`: rank-based text pagination. `options.onlyCurriculum` restricts to seed/dataset texts (`userCreated === false`); `options.forUserId` scopes custom/chat collections to the requesting user. The flags are mutually exclusive; `onlyCurriculum` takes precedence.

**Content batch helper (`convex/lib/cardContent.ts`):**

- `buildTextContentBatchForLanguages(ctx, inputs, baseLanguages, targetLanguages, opts?)`: given an array of `TextContentInput` objects, batch-fetches all translations and audio recordings across the course languages, resolves storage URLs, and returns a `Map<string, TextContentResult>` with assembled translations, audio, and `hasMissingContent` per text. Used by `getDeckCards` (decks), `browseCollectionTexts` (collections), `getLibraryCards` (library), and `getSentencesForWord` (stats).
- `getCourseLanguages(baseLanguages, targetLanguages)`: deduplicates base + target language arrays.

**Audio helper (`convex/lib/audio.ts`):**

- `getAudioForText(ctx, textId, languages)`: fetches audio recordings with resolved storage URLs for a single text across the given languages. Used by `getCardForReview` in `convex/features/scheduling.ts`.
- Deletion helpers (`deleteAudioRow`, `deleteAudioRowsForTextLanguage`, `deleteStorageBlobIfUnreferenced`) keep audio rows and their storage blobs consistent.

## Stats tracking

The app tracks comprehensive multi-dimensional learning statistics across several time scales and dimensions.

### Stats tables

| Table | Key | Tracks |
|-------|-----|--------|
| `courseStats` | userId + courseId | All-time totals: reps, time, cards, streak, word count, chat messages, accuracy, mode split |
| `dailyStats` | userId + courseId + date | Daily snapshot: reps, newCards, timeMs, hourBuckets[24], ratingCounts, reviewsByCardState, reviewsByMode, accuracy, event counters |
| `weeklyStats` | userId + courseId + week (ISO `YYYY-Www`) | Weekly rollup: reps, newCards, timeMs, activeDays, reviewsByMode |
| `monthlyStats` | userId + courseId + month (`YYYY-MM`) | Monthly rollup: + activeWeeks |
| `yearlyStats` | userId + courseId + year (`YYYY`) | Yearly rollup: + activeWeeks, activeMonths |
| `dailyLanguageStats` | userId + courseId + date + language | Per-language daily: reps, newCards, timeMs, newWordsCount |
| `languageStats` | userId + courseId + language | All-time per-language totals |
| `userWords` | userId + language + word | One row per unique word seen (deduped) |
| `reviewDepthAccuracy` | userId + courseId + reviewNumber | Accuracy curve by Nth review of a card |

### How stats get updated

**Primary trigger: the `reviewCard` mutation** (`convex/features/scheduling.ts`):

When a user rates a card, a cascading update runs in a single transaction:

1. **courseStats.** Increment reps, time (clamped to 180s), cards, streak, mode split, accuracy
2. **dailyStats.** Increment daily counters, hourBuckets[hour], ratingCounts[rating], reviewsByCardState
3. **weekly/monthly/yearlyStats.** Upsert period rollup, propagate `activeDays`/`activeWeeks`/`activeMonths`
4. **Per-language stats.** On first review of a card: tokenize text, insert new words into `userWords`, update `dailyLanguageStats` and `languageStats`, increment `courseStats.totalWordCount`
5. **reviewDepthAccuracy.** Upsert accuracy at review depth = `preReviewCount + fsrsReps + 1`
6. **collectionProgress.** Increment `cardsLearned` if first review

**Secondary triggers** via `trackEvent()` (atomic daily + course update):

| Action | Field Updated | Source |
|--------|--------------|--------|
| Chat message sent | `chatMessagesSent` | `convex/features/chat/messages.ts` |
| Chat card approved | `chatCardsApproved` | `convex/features/chat/cardApprovals.ts` |
| Card created manually | `cardsAddedManually` | `convex/features/customTexts.ts` |
| Card edited | `cardsEdited` | `convex/features/scheduling.ts` |

### Card aggregates (`convex/db/stats/cardAggregates.ts`)

Uses the Convex `TableAggregate` component for O(log n) lookups instead of full table scans:

- **cardsByStateAndDueDate.** Namespace: `deckId:stateLabel`, key: dueDate → due count per state, and (unbounded) the plain count per state
- **cardsByOriginStateAndDueDate.** Namespace: `deckId:originBucket:stateLabel`, key: dueDate → the same counts under a `course`/`custom` content filter
- **cardsByWritingStateAndDueDate** / **cardsByOriginWritingStateAndDueDate.** Writing-track mirrors of the two above, keyed on `writingDueDate`. Only cards with a seeded writing track are members.

Every aggregate is namespaced by at least `deckId:stateLabel`. Deck-wide totals are summed across the state namespaces rather than kept in a separate deck-wide tree: `dueDate` is the sort key and changes on every review, so each extra tree costs a B-tree delete + insert on the `reviewCard` hot path.

All aggregates auto-update via `insertCard()`, `patchCard()`, `deleteCard()` helpers.

Card state labels are derived with priority: `hidden > mastered > preReview("new") > FSRS state` (new/learning/review/relearning).

### Word tracking (`convex/db/stats/wordTracking.ts`)

- CJK/Thai languages: tokenized with `Intl.Segmenter` (word granularity)
- Other languages: whitespace split + punctuation removal
- All words normalized to lowercase NFC
- Deduplicated per user+language in the `userWords` table

### Date utilities (`convex/lib/dateUtils.ts`)

All functions operate on `YYYY-MM-DD` strings using `Date.UTC()` internally:

- `getTodayInTimezone(tz)`: today's date in user's IANA timezone
- `getNextDay` / `getPreviousDay`: date arithmetic
- `getMonthString` → `YYYY-MM`, `getYearString` → `YYYY`
- `getISOWeekString` → `YYYY-Www` (ISO 8601 week via Thursday-based calculation)

User timezone comes from `lib/timezone.ts` (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

### Stats queries & display

All queries in `convex/features/stats.ts`, displayed in `components/app/stats/StatsView.tsx`:

| Query | Returns |
|-------|---------|
| `getHeatmapData` | Date + reps + timeMs + newCards for activity heatmap |
| `getStatsForRange` | Raw dailyStats for a date range |
| `getWeekly/Monthly/YearlyStatsRange` | Period aggregates |
| `getLanguageStats` | All-time per-language totals |
| `getDailyLanguageStats` | Per-language daily breakdown |
| `getHourlyDistribution` | Sum of hourBuckets[24] across date range |
| `getRatingDistribution` | Sum of ratingCounts across date range |
| `getAccuracyByReviewDepth` | Accuracy curve by review number |
| `getCardStateDistribution` | Sum of reviewsByCardState |
| `getCollectionLearningProgress` | Cards added/learned per collection |
| `getCardMaturityDistribution` | Live card state counts via aggregate (6 states) |
| `getDueCardCount` | Cards due now via aggregate |

The StatsView displays: streak, words, reviews, time, average accuracy, due cards, card maturity distribution, activity heatmap, mode split, language breakdown, peak study hours, accuracy-by-review curve, rating distribution, reviews by card state, collection progress, and app usage counters.

### Stats route

| Path | Purpose |
|------|---------|
| `/app/stats` | Stats page (StatsView component) |

## Supported languages

Defined in `lib/languages.ts` as the `SUPPORTED_LANGUAGES` array (~58 entries) with code, name, nativeName, flag, and per-provider TTS voice config. See the array for the current list; hard-coding it here goes stale.

## i18n

- Messages live in `messages/en.json` and `messages/de.json`
- Landing page messages: `messages/landing/en.json` and `messages/landing/de.json`
- All UI text uses `useTranslations()` from `next-intl`
- Key namespaces: `AppPage`, `LearningMode`, `Onboarding`, `Chat`, `Features`, `Settings`, `Pricing`

## Difficulty / CEFR system

Collections are ordered: Essential → A1 → A2 → B1 → B2 → C1 → C2 (defined in `convex/lib/collections.ts`).

The onboarding maps user self-assessment to a starting collection:

| User Level | Collection |
|-----------|-----------|
| beginner | Essential |
| elementary | A2 |
| intermediate | B1 |
| upper_intermediate | B2 |
| advanced | C1 |

Word frequency data in `data_preparation/` uses two layers:

**Per-word CEFR** (`spacy_classifier.py::get_cefr_from_rank`):
- rank ≤ 500 → A1, ≤ 1000 → A2, ≤ 2000 → B1, ≤ 5000 → B2, ≤ 10000 → C1, > 10000 → C2

**Collection sampling** (`dataset_creation.py::SAMPLING_CONFIG`). The authoritative source for what sentences end up in each collection, filtering by the sentence's **max word rank**:

| Collection | min_max_rank | max_max_rank | max_sentences |
|-----------|-------------|-------------|--------------|
| Essential | 0 | 30000 | 1000 |
| A1 | 185 | 500 | 1000 |
| A2 | 200 | 2000 | 1500 |
| B1 | 300 | 5000 | 2500 |
| B2 | 500 | 10000 | 3000 |
| C1 | 5000 | 10000 | 5000 |
| C2 | 8000 | 20000 | 5000 |
