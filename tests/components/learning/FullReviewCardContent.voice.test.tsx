import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Voice-input gating in FullReviewCardContent: the mic button must not render
 * for a target language without STT support (`supportsStt: false`, or a code
 * the catalogue doesn't know). Transcription quota is consumed before the
 * STT call, so an always-rendered mic would charge those users for a request
 * that can only fail. Every catalogue language supports STT as of Sep 2026,
 * so the hide case uses an unknown code.
 */

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
import type { Id } from '@/convex/_generated/dataModel';
import { makePresentation } from './cardPresentationStub';

const CARD_ID = 'card_1' as Id<'cards'>;

function renderWithTarget(language: string, text: string) {
  const translations: CardTranslation[] = [
    {
      language: 'en',
      text: 'Good morning.',
      isBaseLanguage: true,
      isTargetLanguage: false,
    },
    { language, text, isBaseLanguage: false, isTargetLanguage: true },
  ];
  render(
    <FullReviewCardContent
      presentation={makePresentation({
        cardId: CARD_ID,
        sourceText: 'Good morning.',
        translations,
      })}
      targetAudioMode="never"
      aiFeedbackEnabled
    />,
  );
}

describe('FullReviewCardContent: writing voice button gating', () => {
  it('hides the mic for a target language without STT support', () => {
    renderWithTarget('xx', 'Hello.');
    expect(screen.getByTestId('learn-translation-input')).toBeInTheDocument();
    expect(
      screen.queryByTestId('writing-voice-button'),
    ).not.toBeInTheDocument();
  });

  it('shows the mic for an STT-supported target language (es)', () => {
    renderWithTarget('es', 'Buenos días.');
    expect(screen.getByTestId('writing-voice-button')).toBeInTheDocument();
  });

  it('shows the mic for Greek, STT-supported since Sep 2026', () => {
    renderWithTarget('el', 'Καλημέρα.');
    expect(screen.getByTestId('writing-voice-button')).toBeInTheDocument();
  });
});
