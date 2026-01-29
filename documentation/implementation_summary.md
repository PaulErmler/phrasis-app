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
