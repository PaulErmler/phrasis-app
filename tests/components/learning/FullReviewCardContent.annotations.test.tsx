import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
 * Romanization belongs under the sentence/corrections, not after the
 * accuracy footer or the action-button column. The submitted writing
 * row used to park AnnotationLines as a sibling of that whole flex,
 * so the taller undo/"Also correct?" stack shoved it down the card.
 */

const TRANSLATIONS: CardTranslation[] = [
  {
    language: 'en',
    text: 'Hey, everyone.',
    isBaseLanguage: true,
    isTargetLanguage: false,
  },
  {
    language: 'ja',
    text: 'やあ、みんな。',
    romanization: "Yā, min'na.",
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
];

function renderCard() {
  return render(
    <FullReviewCardContent
      presentation={makePresentation({
        sourceText: 'Hey, everyone.',
        translations: TRANSLATIONS,
      })}
      targetAudioMode="never"
    />,
  );
}

function submitAnswer(value: string) {
  const input = screen.getByTestId('learn-translation-input');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('FullReviewCardContent: romanization placement', () => {
  it('sits under the submitted sentence, before the accuracy line', () => {
    const { container } = renderCard();
    submitAnswer('やあ');
    const text = container.textContent ?? '';
    const sentence = text.indexOf('やあ');
    const romanization = text.indexOf("Yā, min'na.");
    const accuracy = text.indexOf('accuracy');
    expect(sentence).toBeGreaterThanOrEqual(0);
    expect(romanization).toBeGreaterThan(sentence);
    expect(accuracy).toBeGreaterThan(romanization);
  });
});
