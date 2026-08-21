import { describe, it, expect } from 'vitest';
import { shuffleKeepingLast } from '@/app/app/onboarding/lib/shuffleKeepingLast';

describe('shuffleKeepingLast', () => {
  const items = ['a', 'b', 'c', 'd', 'other'] as const;

  it('always pins the last value at the end', () => {
    for (let n = 0; n < 20; n++) {
      const shuffled = shuffleKeepingLast(items, 'other');
      expect(shuffled.at(-1)).toBe('other');
      expect(shuffled.slice(0, -1).sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('shuffles the rest when random is not identity', () => {
    const shuffled = shuffleKeepingLast(items, 'other', () => 0);
    expect(shuffled.at(-1)).toBe('other');
    expect(shuffled.slice(0, -1)).not.toEqual(['a', 'b', 'c', 'd']);
  });
});
