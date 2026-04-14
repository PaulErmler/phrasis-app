import { describe, it, expect } from 'vitest';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';

describe('resolveLanguageOrder', () => {
  it('returns fallback when persisted is undefined', () => {
    expect(resolveLanguageOrder(undefined, ['en', 'de'])).toEqual(['en', 'de']);
  });

  it('returns fallback when persisted is empty', () => {
    expect(resolveLanguageOrder([], ['en', 'de'])).toEqual(['en', 'de']);
  });

  it('keeps persisted order and drops unknown codes', () => {
    expect(
      resolveLanguageOrder(['de', 'xx', 'en'], ['en', 'de', 'fr']),
    ).toEqual(['de', 'en', 'fr']);
  });

  it('appends newly available languages at the end', () => {
    expect(resolveLanguageOrder(['en'], ['en', 'de', 'fr'])).toEqual([
      'en',
      'de',
      'fr',
    ]);
  });

  it('returns only valid codes when persisted has extras not in fallback', () => {
    expect(resolveLanguageOrder(['en', 'zz'], ['en'])).toEqual(['en']);
  });

  it('does not duplicate codes already present', () => {
    expect(resolveLanguageOrder(['en', 'de'], ['de', 'en'])).toEqual([
      'en',
      'de',
    ]);
  });
});
