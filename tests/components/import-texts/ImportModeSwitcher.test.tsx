import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportModeSwitcher } from '@/components/app/import-texts/ImportModeSwitcher';

describe('ImportModeSwitcher', () => {
  it('renders both modes and marks the active one', () => {
    render(<ImportModeSwitcher value="individual" onChange={() => {}} />);
    expect(screen.getByTestId('add-cards-mode-individual')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('add-cards-mode-import')).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange when the other mode is clicked', async () => {
    const onChange = vi.fn();
    render(<ImportModeSwitcher value="individual" onChange={onChange} />);
    await userEvent.click(screen.getByTestId('add-cards-mode-import'));
    expect(onChange).toHaveBeenCalledWith('import');
  });
});
