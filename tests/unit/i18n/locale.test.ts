import { describe, it, expect, vi, beforeEach } from 'vitest';

// The NEXT_LOCALE cookie is client-controlled; getUserLocale is the single
// choke point every catalog lookup flows through, so an unknown value must
// collapse to 'en' here — request.tsx indexes `catalogs[locale]` with the
// result, and an out-of-catalog locale would empty every message.

const cookieValue = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'NEXT_LOCALE' && cookieValue.current !== undefined
        ? { name, value: cookieValue.current }
        : undefined,
    set: vi.fn(),
  }),
}));

import { getUserLocale } from '@/i18n/locale';

describe('getUserLocale', () => {
  beforeEach(() => {
    cookieValue.current = undefined;
  });

  it('returns the cookie locale when it is a supported one', async () => {
    cookieValue.current = 'de';
    expect(await getUserLocale()).toBe('de');
  });

  it('defaults to en with no cookie', async () => {
    expect(await getUserLocale()).toBe('en');
  });

  it('falls back to en for an unknown locale', async () => {
    // Stale cookie from an older app version, or another app on the domain.
    cookieValue.current = 'fr';
    expect(await getUserLocale()).toBe('en');
  });

  it('falls back to en for a garbage value', async () => {
    cookieValue.current = '"><script>';
    expect(await getUserLocale()).toBe('en');
  });
});
