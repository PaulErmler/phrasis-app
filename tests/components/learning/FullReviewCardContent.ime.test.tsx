import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { FullReviewCardContent } from '@/components/app/learning/FullReviewCardContent';
import type { CardTranslation } from '@/components/app/learning/types';

/**
 * The bug this guards: pressing Enter to confirm a Japanese IME conversion
 * submitted the half-composed answer instead of committing the text.
 *
 * `useImeSafeEnter` is unit-tested on its own; these tests assert the writing
 * card is actually *wired* to it — the regression that would reappear if
 * someone rewrote the input or dropped the spread props.
 */

const TRANSLATIONS: CardTranslation[] = [
  { language: 'en', text: 'It is hot today.', isBaseLanguage: true, isTargetLanguage: false },
  { language: 'ja', text: '今日は暑いですね。', isBaseLanguage: false, isTargetLanguage: true },
];

function renderCard() {
  const onAccuracyChange = vi.fn();
  render(
    <FullReviewCardContent
      preReviewCount={0}
      sourceText="It is hot today."
      translations={TRANSLATIONS}
      audioRecordings={[]}
      isFavorite={false}
      isPendingMaster={false}
      isPendingHide={false}
      onMaster={vi.fn()}
      onHide={vi.fn()}
      onFavorite={vi.fn()}
      targetAudioMode="never"
      onAccuracyChange={onAccuracyChange}
    />,
  );
  return {
    input: screen.getByTestId('learn-translation-input'),
    onAccuracyChange,
  };
}

/** The answer has been graded once the diff replaces the input. */
function isSubmitted() {
  return screen.queryByTestId('learn-translation-input') === null;
}

/** Flush the deferred composition-end clear (one macrotask). */
function settleComposition() {
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

describe('FullReviewCardContent — IME-safe Enter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits on a plain Enter (no IME)', () => {
    const { input } = renderCard();
    fireEvent.change(input, { target: { value: '今日は暑いですね。' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(isSubmitted()).toBe(true);
  });

  it('does NOT submit on the Enter that confirms an IME conversion', () => {
    const { input } = renderCard();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'きょうは' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(isSubmitted()).toBe(false);
  });

  it('does NOT submit when compositionend precedes keydown (Safari ordering)', () => {
    const { input } = renderCard();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'きょうは' } });
    // Safari <26 emits compositionend BEFORE the keydown that caused it, so
    // both isComposing and the local flag would already read false.
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(isSubmitted()).toBe(false);
  });

  it('does NOT submit on the legacy keyCode 229 signal', () => {
    const { input } = renderCard();
    fireEvent.change(input, { target: { value: 'きょうは' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(isSubmitted()).toBe(false);
  });

  it('submits on the second Enter, after the conversion is committed', () => {
    const { input } = renderCard();

    // 1. Type kana.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'きょうはあついですね' } });

    // 2. Enter converts to kanji — must not grade.
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '今日は暑いですね。' } });
    expect(isSubmitted()).toBe(false);
    settleComposition();

    // 3. Enter again submits the finished answer.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(isSubmitted()).toBe(true);
  });

  it('keeps the typed text intact through the composition', () => {
    const { input } = renderCard();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'きょうは' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect((input as HTMLInputElement).value).toBe('きょうは');
  });

  it('tags the input with a BCP-47 lang so the OS picks the right IME', () => {
    const { input } = renderCard();
    expect(input).toHaveAttribute('lang', 'ja');
  });

  it('the submit button still works during a composition', () => {
    // Escape hatch for IMEs that report keyCode 229 for every key.
    const { input } = renderCard();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '今日は暑いですね。' } });
    fireEvent.click(screen.getByTestId('learn-submit-translation'));
    expect(isSubmitted()).toBe(true);
  });
});

describe('FullReviewCardContent — ignorePunctuation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function submitAnswer(input: HTMLElement, value: string) {
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('reports 100% accuracy for a missing 。 when enabled', () => {
    const onAccuracyChange = vi.fn();
    render(
      <FullReviewCardContent
        preReviewCount={0}
        sourceText="It is hot today."
        translations={TRANSLATIONS}
        audioRecordings={[]}
        isFavorite={false}
        isPendingMaster={false}
        isPendingHide={false}
        onMaster={vi.fn()}
        onHide={vi.fn()}
        onFavorite={vi.fn()}
        targetAudioMode="never"
        ignorePunctuation
        onAccuracyChange={onAccuracyChange}
      />,
    );
    submitAnswer(
      screen.getByTestId('learn-translation-input'),
      '今日は暑いですね',
    );
    // The accuracy that reaches the parent is what gets persisted to stats.
    expect(onAccuracyChange).toHaveBeenLastCalledWith(100);
  });

  it('reports less than 100% for the same answer by default', () => {
    const onAccuracyChange = vi.fn();
    render(
      <FullReviewCardContent
        preReviewCount={0}
        sourceText="It is hot today."
        translations={TRANSLATIONS}
        audioRecordings={[]}
        isFavorite={false}
        isPendingMaster={false}
        isPendingHide={false}
        onMaster={vi.fn()}
        onHide={vi.fn()}
        onFavorite={vi.fn()}
        targetAudioMode="never"
        onAccuracyChange={onAccuracyChange}
      />,
    );
    submitAnswer(
      screen.getByTestId('learn-translation-input'),
      '今日は暑いですね',
    );
    const reported = onAccuracyChange.mock.calls.at(-1)?.[0];
    expect(reported).toBeLessThan(100);
  });
});
