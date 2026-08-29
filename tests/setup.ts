import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Stub next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Stub next-intl. Tests can re-mock per-file if they need translation values
vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  // Stable identity, like the real useTranslations (which memoizes the
  // translator): hooks list `t` in effect/callback dependencies, and a fresh
  // function per render would re-fire one-shot effects in tests.
  const stubTranslator = (key: string) => key;
  return {
    ...actual,
    useTranslations: () => stubTranslator,
    useLocale: () => 'en',
    useFormatter: () => ({
      dateTime: (d: Date) => d.toISOString(),
      number: (n: number) => String(n),
      relativeTime: (d: Date) => d.toISOString(),
      list: (items: string[]) => items.join(', '),
    }),
    useMessages: () => ({}),
    useNow: () => new Date('2026-04-14T00:00:00Z'),
    useTimeZone: () => 'UTC',
  };
});

// Basic MediaRecorder / HTMLMediaElement shims for audio tests
if (typeof window !== 'undefined') {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
}
