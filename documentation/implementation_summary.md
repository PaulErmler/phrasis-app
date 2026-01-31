# Implementation Summary

## Texts & Collections System

### Schema (`convex/schema.ts`)
- `collections` - groups texts by CEFR level with `name` and `textCount`
- `texts` - stores sentences with `datasetSentenceId`, `text`, `language`, `userCreated`, `collectionId`, `collectionRank`
- `translations` - stores translations linked to `textId`
- `audioRecordings` - stores audio files using Convex file storage, linked to `textId`

### Data Seeding (`convex/data_uploading/data_management.ts`)
- `upsertCollection` - internal mutation to create/get collection by name
- `batchUpsertTexts` - internal mutation for bulk inserting up to 500 texts

### Queries (`convex/texts.ts`)
- `getCollections` - returns all collections (authenticated)
- `getTextsByCollection` - returns texts for a collection with limit (authenticated)
- `getCollectionsWithTexts` - returns collections with preview texts and count (authenticated)

### Upload Script (`scripts/uploadTexts.mjs`)
- Reads CSVs from `data_preparation/data/output/sentences_by_difficulty/`
- Creates collections per CEFR level (Essential, A1-C2)
- Batch uploads via `npx convex run [batch uploading function]`
- Run: `pnpm run seed-texts`

### UI (`components/app/CollectionsPreview.tsx`)
- Accordion displaying collections with first 5 texts each
- Shows text count per collection
- Located in HomeView

## Translation System

### Backend (`convex/translation.ts`)
- `requestTranslation` - mutation creates pending request, schedules async processing
- `getTranslationRequest` - query returns request status and result
- `processTranslation` - internal action calls Google Cloud Translation API

### Constants (`lib/constants/translation.ts`)
- `MAX_TRANSLATION_LENGTH` - shared between frontend and backend

### UI (`components/testing/TranslationTest.tsx`)
- Test component with source/target language selection
- Reactive result display when translation completes

## Text-to-Speech System

### Backend (`convex/tts.ts`)
- `requestTTS` - mutation creates pending request, schedules async processing
- `getTTSRequest` - query returns request status, generates `audioUrl` dynamically from `storageId`
- `processTTS` - internal action calls Google Cloud TTS API (Chirp3 HD voices), stores MP3 in Convex storage

### Constants (`lib/constants/tts.ts`)
- Shared constants: `MAX_TTS_LENGTH`, `MIN_TTS_SPEED`, `MAX_TTS_SPEED`, `TTS_SPEED_OPTIONS`
- Used by both frontend and backend

### Voice Configuration (`lib/languages.ts`)
- `SUPPORTED_LANGUAGES` with Chirp3 HD voices (1 female, 1 male per accent)
- Helper functions: `getVoicesByLanguageCode`, `getLocalesByLanguageCode`, `getLocaleFromApiCode`

### UI (`components/testing/TTSTest.tsx`)
- Test component for TTS with language/accent/voice selection
- Speed control (0.5x - 1.0x)
- Reactive audio playback when generation completes
