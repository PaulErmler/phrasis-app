import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The writing card now wires AI feedback (useAction) and the voice button
// (useFeatureQuota); neither is under test here, so the Convex-backed hooks
// are stubbed the way other component tests do it.
vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>();
  return { ...actual, useAction: () => vi.fn(), useMutation: () => vi.fn() };
});
vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: () => null,
}));


import { FullReviewCardContent } from '@/components/app/learning/FullReviewCardContent';
import type { CardTranslation } from '@/components/app/learning/types';
import { makePresentation } from './cardPresentationStub';

/**
 * First-exposure copy-through ("Abschreiben"): when LearningMode's
 * `firstExposure` prop is set (driven by the "Show translation on new
 * sentences" setting. Predicate unit-tested in
 * tests/unit/components/learning/firstExposure.test.ts), the target sentence
 * is shown next to its audio button above the input so the user copies it.
 * These tests pin the prop contract and that the assist disappears after
 * submission.
 */

const TRANSLATIONS: CardTranslation[] = [
  {
    language: 'en',
    text: 'Hello.',
    isBaseLanguage: true,
    isTargetLanguage: false,
  },
  {
    language: 'es',
    text: 'Hola.',
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
];

function renderCard(
  overrides: Partial<
    React.ComponentProps<typeof FullReviewCardContent>
  > = {},
) {
  render(
    <FullReviewCardContent
      presentation={makePresentation({
        schedulingPhase: 'review',
        sourceText: 'Hello.',
        translations: TRANSLATIONS,
      })}
      targetAudioMode="never"
      firstExposure
      {...overrides}
    />,
  );
}

describe('FullReviewCardContent: first-exposure copy-through', () => {
  it('shows the target answer while firstExposure is set', () => {
    renderCard();
    expect(screen.getByTestId('first-exposure-answer')).toHaveTextContent(
      'Hola.',
    );
    // The input is still there. The user types the answer out.
    expect(screen.getByTestId('learn-translation-input')).toBeInTheDocument();
  });

  it('hides the assist when firstExposure is off (default)', () => {
    renderCard({ firstExposure: undefined });
    expect(screen.queryByTestId('first-exposure-answer')).toBeNull();
  });

  it('drops the assist after the target is submitted', () => {
    renderCard();
    const input = screen.getByTestId('learn-translation-input');
    fireEvent.change(input, { target: { value: 'Hola.' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Submitted branch takes over. The copy assist is gone.
    expect(screen.queryByTestId('first-exposure-answer')).toBeNull();
  });
});
