import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/onboarding';

import { AcquisitionSourceStep } from '@/app/app/onboarding/steps/AcquisitionSourceStep';

const COUNTER_TESTID = 'acquisition-other-char-count';
const INPUT_TESTID = 'acquisition-other-input';

describe('AcquisitionSourceStep — free-text char limit', () => {
  it('does not render the counter when the free-text input is short', () => {
    render(
      <AcquisitionSourceStep
        selected="other"
        freeText={'x'.repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH - ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD - 1)}
        onSelect={() => {}}
        onFreeText={() => {}}
      />,
    );
    expect(screen.queryByTestId(COUNTER_TESTID)).toBeNull();
  });

  it('shows the counter once the user crosses the threshold', () => {
    const remaining = ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD - 1;
    const length = MAX_ONBOARDING_FREE_TEXT_LENGTH - remaining;
    render(
      <AcquisitionSourceStep
        selected="other"
        freeText={'x'.repeat(length)}
        onSelect={() => {}}
        onFreeText={() => {}}
      />,
    );
    const counter = screen.getByTestId(COUNTER_TESTID);
    expect(counter.textContent).toBe(`${length}/${MAX_ONBOARDING_FREE_TEXT_LENGTH}`);
    expect(counter.className).toContain('text-muted-foreground');
    expect(counter.className).not.toContain('text-destructive');
  });

  it('shows the over-limit indicator (+N, destructive color) when forced over via paste', () => {
    const length = MAX_ONBOARDING_FREE_TEXT_LENGTH + 5;
    render(
      <AcquisitionSourceStep
        selected="other"
        freeText={'x'.repeat(length)}
        onSelect={() => {}}
        onFreeText={() => {}}
      />,
    );
    const counter = screen.getByTestId(COUNTER_TESTID);
    expect(counter.textContent).toBe('+5');
    expect(counter.className).toContain('text-destructive');
  });

  it('renders the input with the hard maxLength cap', () => {
    render(
      <AcquisitionSourceStep
        selected="other"
        freeText=""
        onSelect={() => {}}
        onFreeText={() => {}}
      />,
    );
    const input = screen.getByTestId(INPUT_TESTID) as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_ONBOARDING_FREE_TEXT_LENGTH);
  });

  it('does not render the free-text input when "other" is not selected', () => {
    render(
      <AcquisitionSourceStep
        selected="reddit"
        freeText="ignored"
        onSelect={() => {}}
        onFreeText={() => {}}
      />,
    );
    expect(screen.queryByTestId(INPUT_TESTID)).toBeNull();
    expect(screen.queryByTestId(COUNTER_TESTID)).toBeNull();
  });

  it('fires onFreeText with the typed value', async () => {
    const onFreeText = vi.fn();
    render(
      <AcquisitionSourceStep
        selected="other"
        freeText=""
        onSelect={() => {}}
        onFreeText={onFreeText}
      />,
    );
    await userEvent.type(screen.getByTestId(INPUT_TESTID), 'ab');
    expect(onFreeText).toHaveBeenCalled();
    expect(onFreeText.mock.calls.at(-1)?.[0]).toBe('b');
  });
});
