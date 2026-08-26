import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * AI writing feedback wiring in FullReviewCardContent: the kick-off effect
 * (local gate vs LLM call), the coach card rendering, and the accuracy
 * override when the grader accepts an alternative.
 */

const gradeMock = vi.fn();

vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>();
  return { ...actual, useAction: () => gradeMock, useMutation: () => vi.fn() };
});
vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: () => null,
}));

import { FullReviewCardContent } from '@/components/app/learning/FullReviewCardContent';
import type {
  CardTranslation,
  WritingAccuracySummary,
} from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

const TRANSLATIONS: CardTranslation[] = [
  { language: 'en', text: 'I would like a coffee.', isBaseLanguage: true, isTargetLanguage: false },
  { language: 'es', text: 'Quisiera un café.', isBaseLanguage: false, isTargetLanguage: true },
];

const CARD_ID = 'card_1' as Id<'cards'>;

function renderCard(opts: { aiFeedbackEnabled?: boolean } = {}) {
  const onAccuracyChange = vi.fn();
  render(
    <FullReviewCardContent
      preReviewCount={0}
      sourceText="I would like a coffee."
      translations={TRANSLATIONS}
      audioRecordings={[]}
      isFavorite={false}
      isPendingMaster={false}
      isPendingHide={false}
      onMaster={vi.fn()}
      onHide={vi.fn()}
      onFavorite={vi.fn()}
      targetAudioMode="never"
      cardId={CARD_ID}
      aiFeedbackEnabled={opts.aiFeedbackEnabled ?? true}
      onAccuracyChange={onAccuracyChange}
    />,
  );
  return onAccuracyChange;
}

