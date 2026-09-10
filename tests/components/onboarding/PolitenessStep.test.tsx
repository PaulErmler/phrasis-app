import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PolitenessStep } from '@/app/app/onboarding/steps/PolitenessStep';
import type { PolitenessLevel } from '@/lib/languageForms';

function renderStep(selected: PolitenessLevel[], onChange = vi.fn()) {
  // tests/setup.ts stubs next-intl: `t(key)` returns the key, so copy is
  // asserted by key.
  const utils = render(
    <PolitenessStep
      targetLanguages={['ja']}
      baseLanguages={['en']}
      selected={selected}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

describe('PolitenessStep: the recommended answer', () => {
  it('preselects every level on entry with nothing ticked', () => {
    const { onChange } = renderStep([]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['casual', 'polite', 'formal']);
  });

  it('leaves an existing pick alone', () => {
    const { onChange } = renderStep(['polite']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the all-levels card as the recommended, pressed option', () => {
    renderStep(['casual', 'polite', 'formal']);
    const all = screen.getByTestId('politeness-all');
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(all.textContent).toContain('all.badge');
  });

  it('ticks every row when the all-levels card is pressed', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep(['polite']);
    expect(screen.getByTestId('politeness-all')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByTestId('politeness-all'));
    expect(onChange).toHaveBeenLastCalledWith(['casual', 'polite', 'formal']);
  });
});
