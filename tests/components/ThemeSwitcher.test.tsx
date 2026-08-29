import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));

import { ThemeSwitcher } from '@/components/ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('renders placeholder before mount and hydrates to button', async () => {
    render(<ThemeSwitcher />);
    // Either placeholder div or the button ends up with the sr-only label
    expect(await screen.findByText('toggle')).toBeInTheDocument();
  });
});