function submitAnswer(value: string) {
  const input = screen.getByTestId('learn-translation-input');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function lastSummary(fn: ReturnType<typeof vi.fn>): WritingAccuracySummary {
  return fn.mock.calls.at(-1)?.[0];
}

describe('FullReviewCardContent: AI writing feedback', () => {
  beforeEach(() => {
    gradeMock.mockReset();
  });

  it('resolves a punctuation-only difference locally without calling the action', async () => {
    const onAccuracyChange = renderCard();
    submitAnswer('Quisiera un café');
    // Local verdict renders nothing (the green diff is the signal); the tell
    // is that the summary lands without any server call or pending skeleton.
    await waitFor(() =>
      expect(lastSummary(onAccuracyChange)?.submittedCount).toBe(1),
    );
    expect(gradeMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('writing-feedback-pending'),
    ).not.toBeInTheDocument();
  });

  it('grades a non-matching answer and renders the coach card', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'minor',
      corrected: 'Quisiera un café.',
      notes: [{ type: 'spelling', text: 'cafe is missing its accent.' }],
      savedAlternative: false,
    });
    renderCard();
    submitAnswer('Quisiera un cafe.');
    await waitFor(() =>
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument(),
    );
    expect(gradeMock).toHaveBeenCalledTimes(1);
    expect(gradeMock).toHaveBeenCalledWith({
      cardId: CARD_ID,
      language: 'es',
      userAnswer: 'Quisiera un cafe.',
    });
    expect(screen.getByText('verdict.minor')).toBeInTheDocument();
  });

  it('overrides the accuracy pair to 100 when the grader accepts an alternative', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'alsoCorrect',
      corrected: 'Me gustaría un café.',
      notes: [],
      savedAlternative: true,
    });
    const onAccuracyChange = renderCard();
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(screen.getByText('verdict.alsoCorrect')).toBeInTheDocument(),
    );
    const summary = lastSummary(onAccuracyChange);
    expect(summary.minWithPunctuation).toBe(100);
    expect(summary.minWithoutPunctuation).toBe(100);
  });

  it('falls back to the plain diff view on a grader error', async () => {
    gradeMock.mockRejectedValue(new Error('boom'));
    renderCard();
    submitAnswer('algo muy diferente');
    await waitFor(() => expect(gradeMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByTestId('writing-feedback-pending'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('writing-feedback-card')).not.toBeInTheDocument();
  });

  it('still grades on first-exposure copy-typing rows (regression: a fresh course is all first-exposure)', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'minor',
      corrected: 'Quisiera un café.',
      notes: [{ type: 'spelling', text: 'cafe is missing its accent.' }],
      savedAlternative: false,
    });
    const onAccuracyChange = vi.fn();
    render(
      <FullReviewCardContent
        preReviewCount={0}
        sourceText="I would like a coffee."
        translations={TRANSLATIONS}
        audioRecordings={[]}
        isFavorite={false}
        isPendingMaster={false}
        isPendingHide={false}
        onMaster={vi.fn()}
        onHide={vi.fn()}
        onFavorite={vi.fn()}
        targetAudioMode="never"
        cardId={CARD_ID}
        aiFeedbackEnabled
        firstExposure
        onAccuracyChange={onAccuracyChange}
      />,
    );
    submitAnswer('Quisiera un cafe.');
    await waitFor(() =>
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument(),
    );
    expect(gradeMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a stored accepted alternative locally, diffs against it, and lists the card sentence below', async () => {
    const withAlternatives: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [
          { text: 'Me gustaría un café.', romanization: 'me gustaria un cafe' },
        ],
      },
    ];
    const onAccuracyChange = vi.fn();
    render(
      <FullReviewCardContent
        preReviewCount={0}
        sourceText="I would like a coffee."
        translations={withAlternatives}
        audioRecordings={[]}
        isFavorite={false}
        isPendingMaster={false}
        isPendingHide={false}
        onMaster={vi.fn()}
        onHide={vi.fn()}
        onFavorite={vi.fn()}
        targetAudioMode="never"
        cardId={CARD_ID}
        aiFeedbackEnabled
        onAccuracyChange={onAccuracyChange}
      />,
    );
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(lastSummary(onAccuracyChange)?.minWithPunctuation).toBe(100),
    );
    // Matched the stored alternative locally: no server call, no extra chip —
    // the 100% diff is the whole signal.
    expect(gradeMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('writing-feedback-pending'),
    ).not.toBeInTheDocument();
    // The diff targets the alternative, so the card's own sentence is listed
    // below as another accepted answer.
    const others = screen.getByTestId('writing-feedback-other-accepted');
    expect(others).toHaveTextContent('Quisiera un café.');
  });

  it('does nothing when the setting is off', async () => {
    renderCard({ aiFeedbackEnabled: false });
    submitAnswer('algo muy diferente');
    await new Promise((r) => setTimeout(r, 10));
    expect(gradeMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('writing-feedback-pending')).not.toBeInTheDocument();
  });

  it('discards a stale in-flight grade after revert + resubmit (request-sequence guard)', async () => {
    // Two hand-resolved grades: request 1 (answer A) deliberately resolves
    // AFTER request 2 (answer B). Answer A's verdict must not attach to B —
    // entry existence alone would let it, since B's pending entry re-creates
    // the slot A's discard guard relies on being empty.
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    gradeMock
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    renderCard();

    submitAnswer('respuesta equivocada A');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(1));

    // Revert while request 1 is still in flight, then submit a new answer.
    fireEvent.click(screen.getByLabelText('revertSubmission'));
    submitAnswer('respuesta equivocada B');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(2));

    // Request 2 (the current answer) resolves first: its verdict renders.
    await act(async () => {
      resolveSecond({
        verdict: 'minor',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    await waitFor(() =>
      expect(screen.getByText('verdict.minor')).toBeInTheDocument(),
    );

    // Request 1 (the reverted answer) arrives late and must be discarded.
    await act(async () => {
      resolveFirst({
        verdict: 'wrong',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    expect(screen.getByText('verdict.minor')).toBeInTheDocument();
    expect(screen.queryByText('verdict.wrong')).not.toBeInTheDocument();
  });
});
