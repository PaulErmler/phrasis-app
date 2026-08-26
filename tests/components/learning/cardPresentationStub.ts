import { vi } from 'vitest';
import type { CardPresentation } from '@/components/app/learning/cardPresentation';

/**
 * Minimal `CardPresentation` for the card-component suites: the required
 * fields stubbed, everything overridable. Test-tree mirror of the
 * `cardStubs` spread in app/store-frames/screens.tsx.
 */
export function makePresentation(
  overrides: Partial<CardPresentation> = {},
): CardPresentation {
  return {
    preReviewCount: 0,
    sourceText: '',
    translations: [],
    audioRecordings: [],
    isFavorite: false,
    isPendingMaster: false,
    isPendingHide: false,
    onMaster: vi.fn(),
    onHide: vi.fn(),
    onFavorite: vi.fn(),
    ...overrides,
  };
}
