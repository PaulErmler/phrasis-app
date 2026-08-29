import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

vi.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (p: { children?: ReactNode }) => (
        <div {...p}>{p.children}</div>
      ),
    },
  ),
  AnimatePresence: (p: { children?: ReactNode }) => <>{p.children}</>,
}));
vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: () => null,
}));

import { LandingDemoProvider } from '@/components/landing/landing-demo-context';
import { ReviewModesDemo } from '@/components/landing/review-modes-demo';

function stubMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('ReviewModesDemo writing feedback', () => {
  beforeEach(() => {
    stubMatchMedia(true);
  });

  it('shows the tutor card after the writing demo submits', async () => {
    const user = userEvent.setup();
    render(
      <LandingDemoProvider>
        <ReviewModesDemo />
      </LandingDemoProvider>,
    );

    await user.click(screen.getByTestId('settings-mode-full'));

    await waitFor(() => {
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument();
    });
    expect(screen.getByText('verdict.minor')).toBeInTheDocument();
    expect(screen.getByText('noteType.spelling')).toBeInTheDocument();
    expect(screen.getByText('mock.feedbackEsSpelling')).toBeInTheDocument();
  });
});
