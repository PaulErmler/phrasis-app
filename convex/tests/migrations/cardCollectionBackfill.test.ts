import { describe, it, expect } from 'vitest';
import { cardCollectionBackfillPatch } from '../../migrations';
import type { Doc, Id } from '../../_generated/dataModel';

const collectionId = 'collection1' as Id<'collections'>;

/**
 * A pre-backfill card fragment. The narrowed schema types both fields as
 * required, so legacy rows (which the safety net exists for) can no longer be
 * expressed as plain literals — this cast reconstructs exactly the shape a
 * prod row written before the backfill presents to `migrateOne`.
 */
function legacyCard(
  fields: Partial<Pick<Doc<'cards'>, 'collectionId' | 'collectionOrigin'>>,
): Pick<Doc<'cards'>, 'collectionId' | 'collectionOrigin'> {
  return fields as Pick<Doc<'cards'>, 'collectionId' | 'collectionOrigin'>;
}

function makeCollection(
  overrides: Partial<Doc<'collections'>>,
): Doc<'collections'> {
  return {
    _id: collectionId,
    _creationTime: 0,
    name: 'L03',
    textCount: 100,
    ...overrides,
  } as Doc<'collections'>;
}

describe('cardCollectionBackfillPatch (safety-net migrateOne logic)', () => {
  it('returns undefined (skip) when both fields are already set, idempotent', () => {
    expect(
      cardCollectionBackfillPatch(
        { collectionId, collectionOrigin: 'premade' },
        collectionId,
        makeCollection({ origin: 'premade' }),
      ),
    ).toBeUndefined();
  });

  it('fills both fields from the resolved collection', () => {
    expect(
      cardCollectionBackfillPatch(
        legacyCard({}),
        collectionId,
        makeCollection({ origin: 'custom' }),
      ),
    ).toEqual({ collectionId, collectionOrigin: 'custom' });
  });

  it('fills only the missing field', () => {
    expect(
      cardCollectionBackfillPatch(
        legacyCard({ collectionId }),
        collectionId,
        makeCollection({ origin: 'chat' }),
      ),
    ).toEqual({ collectionOrigin: 'chat' });
  });

  it('derives premade origin for legacy CEFR collections without an origin field', () => {
    expect(
      cardCollectionBackfillPatch(
        legacyCard({ collectionId }),
        collectionId,
        makeCollection({ name: 'A1' }),
      ),
    ).toEqual({ collectionOrigin: 'premade' });
  });

  it('derives premade origin for dataset collections without an origin field', () => {
    expect(
      cardCollectionBackfillPatch(
        legacyCard({ collectionId }),
        collectionId,
        makeCollection({
          name: 'L05',
          datasetId: 'dataset1' as Id<'datasets'>,
        }),
      ),
    ).toEqual({ collectionOrigin: 'premade' });
  });

  it('leaves origin unset for a non-premade collection without an origin field', () => {
    expect(
      cardCollectionBackfillPatch(
        legacyCard({ collectionId }),
        collectionId,
        makeCollection({ name: 'Custom' }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the collection cannot be resolved', () => {
    expect(
      cardCollectionBackfillPatch(legacyCard({}), undefined, null),
    ).toBeUndefined();
  });
});
