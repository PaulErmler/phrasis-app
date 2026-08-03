import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { LearningControls } from '@/components/app/learning/LearningControls';
import type { ReviewRating } from '@/lib/scheduling';

/**
 * The window-level keyboard shortcuts of learning mode all live in
 * LearningControls. These tests pin the full key map (Space, Enter/→, ←,
 * R, Shift+R, T, digits) plus the guards: typing in an input, open dialogs
 * (`shortcutsDisabled`), and browser chords like Cmd+R must never trigger.
 */

const RATINGS: ReviewRating[] = ['again', 'hard', 'good', 'easy'];

function makeHandlers() {
  return {
    onSelectRating: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSeek: vi.fn(),
    onNext: vi.fn(),
    onUndo: vi.fn(),
    onBack: vi.fn(),
    onRestartCard: vi.fn(),
    onReplayTarget: vi.fn(),
    onReveal: vi.fn(),
  };
}

type Handlers = ReturnType<typeof makeHandlers>;

function renderControls(
  handlers: Handlers,
  overrides: Partial<React.ComponentProps<typeof LearningControls>> = {},
) {
  render(
    <>
      <input data-testid="outside-input" />
      <LearningControls
        validRatings={RATINGS}
        activeRating="good"
        ratingIntervals={{}}
        isPlaying={false}
        isMerging={false}
        durationSec={12}
        undoDisabled={false}
        isReviewing={false}
        {...handlers}
        {...overrides}
      />
    </>,
  );
}

describe('LearningControls — window shortcuts', () => {
  beforeEach(() => {
    // jsdom has no matchMedia; report "no fine pointer" so the key-hint
    // tooltips stay off and the DOM matches the touch layout.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('Space toggles play/pause', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);
    expect(handlers.onPause).not.toHaveBeenCalled();
  });

  it('Space pauses while playing', () => {
    const handlers = makeHandlers();
    renderControls(handlers, { isPlaying: true });
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
  });

  it('Enter and ArrowRight advance to the next card', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(handlers.onNext).toHaveBeenCalledTimes(2);
  });

  it('Enter reveals first in full review mode', () => {
    const handlers = makeHandlers();
    renderControls(handlers, {
      isFullReview: true,
      fullReviewRevealed: false,
    });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handlers.onReveal).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it('ArrowLeft steps back', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('R restarts the audio from 0 and resumes playback', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 'r' });
    expect(handlers.onSeek).toHaveBeenCalledWith(0);
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);
  });

  it('R while playing only rewinds', () => {
    const handlers = makeHandlers();
    renderControls(handlers, { isPlaying: true });
    fireEvent.keyDown(window, { key: 'r' });
    expect(handlers.onSeek).toHaveBeenCalledWith(0);
    expect(handlers.onPlay).not.toHaveBeenCalled();
  });

  it('Shift+R restarts the card, not the audio', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 'R', shiftKey: true });
    expect(handlers.onRestartCard).toHaveBeenCalledTimes(1);
    expect(handlers.onSeek).not.toHaveBeenCalled();
  });

  it('Cmd+←/Alt+← (browser back) are never intercepted', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true });
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true });
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('Cmd+R (browser reload) is never intercepted', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 'r', metaKey: true });
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    expect(handlers.onSeek).not.toHaveBeenCalled();
    expect(handlers.onRestartCard).not.toHaveBeenCalled();
    expect(handlers.onPlay).not.toHaveBeenCalled();
  });

  it('T replays the target audio', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: 't' });
    expect(handlers.onReplayTarget).toHaveBeenCalledTimes(1);
  });

  it('digit keys pick a rating', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    fireEvent.keyDown(window, { key: '2' });
    expect(handlers.onSelectRating).toHaveBeenCalledWith('hard');
  });

  it('ignores every shortcut while typing in an input', () => {
    const handlers = makeHandlers();
    renderControls(handlers);
    const input = screen.getByTestId('outside-input');
    for (const key of [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'r', 't', '1']) {
      fireEvent.keyDown(input, { key });
    }
    expect(handlers.onPlay).not.toHaveBeenCalled();
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(handlers.onSeek).not.toHaveBeenCalled();
    expect(handlers.onReplayTarget).not.toHaveBeenCalled();
    expect(handlers.onSelectRating).not.toHaveBeenCalled();
  });

  it('ignores every shortcut while shortcutsDisabled (dialog open)', () => {
    const handlers = makeHandlers();
    renderControls(handlers, { shortcutsDisabled: true });
    for (const key of [' ', 'Enter', 'ArrowLeft', 'r', 't', '1']) {
      fireEvent.keyDown(window, { key });
    }
    expect(handlers.onPlay).not.toHaveBeenCalled();
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(handlers.onSeek).not.toHaveBeenCalled();
    expect(handlers.onReplayTarget).not.toHaveBeenCalled();
    expect(handlers.onSelectRating).not.toHaveBeenCalled();
  });

  it('R and Space no-op while the merged audio is not ready', () => {
    const handlers = makeHandlers();
    renderControls(handlers, { durationSec: 0 });
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(handlers.onSeek).not.toHaveBeenCalled();
    expect(handlers.onPlay).not.toHaveBeenCalled();
  });

  describe('key auto-repeat guards', () => {
    // Held keys fire keydown with `repeat: true` ~30×/s — every action
    // shortcut must act exactly once per physical press, or a held `1`
    // rates several cards before the user lifts the finger.
    it('a held digit rates exactly once', () => {
      const handlers = makeHandlers();
      renderControls(handlers, { instantProceed: true });
      fireEvent.keyDown(window, { key: '1' });
      fireEvent.keyDown(window, { key: '1', repeat: true });
      fireEvent.keyDown(window, { key: '1', repeat: true });
      expect(handlers.onSelectRating).toHaveBeenCalledTimes(1);
      expect(handlers.onNext).toHaveBeenCalledTimes(1);
    });

    it('held Enter / ArrowRight advance exactly once each', () => {
      const handlers = makeHandlers();
      renderControls(handlers);
      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyDown(window, { key: 'Enter', repeat: true });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
      expect(handlers.onNext).toHaveBeenCalledTimes(2);
    });

    it('held ← steps back exactly once', () => {
      const handlers = makeHandlers();
      renderControls(handlers);
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true });
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('← only consumes the key when back acts', () => {
    it('preventDefault when onBack reports it acted', () => {
      const handlers = makeHandlers();
      handlers.onBack.mockReturnValue(true);
      renderControls(handlers);
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('keeps the default when there is nothing to take back', () => {
      const handlers = makeHandlers();
      handlers.onBack.mockReturnValue(false);
      renderControls(handlers);
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
