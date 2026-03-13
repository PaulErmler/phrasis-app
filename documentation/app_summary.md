# Cacatua App Summary

Cacatua is a language-learning web app (Next.js + Convex) that teaches vocabulary through spaced-repetition flashcards built from frequency-ranked sentence collections.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Backend / DB | Convex (real-time, serverless) |
| Auth | Better Auth (`@convex-dev/better-auth`) |
| Styling | Tailwind CSS v4, shadcn/ui (New York), Geist fonts |
| AI | Google Gemini 2.5 Flash via `@convex-dev/agent` |
| Billing | Autumn (`@useautumn/convex`) |
| i18n | `next-intl` (en + de) |
| Scheduling | ts-fsrs (spaced repetition) |
| Package manager | pnpm |
| Animations | motion (Framer Motion) |

## Core Concepts

### Collections & Texts

- **Collections** group sentences by difficulty: `Essential`, `A1`, `A2`, `B1`, `B2`, `C1`, `C2`
- **Texts** are English sentences with a `collectionRank` for ordered access
- Sentences are seeded from CSVs (`data_preparation/data/output/sentences_by_difficulty/`) using `pnpm run seed-texts`
- Each text can have **translations** and **audio recordings** (Google Cloud TTS, Chirp3 HD voices) generated on demand

### Courses, Decks & Cards

- A **course** = one combination of base language(s) + target language(s) + difficulty level
- Each course has one **deck** that holds **cards** (references to texts)
- Cards are added from collections in batches; translations and audio are generated asynchronously
- **Course settings** are stored in a separate `courseSettings` table to avoid re-fetches when settings change

### Spaced Repetition (Two-Phase)

1. **Pre-review** — cards shown with simple ratings ("Still learning" / "Understood") for `initialReviewCount` times
2. **FSRS review** — full algorithm ratings (Again / Hard / Good / Easy) for long-term scheduling

### Two Learning Modes

1. **Audio Review** — listen and recall; target text can be hidden/blurred; auto-advance supported
2. **Full Review** — type the translation; character-level diff shown; no pre-review phase (always FSRS)

### Chat / AI Assistant

- AI chat powered by Gemini 2.5 Flash via `@convex-dev/agent`
- Can create flashcards through a tool-call → approval workflow
- Available on the home page (`NewChatInput`) and inside the learning view (sidebar/slide panel)

### Feature Gating & Billing

- Autumn manages subscription plans and usage quotas
- Feature IDs: `chat_messages`, `courses`, `sentences`, `custom_sentences`, `multiple_languages`
- `FeatureGatedButton` and `useFeatureQuota` handle UI enforcement
- Quotas synced from Autumn and cached locally in `usageQuotas` table

## App Structure

### Routing

| Path | Purpose |
|------|---------|
| `/` | Landing page |
| `/auth/[path]` | Authentication (Better Auth) → redirects to `/app/onboarding` |
| `/app/onboarding` | 7-step onboarding wizard |
| `/app` | Main app (home view, tab-based) |
| `/app/content` | Content management tab |
| `/app/library` | Library tab (card search) |
| `/app/settings` | Settings tab |
| `/app/learn` | Full-screen learning overlay (pushState, not a real route) |
| `/app/chat/[threadId]` | Full chat page |

### Main Layout (`app/app/(main)/layout.tsx`)

- Wraps the four tabs (home, content, library, settings) + learn overlay
- `BottomNav` — 5 columns: Home, Content, [central Play button], Library, Settings
- Learn overlay is a fixed `z-50` div that covers everything when active
- Redirects to `/app/onboarding` if `hasCompletedOnboarding === false`

### Home View (`components/app/HomeView.tsx`)

Top to bottom:
1. `ProgressStatsCard` — streak, reps, sentences, time + `StartLearningButton` (Full Review / Audio Review)
2. `NewChatInput` — quick chat entry
3. `CollectionCarousel` — horizontal scroll of difficulty collections (Essential → C2)
4. `CustomCollectionCarousel` — user-created collections

### Learning View (`components/app/learning/LearnView.tsx`)

- `LearningChatLayout` — desktop sidebar + mobile slide panel for chat
- `LearningHeader` — back button, info popover, theme switcher, settings button
- `LearningMode` — card content + controls
  - `LearningCardContent` (audio mode) / `FullReviewCardContent` (full mode)
  - `LearningControls` — rating buttons, progress bar, play/pause/restart/next, chat button (mobile)
- `LearningModeSettings` — sheet with all playback and review settings

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useLearningMode` | Card fetching, review logic, auto-add, state machine |
| `useLearningAudio` | Merged audio pipeline, playback controls |
| `useAudioPlayer` | Low-level audio element management |
| `useChat` | Unified chat composition (messages + sending + voice) |
| `useThread` | Thread lifecycle (auto-create or explicit) |
| `useFeatureQuota` | Read usage quotas for a feature |

## Database Schema (Key Tables)

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
| `courseStats` | `userId`, `courseId`, `totalRepetitions`, `totalTimeMs`, `totalCards`, `currentStreak` |
| `usageQuotas` | `userId`, `features` (record of balances) |

## Supported Languages

Defined in `lib/languages.ts` — `SUPPORTED_LANGUAGES` array with code, name, nativeName, flag, and Chirp3 HD TTS voices. Includes English, Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Korean, Arabic, Turkish, Polish, Dutch, and more.

## i18n

- Messages live in `messages/en.json` and `messages/de.json`
- Landing page messages: `messages/landing/en.json` and `messages/landing/de.json`
- All UI text uses `useTranslations()` from `next-intl`
- Key namespaces: `AppPage`, `LearningMode`, `Onboarding`, `Chat`, `Features`, `Settings`, `Pricing`

## Difficulty / CEFR System

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

**Collection sampling** (`dataset_creation.py::SAMPLING_CONFIG`) — the authoritative source for what sentences end up in each collection, filtering by the sentence's **max word rank**:

| Collection | min_max_rank | max_max_rank | max_sentences |
|-----------|-------------|-------------|--------------|
| Essential | 0 | 30000 | 1000 |
| A1 | 185 | 500 | 1000 |
| A2 | 200 | 2000 | 1500 |
| B1 | 300 | 5000 | 2500 |
| B2 | 500 | 10000 | 3000 |
| C1 | 5000 | 10000 | 5000 |
| C2 | 8000 | 20000 | 5000 |
