import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  CoachmarkProvider,
  useRegisterCoachmark,
} from '@/app/app/onboarding/components/Coachmark';

/**
 * The coachmark binds a CAPTURE-phase window keydown listener that
 * `preventDefault()`s Enter, Space and Escape. Capture phase means it runs
 * before the focused field ever sees the key, so without a target check it
 * hijacks ordinary typing — a space dismissed the coachmark and never reached
 * the input, and an Enter confirming an IME conversion did the same.
 */

function Fixture() {
  useRegisterCoachmark({
    id: 'test-mark',
    anchor: '[data-anchor]',
    title: 'Title',
    body: 'Body',
  });
  return (
    <div>
      <div data-anchor>anchor</div>
      <input data-testid="field" />
      <button data-testid="plain-button">button</button>
    </div>
  );
}

function renderCoachmark() {
  render(
    <CoachmarkProvider order={['test-mark']}>
      <Fixture />
    </CoachmarkProvider>,
  );
}

/** The coachmark is gone once its body no longer renders. */
function isDismissed() {
  return screen.queryByText('Body') === null;
}

describe('Coachmark keyboard handling', () => {
  beforeEach(() => {
    // jsdom has no ResizeObserver; the overlay observes the anchor element.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it('renders while not dismissed', () => {
    renderCoachmark();
    expect(isDismissed()).toBe(false);
  });

  it('dismisses on Enter pressed outside any text field', () => {
    renderCoachmark();
    fireEvent.keyDown(screen.getByTestId('plain-button'), { key: 'Enter' });
    expect(isDismissed()).toBe(true);
  });

  it('does NOT dismiss on Enter pressed inside a text field', () => {
    renderCoachmark();
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Enter' });
    expect(isDismissed()).toBe(false);
  });

  it('does NOT swallow Space typed into a text field', () => {
    renderCoachmark();
    fireEvent.keyDown(screen.getByTestId('field'), { key: ' ' });
    expect(isDismissed()).toBe(false);
  });

  it('does NOT dismiss on Escape inside a text field', () => {
    // Escape cancels an in-flight IME conversion; it must reach the input.
    renderCoachmark();
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Escape' });
    expect(isDismissed()).toBe(false);
  });

  it('does NOT dismiss on an Enter that is confirming an IME composition', () => {
    renderCoachmark();
    fireEvent.keyDown(screen.getByTestId('plain-button'), {
      key: 'Enter',
      isComposing: true,
    });
    expect(isDismissed()).toBe(false);
  });

  it('does NOT dismiss on the legacy keyCode 229 IME signal', () => {
    renderCoachmark();
    fireEvent.keyDown(screen.getByTestId('plain-button'), {
      key: 'Enter',
      keyCode: 229,
    });
    expect(isDismissed()).toBe(false);
  });
});
