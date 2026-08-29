import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const useMediaQueryMock = vi.fn().mockReturnValue(false);
vi.mock('@/hooks/use-media-query', () => ({
  useMediaQuery: (...args: unknown[]) => useMediaQueryMock(...args),
}));

// Radix ScrollArea (mobile row) observes its viewport; jsdom has no
// ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import {
  QuickActionsGrid,
  QuickActionsRow,
} from '@/components/chat/QuickActionsRow';
import { SENTENCE_QUICK_ACTION_KINDS } from '@/convex/features/chat/quickActions';

describe('QuickActionsRow', () => {
  beforeEach(() => {
    useMediaQueryMock.mockReturnValue(false);
  });

  it('renders all six sentence actions (mobile scroll row)', () => {
    render(<QuickActionsRow onAction={vi.fn()} />);
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      expect(screen.getByTestId(`quick-action-${kind}`)).toBeInTheDocument();
    }
    expect(SENTENCE_QUICK_ACTION_KINDS).toHaveLength(6);
  });

  it('renders all six actions on desktop (tooltip chips)', () => {
    useMediaQueryMock.mockReturnValue(true);
    render(<QuickActionsRow onAction={vi.fn()} />);
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      expect(screen.getByTestId(`quick-action-${kind}`)).toBeInTheDocument();
    }
  });

  it('fires onAction with the clicked kind', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickActionsRow onAction={onAction} />);
    await user.click(screen.getByTestId('quick-action-conjugation'));
    expect(onAction).toHaveBeenCalledWith('conjugation');
    await user.click(screen.getByTestId('quick-action-simpler'));
    expect(onAction).toHaveBeenCalledWith('simpler');
  });

  it('disables all buttons when disabled', () => {
    render(<QuickActionsRow onAction={vi.fn()} disabled />);
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      expect(screen.getByTestId(`quick-action-${kind}`)).toBeDisabled();
    }
  });
});

describe('QuickActionsGrid', () => {
  it('renders all six actions as tiles with label and message', () => {
    render(<QuickActionsGrid onAction={vi.fn()} />);
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      const tile = screen.getByTestId(`quick-tile-${kind}`);
      expect(tile).toBeInTheDocument();
      expect(tile).toHaveTextContent(`${kind}.label`);
      expect(tile).toHaveTextContent(`${kind}.message`);
    }
  });

  it('fires onAction with the clicked kind', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickActionsGrid onAction={onAction} />);
    await user.click(screen.getByTestId('quick-tile-tenses'));
    expect(onAction).toHaveBeenCalledWith('tenses');
  });

  it('uses the language-qualified message when a target language is known', () => {
    // The next-intl stub echoes keys, so the key choice is what's asserted.
    render(<QuickActionsGrid onAction={vi.fn()} languageLabel="Romanian" />);
    expect(screen.getByTestId('quick-tile-grammar')).toHaveTextContent(
      'grammar.messageWithLanguage',
    );
  });
});
