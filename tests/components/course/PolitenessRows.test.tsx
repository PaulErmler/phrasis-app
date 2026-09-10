import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PolitenessRows } from '@/components/course/PolitenessRows';
import {
  coursePolitenessRows,
  type PolitenessLevel,
} from '@/lib/languageForms';

// tests/setup.ts stubs next-intl: `t(key)` returns the key, so copy is
// asserted by key.
const ROWS = coursePolitenessRows(['ja', 'en']);

function renderRows(selected: PolitenessLevel[], recommendDefault = true) {
  const onChange = vi.fn();
  render(
    <PolitenessRows
      rows={ROWS}
      selected={selected}
      onChange={onChange}
      compact
      recommendDefault={recommendDefault}
    />,
  );
  return onChange;
}

describe('PolitenessRows: the recommended-default card', () => {
  it('is pressed and badged when exactly the recommended set is ticked', () => {
    // Japanese recommends casual and polite; keigo is left for later.
    renderRows(['casual', 'polite']);
    const card = screen.getByTestId('politeness-recommended');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card.textContent).toContain('recommended.badge');
    expect(card.textContent).toContain('recommended.title');
  });

  it('is not pressed when every row is ticked', () => {
    renderRows(['casual', 'polite', 'formal']);
    expect(screen.getByTestId('politeness-recommended')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('ticks the recommended rows when pressed', async () => {
    const user = userEvent.setup();
    const onChange = renderRows(['formal']);
    await user.click(screen.getByTestId('politeness-recommended'));
    expect(onChange).toHaveBeenCalledWith(['casual', 'polite']);
  });

  it('is absent unless asked for', () => {
    renderRows(['casual'], false);
    expect(screen.queryByTestId('politeness-recommended')).toBeNull();
  });
});
