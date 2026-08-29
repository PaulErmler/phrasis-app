import { useState } from 'react';
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

// Spy on the real implementation (values unchanged) so a test can assert an
// already-submitted answer is diffed once rather than once per keystroke.
vi.mock('@/lib/textCompare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/textCompare')>();
  return { ...actual, computeAccuracyPair: vi.fn(actual.computeAccuracyPair) };
});

import { computeAccuracyPair } from '@/lib/textCompare';
import { FullReviewCardContent } from '@/components/app/learning/FullReviewCardContent';
import type {
  CardTranslation,
  WritingAccuracySummary,
} from '@/components/app/learning/types';
import { makePresentation } from './cardPresentationStub';

const computeAccuracyPairSpy = vi.mocked(computeAccuracyPair);

/**
 * The accuracy summary drives two different things, and this file guards the
 * distinction: the AVERAGE is the recorded stat (gated on every language being
 * submitted), while the MINIMUM feeds the auto-rating and is available as soon
 * as anything is submitted. A perfect answer in one language must never mask a
 * failed one in another.
 */

const TWO_TARGETS: CardTranslation[] = [
  {
    language: 'en',
    text: 'The weather is nice.',
    isBaseLanguage: true,
    isTargetLanguage: false,
  },
  {
    language: 'es',
    text: 'El tiempo es bueno.',
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
  {
    language: 'de',
    text: 'Das Wetter ist schön.',
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
];

function renderCard(translations: CardTranslation[]) {
  const onAccuracyChange = vi.fn();
  render(
    <FullReviewCardContent
      presentation={makePresentation({
        sourceText: 'The weather is nice.',
        translations,
      })}
      targetAudioMode="never"
      onAccuracyChange={onAccuracyChange}
    />,
  );
  return onAccuracyChange;
}

/**
 * Type into the Nth still-unsubmitted input and submit it. Selected by role
 * rather than test id, only the first target input carries
 * `learn-translation-input`, since that id anchors the tutorial coachmark.
 */
function submitNth(index: number, value: string) {
  const inputs = screen.getAllByRole('textbox');
  fireEvent.change(inputs[index], { target: { value } });
  fireEvent.keyDown(inputs[index], { key: 'Enter' });
}

function lastSummary(fn: ReturnType<typeof vi.fn>): WritingAccuracySummary {
  return fn.mock.calls.at(-1)?.[0];
}

/** Type into the Nth still-unsubmitted input WITHOUT submitting it. */
function typeNth(index: number, value: string) {
  fireEvent.change(screen.getAllByRole('textbox')[index], {
    target: { value },
  });
}

describe('FullReviewCardContent: accuracy summary across target languages', () => {
  it('reports a running minimum before every language is submitted', () => {
    const onAccuracyChange = renderCard(TWO_TARGETS);

    // Only the Spanish answer, and it is badly wrong.
    submitNth(0, 'nada');

    const summary = lastSummary(onAccuracyChange);
    expect(summary.allSubmitted).toBe(false);
    expect(summary.submittedCount).toBe(1);
    expect(summary.targetCount).toBe(2);
    // Available immediately, so the auto-rating has something to work with.
    expect(summary.minWithPunctuation).toBeLessThan(50);
  });

  it('takes the minimum from the weakest language, not the average', () => {
    const onAccuracyChange = renderCard(TWO_TARGETS);

    submitNth(0, 'El tiempo es bueno.'); // perfect
    submitNth(0, 'völlig falsch'); // the remaining input — wrong

    const summary = lastSummary(onAccuracyChange);
    expect(summary.allSubmitted).toBe(true);
    expect(summary.submittedCount).toBe(2);

    // The perfect answer pulls the average up, but the minimum stays with the
    // failed language. That is what decides when the card comes back.
    expect(summary.avgWithPunctuation).toBeGreaterThan(
      summary.minWithPunctuation!,
    );
    expect(summary.minWithPunctuation).toBeLessThan(50);
    expect(summary.avgWithPunctuation).toBeGreaterThan(40);
  });

  it('reports nulls with a target language present but nothing submitted', () => {
    const onAccuracyChange = renderCard(TWO_TARGETS);
    const summary = lastSummary(onAccuracyChange);
    expect(summary).toMatchObject({
      allSubmitted: false,
      submittedCount: 0,
      targetCount: 2,
      avgWithPunctuation: null,
      minWithPunctuation: null,
    });
  });

  // Regression: `inputs` gets a new identity on every keystroke, so typing into
  // a language that hasn't been submitted yet re-runs the summary memo. Nothing
  // about the already-submitted answers changed, so neither the diff nor the
  // parent should see any work. The pairs are cached per (language, expected,
  // actual) and the emit is gated on structural equality.
  it('does not re-diff or re-emit while typing into an unsubmitted language', () => {
    const onAccuracyChange = renderCard(TWO_TARGETS);

    submitNth(0, 'El tiempo es bueno.');
    const callsAfterSubmit = onAccuracyChange.mock.calls.length;
    computeAccuracyPairSpy.mockClear();

    // The remaining input is now at index 0. Type without pressing Enter.
    typeNth(0, 'D');
    typeNth(0, 'Da');
    typeNth(0, 'Das');

    // Without the cache the submitted Spanish answer is re-diffed once per
    // character, both punctuation variants each time.
    expect(computeAccuracyPairSpy).not.toHaveBeenCalled();
    expect(onAccuracyChange.mock.calls.length).toBe(callsAfterSubmit);
    expect(lastSummary(onAccuracyChange).submittedCount).toBe(1);
  });

  // Regression: the summary memo re-produces a new (structurally equal) object
  // whenever its deps change. When the parent stores the emitted summary in
  // state, as LearningMode does, emitting on referential change feeds back:
  // emit → setState → re-render → new object → emit. Gating the emit on
  // structural equality is what stops it. (With `targetTranslations` unstable
  // this was an outright "Maximum update depth exceeded".)
  it('does not loop when the parent stores the summary in state', () => {
    const emissions = vi.fn();
    function StatefulParent() {
      const [summary, setSummary] = useState<WritingAccuracySummary | null>(
        null,
      );
      return (
        <>
          {/* Reading the state ties the re-render to the stored object. */}
          <span data-testid="submitted-count">
            {summary?.submittedCount ?? -1}
          </span>
          <FullReviewCardContent
            presentation={makePresentation({
              sourceText: 'The weather is nice.',
              translations: TWO_TARGETS,
            })}
            targetAudioMode="never"
            onAccuracyChange={(s) => {
              emissions(s);
              setSummary(s);
            }}
          />
        </>
      );
    }

    // Without the structural-equality gate this render throws
    // "Maximum update depth exceeded".
    render(<StatefulParent />);
    submitNth(0, 'El tiempo es bueno.');

    expect(screen.getByTestId('submitted-count').textContent).toBe('1');
    // Mount + one submit: exactly two distinct summaries, no re-emission churn.
    expect(emissions).toHaveBeenCalledTimes(2);
  });
});
