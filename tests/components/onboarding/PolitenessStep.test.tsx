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
  // Japanese recommends casual and polite; keigo is left for later.
  it('preselects the recommended set on entry with nothing ticked', () => {
    const { onChange } = renderStep([]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['casual', 'polite']);
  });

  it('leaves an existing pick alone', () => {
    const { onChange } = renderStep(['polite']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the recommended-default card as pressed when that set is ticked', () => {
    renderStep(['casual', 'polite']);
    const card = screen.getByTestId('politeness-recommended');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card.textContent).toContain('recommended.badge');
  });

  it('ticks the recommended rows when the card is pressed', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep(['polite']);
    expect(screen.getByTestId('politeness-recommended')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByTestId('politeness-recommended'));
    expect(onChange).toHaveBeenLastCalledWith(['casual', 'polite']);
  });
});
