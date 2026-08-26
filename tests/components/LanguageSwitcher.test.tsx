import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/locale', () => ({
  setUserLocale: vi.fn(),
}));

import { LanguageSwitcher } from '@/components/LanguageSwitcher';

describe('LanguageSwitcher', () => {
  it('renders in full mode', () => {
    const { container } = render(<LanguageSwitcher />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders in compact mode', async () => {
    render(<LanguageSwitcher compact />);
    expect(await screen.findByText('title')).toBeInTheDocument();
  });
});
