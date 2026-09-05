import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/onboarding';

import { PriorAppsStep } from '@/app/app/onboarding/steps/PriorAppsStep';

const COUNTER_TESTID = 'prior-apps-other-char-count';
const INPUT_TESTID = 'prior-apps-other-input';

describe('PriorAppsStep: options', () => {
  it('keeps Other last among the shuffled apps and None last overall', () => {
    render(
      <PriorAppsStep
        selected={[]}
        freeText=""
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    const buttons = screen.getAllByTestId(/prior-apps-option-/);
    expect(buttons).toHaveLength(7);
    expect(buttons.at(-2)).toHaveAttribute(
      'data-testid',
      'prior-apps-option-other',
    );
    expect(buttons.at(-1)).toHaveAttribute(
      'data-testid',
      'prior-apps-option-none',
    );
  });

  it('renders every app option plus "other" and "none"', () => {
    render(
      <PriorAppsStep
        selected={[]}
        freeText=""
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    for (const value of [
      'anki',
      'glossika',
      'clozemaster',
      'babbel',
      'duolingo',
      'other',
      'none',
    ]) {
      expect(screen.getByTestId(`prior-apps-option-${value}`)).toBeTruthy();
    }
  });

  it('marks the selected options as pressed', () => {
    render(
      <PriorAppsStep
        selected={['anki', 'duolingo']}
        freeText=""
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    expect(
      screen.getByTestId('prior-apps-option-anki').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen
        .getByTestId('prior-apps-option-babbel')
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('fires onToggle with the clicked option', async () => {
    const onToggle = vi.fn();
    render(
      <PriorAppsStep
        selected={[]}
        freeText=""
        onToggle={onToggle}
        onFreeText={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('prior-apps-option-glossika'));
    expect(onToggle).toHaveBeenCalledWith('glossika');
  });
});

describe('PriorAppsStep: free-text char limit', () => {
  it('does not render the counter when the free-text input is short', () => {
    render(
      <PriorAppsStep
        selected={['other']}
        freeText={'x'.repeat(
          MAX_ONBOARDING_FREE_TEXT_LENGTH -
            ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD -
            1,
        )}
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
      <PriorAppsStep
        selected={['other']}
        freeText={'x'.repeat(length)}
        onToggle={() => {}}
        onFreeText={() => {}}
      />,
    );
    const counter = screen.getByTestId(COUNTER_TESTID);
    expect(counter.textContent).toBe(
      `${length}/${MAX_ONBOARDING_FREE_TEXT_LENGTH}`,
    );
    expect(counter.className).toContain('text-muted-foreground');
    expect(counter.className).not.toContain('text-destructive');
  });

  it('shows the over-limit indicator (+N, destructive color) when forced over via paste', () => {
    const length = MAX_ONBOARDING_FREE_TEXT_LENGTH + 3;
    render(
      <PriorAppsStep
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
      <PriorAppsStep
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
      <PriorAppsStep
        selected={['anki', 'babbel']}
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
      <PriorAppsStep
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
