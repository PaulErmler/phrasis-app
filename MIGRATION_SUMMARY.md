# Data Migration Summary: Remove Deprecated createdAt Fields

## Problem
Existing documents in 4 Convex database tables contained deprecated `createdAt` fields that conflicted with the updated schema (which relies on Convex's automatic `_creationTime` instead).

## Affected Data
- **audio_recordings**: 125 documents
- **translations**: 71 documents  
- **sentences**: 123 documents
- **cards**: 31 documents
- **Total**: 350 documents

## Solution Approach

### Step 1: Backup
Created `convex/backupData.ts` with `backupTables` query to export all affected data to JSON for safekeeping.

**Output**: All 350 documents backed up with complete structure.

### Step 2: Schema Update
Temporarily added optional `createdAt` fields to schema to allow validation of existing documents:
```typescript
createdAt: v.optional(v.number()), // TEMPORARY: for migration only
```

### Step 3: Data Migration
Created `convex/removeCreatedAtFieldsV2.ts` with `removeCreatedAtFieldsV2` mutation that:
- Queried all documents from each table
- Used `ctx.db.replace(_id, newDoc)` to remove the `createdAt` field
- Stripped `_id`, `_creationTime`, and `createdAt` from each document before replacing

**Result**: Successfully removed `createdAt` from all 350 documents

### Step 4: Schema Cleanup
Removed the temporary optional `createdAt` fields from all 4 tables in schema.ts

### Step 5: Final Deployment
Deployed clean schema without `createdAt` fields. Schema validation passed successfully.

## Key Learnings

1. **Setting to undefined doesn't work**: In Convex, `patch({ field: undefined })` doesn't remove fields
2. **Use db.replace() for field removal**: `db.replace(_id, newDocWithoutField)` is the proper way to remove fields
3. **Destructuring for field removal**: Pattern used: `const { _id, _creationTime, createdAt, ...newDoc } = doc`

## Files Created/Modified
- **Created**: `convex/backupData.ts` - Backup queries (kept for future reference)
- **Created & Deleted**: `convex/removeCreatedAtFieldsV2.ts` - Migration function (cleanup after success)
- **Modified**: `convex/schema.ts` - Removed `createdAt` from 4 table definitions

## Deployment Status
✅ **Success** - All 350 documents cleaned and schema deployed without deprecated fields

## Backup Location
JSON export available from `npx convex run backupData:backupTables` if needed for audit/recovery
