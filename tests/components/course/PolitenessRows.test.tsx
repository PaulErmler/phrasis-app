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

function renderRows(selected: PolitenessLevel[], recommendAll = true) {
  const onChange = vi.fn();
  render(
    <PolitenessRows
      rows={ROWS}
      selected={selected}
      onChange={onChange}
      compact
      recommendAll={recommendAll}
    />,
  );
  return onChange;
}

describe('PolitenessRows: the all-levels card', () => {
  it('is pressed and badged when every row is ticked', () => {
    renderRows(['casual', 'polite', 'formal']);
    const all = screen.getByTestId('politeness-all');
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(all.textContent).toContain('all.badge');
  });

  it('ticks every row when pressed', async () => {
    const user = userEvent.setup();
    const onChange = renderRows(['formal']);
    expect(screen.getByTestId('politeness-all')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByTestId('politeness-all'));
    expect(onChange).toHaveBeenCalledWith(['casual', 'polite', 'formal']);
  });

  it('is absent unless asked for', () => {
    renderRows(['casual'], false);
    expect(screen.queryByTestId('politeness-all')).toBeNull();
  });
});
