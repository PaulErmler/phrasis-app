import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: () => (p: { children?: unknown }) => <div {...p}>{p.children}</div> }),
}));
vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: () => null,
}));

import { WritingCompareSection } from '@/components/landing/writing-compare-section';

describe('WritingCompareSection', () => {
  it('shows the learning card and both graders', () => {
    render(<WritingCompareSection />);

    expect(screen.getByTestId('landing-writing-compare')).toBeInTheDocument();
    expect(screen.getByText('prompt')).toBeInTheDocument();
    expect(screen.getByText('otherApps')).toBeInTheDocument();
    expect(screen.getByText('flexling')).toBeInTheDocument();
    expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument();
    expect(screen.getByText('verdict.alsoCorrect')).toBeInTheDocument();
    expect(screen.getByText('noteType.naturalness')).toBeInTheDocument();
    expect(screen.getByText('naturalnessNote')).toBeInTheDocument();
    expect(screen.getAllByText('expected').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('writing-feedback-other-accepted')).toBeInTheDocument();
    expect(screen.getAllByText(/accuracy/).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByTestId('writing-feedback-alternative-saved'),
    ).toBeInTheDocument();
  });
});
