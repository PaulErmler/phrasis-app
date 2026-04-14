import { describe, it, expect } from 'vitest';
import { getUserTimezone } from '@/lib/timezone';

describe('getUserTimezone', () => {
  it('returns a non-empty string', () => {
    const tz = getUserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });

  it('returns a plausible IANA-style timezone or UTC', () => {
    const tz = getUserTimezone();
    // Either "UTC" or contains a region/zone separator like "Region/City"
    expect(tz === 'UTC' || /[A-Za-z_]+\/[A-Za-z_]+/.test(tz)).toBe(true);
  });

  it('is idempotent', () => {
    expect(getUserTimezone()).toBe(getUserTimezone());
  });
});
