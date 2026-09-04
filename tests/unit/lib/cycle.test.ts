import { describe, it, expect } from 'vitest';
import { cycleNext } from '@/lib/cycle';

describe('cycleNext', () => {
  const ring = ['a', 'b', 'c'] as const;

  it('advances and wraps at the end', () => {
    expect(cycleNext(ring, 'a')).toBe('b');
    expect(cycleNext(ring, 'b')).toBe('c');
    expect(cycleNext(ring, 'c')).toBe('a');
  });

  it('restarts from the first element when current is not in the ring', () => {
    expect(cycleNext(ring, 'z')).toBe('a');
    expect(cycleNext(ring, undefined)).toBe('a');
  });

  it('works on rings holding null and numbers', () => {
    const speeds = [null, 0.6, 1.0] as const;
    expect(cycleNext(speeds, null)).toBe(0.6);
    expect(cycleNext(speeds, 1.0)).toBeNull();
  });
});
