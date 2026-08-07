import { describe, it, expect } from 'vitest';
import {
  getCardOriginBucket,
  ORIGIN_BUCKETS,
} from '../../db/stats/cardAggregates';
import type { Doc } from '../../_generated/dataModel';

const card = (collectionOrigin: Doc<'cards'>['collectionOrigin']) =>
  ({ collectionOrigin }) as Doc<'cards'>;

describe('getCardOriginBucket (cardsByOriginStateAndDueDate namespace part)', () => {
  it('passes resolved origins through unchanged', () => {
    expect(getCardOriginBucket(card('premade'))).toBe('premade');
    expect(getCardOriginBucket(card('custom'))).toBe('custom');
    expect(getCardOriginBucket(card('chat'))).toBe('chat');
  });

  it("maps unresolved legacy cards to 'none' — counted under 'both' only, mirroring fetchDueCardsWithFilter", () => {
    expect(getCardOriginBucket(card(undefined))).toBe('none');
  });

  it('every bucket is enumerable for clearAggregatesForDeck', () => {
    expect(ORIGIN_BUCKETS).toEqual(['premade', 'custom', 'chat', 'none']);
    for (const origin of ['premade', 'custom', 'chat', undefined] as const) {
      expect(ORIGIN_BUCKETS).toContain(getCardOriginBucket(card(origin)));
    }
  });
});
