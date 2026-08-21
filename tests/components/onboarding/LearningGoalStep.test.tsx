import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/onboarding';

import { LearningGoalStep } from '@/app/app/onboarding/steps/LearningGoalStep';

const COUNTER_TESTID = 'goal-other-char-count';
const INPUT_TESTID = 'goal-other-input';

describe('LearningGoalStep: free-text char limit', () => {
  it('does not render the counter when the free-text input is short', () => {
    render(
      <LearningGoalStep
        selected={['other']}
        freeText={'x'.repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH - ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD - 1)}
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    expect(screen.queryByTestId(COUNTER_TESTID)).toBeNull();
  });

  it('shows the counter once the user crosses the threshold', () => {
    const remaining = ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD - 1;
    const length = MAX_ONBOARDING_FREE_TEXT_LENGTH - remaining;
    render(
      <LearningGoalStep
        selected={['other']}
        freeText={'x'.repeat(length)}
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    const counter = screen.getByTestId(COUNTER_TESTID);
    expect(counter.textContent).toBe(`${length}/${MAX_ONBOARDING_FREE_TEXT_LENGTH}`);
    expect(counter.className).toContain('text-muted-foreground');
    expect(counter.className).not.toContain('text-destructive');
  });

  it('shows the over-limit indicator (+N, destructive color) when forced over via paste', () => {
    const length = MAX_ONBOARDING_FREE_TEXT_LENGTH + 3;
    render(
      <LearningGoalStep
        selected={['other']}
        freeText={'x'.repeat(length)}
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    const counter = screen.getByTestId(COUNTER_TESTID);
    expect(counter.textContent).toBe('+3');
    expect(counter.className).toContain('text-destructive');
  });

  it('renders the input with the hard maxLength cap', () => {
    render(
      <LearningGoalStep
        selected={['other']}
        freeText=""
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    const input = screen.getByTestId(INPUT_TESTID) as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_ONBOARDING_FREE_TEXT_LENGTH);
  });

  it('does not render the free-text input when "other" is not in the selection', () => {
    render(
      <LearningGoalStep
        selected={['travel', 'work']}
        freeText="ignored"
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    expect(screen.queryByTestId(INPUT_TESTID)).toBeNull();
    expect(screen.queryByTestId(COUNTER_TESTID)).toBeNull();
  });

  it('fires onFreeText with the typed value', async () => {
    const onFreeText = vi.fn();
    render(
      <LearningGoalStep
        selected={['other']}
        freeText=""
        onToggle={() => {}}
        onFreeText={onFreeText}
      />,
    );
    await userEvent.type(screen.getByTestId(INPUT_TESTID), 'hi');
    expect(onFreeText).toHaveBeenCalled();
    expect(onFreeText.mock.calls.at(-1)?.[0]).toBe('i');
  });
});
