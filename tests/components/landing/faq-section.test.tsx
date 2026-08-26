import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    { get: () => (p: any) => <div {...p}>{p.children}</div> },
  ),
}));
vi.mock('@/components/landing/pwa-install-button', () => ({
  PWAInstallButton: () => null,
}));

import { FAQSection } from '@/components/landing/faq-section';

describe('FAQSection', () => {
  it('renders the faq title', () => {
    render(<FAQSection />);
    expect(screen.getByText('title')).toBeInTheDocument();
  });
});
