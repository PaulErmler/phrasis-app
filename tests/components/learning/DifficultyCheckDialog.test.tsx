import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * DifficultyCheckDialog: the one-time "does the difficulty feel right?"
 * pager. Prop-driven (`open` / `currentLevel` are resolved by
 * useDifficultyCheck), so the whole dialog contract is testable even while
 * the feature flag in the hook is off:
 *  - closed → renders nothing;
 *  - open → starts on the course's real level (number + CEFR badge +
 *    upcoming-sentence preview for that level);
 *  - keep (no paging) → onDone only, no mutation;
 *  - page + confirm → setActiveCollectionByLevel exactly once with the
 *    paged level, then onDone;
 *  - chevrons respect the 1..20 scale edges and the neighbour's
 *    `switchable` flag (loading neighbour stays steppable);
 *  - any close path counts as "keep" (onDone) — a dismissed check must
 *    release the held auto-add, never re-prompt;
 *  - a failed switch keeps the dialog open (toast, no onDone);
 *  - re-open re-arms the pager at the course level.
 */

interface Page {
  exists: boolean;
  switchable: boolean;
  sentences: Array<{
    position: number;
    sourceText: string;
    targetText?: string;
    targetRomanization?: string;
  }>;
}

const harness = vi.hoisted(() => ({
  setActiveCollectionByLevel: vi.fn<(args: unknown) => Promise<null>>(() =>
    Promise.resolve(null),
  ),
  pages: new Map<number, Page>(),
  toastError: vi.fn(),
}));

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  type Ref = Parameters<typeof getFunctionName>[0];
  return {
    useQuery: (ref: unknown, args?: unknown) => {
      if (args === 'skip') return undefined;
      const name = getFunctionName(ref as Ref);
      if (name.includes('getUpcomingSentencesForLevel')) {
        return harness.pages.get((args as { ogteLevel: number }).ogteLevel);
      }
      throw new Error(`Unexpected query: ${name}`);
    },
    useMutation: (ref: unknown) => {
      const name = getFunctionName(ref as Ref);
      if (name.includes('setActiveCollectionByLevel')) {
        return harness.setActiveCollectionByLevel;
      }
      throw new Error(`Unexpected mutation: ${name}`);
    },
  };
});

vi.mock('@/hooks/use-course-languages', () => ({
  useCourseLanguages: () => ({
    baseLanguages: ['en'],
    targetLanguages: ['es'],
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: harness.toastError, success: vi.fn() },
}));

import { DifficultyCheckDialog } from '@/components/app/learning/DifficultyCheckDialog';
import { OGTE_MIN_LEVEL, OGTE_MAX_LEVEL } from '@/lib/constants/onboarding';

function seedAllPages() {
  for (let level = OGTE_MIN_LEVEL; level <= OGTE_MAX_LEVEL; level++) {
    harness.pages.set(level, {
      exists: true,
      switchable: true,
      sentences: [
        {
          position: 0,
          sourceText: `source L${level}`,
          targetText: `target L${level}`,
        },
      ],
    });
  }
}

function renderDialog(props?: { open?: boolean; currentLevel?: number }) {
  const onDone = vi.fn();
  const view = render(
    <DifficultyCheckDialog
      open={props?.open ?? true}
      currentLevel={props?.currentLevel ?? 5}
      onDone={onDone}
    />,
  );
  return { onDone, view };
}

const level = () => screen.getByTestId('difficulty-check-level').textContent;
const harder = () => screen.getByTestId('difficulty-check-harder');
const easier = () => screen.getByTestId('difficulty-check-easier');
const confirm = () => screen.getByTestId('difficulty-check-confirm');

describe('DifficultyCheckDialog', () => {
  beforeEach(() => {
    harness.setActiveCollectionByLevel.mockClear();
    harness.setActiveCollectionByLevel.mockImplementation(() =>
      Promise.resolve(null),
    );
    harness.toastError.mockClear();
    harness.pages.clear();
    seedAllPages();
  });

  it('renders nothing while closed', () => {
    renderDialog({ open: false });
    expect(
      screen.queryByTestId('difficulty-check-dialog'),
    ).not.toBeInTheDocument();
  });

  it('opens on the course level: padded number, CEFR badge, that level’s upcoming sentences, "keep" CTA', () => {
    renderDialog({ currentLevel: 5 });
    expect(level()).toBe('05');
    expect(screen.getByText('A2')).toBeInTheDocument(); // cefrForOgte(5)
    expect(screen.getByText('target L5')).toBeInTheDocument();
    expect(confirm()).toHaveTextContent('keep');
  });

  it('keep without paging calls onDone once and never the mutation', async () => {
    const { onDone } = renderDialog();
    fireEvent.click(confirm());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(harness.setActiveCollectionByLevel).not.toHaveBeenCalled();
  });

  it('paging harder previews the new level and switches the CTA', () => {
    renderDialog({ currentLevel: 5 });
    fireEvent.click(harder());
    expect(level()).toBe('06');
    expect(screen.getByText('target L6')).toBeInTheDocument();
    expect(confirm()).toHaveTextContent('switchTo');
  });

  it('confirming a paged level calls the mutation exactly once with that level, then onDone', async () => {
    const { onDone } = renderDialog({ currentLevel: 5 });
    fireEvent.click(harder());
    fireEvent.click(confirm());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(harness.setActiveCollectionByLevel).toHaveBeenCalledExactlyOnceWith({
      ogteLevel: 6,
    });
  });

  it('paging easier twice accumulates: confirm sends the final level', async () => {
    const { onDone } = renderDialog({ currentLevel: 5 });
    fireEvent.click(easier());
    fireEvent.click(easier());
    expect(level()).toBe('03');
    fireEvent.click(confirm());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(harness.setActiveCollectionByLevel).toHaveBeenCalledExactlyOnceWith({
      ogteLevel: 3,
    });
  });

  it('a second click while the switch is in flight cannot double-submit', async () => {
    let resolveSwitch!: (v: null) => void;
    harness.setActiveCollectionByLevel.mockImplementation(
      () => new Promise<null>((resolve) => (resolveSwitch = resolve)),
    );
    const { onDone } = renderDialog({ currentLevel: 5 });
    fireEvent.click(harder());
    fireEvent.click(confirm());
    // In flight: button shows the switching state and is disabled.
    expect(confirm()).toBeDisabled();
    fireEvent.click(confirm());
    resolveSwitch(null);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(harness.setActiveCollectionByLevel).toHaveBeenCalledTimes(1);
  });

  it('chevrons stop at the ends of the 1..20 scale', () => {
    const { view } = renderDialog({ currentLevel: OGTE_MIN_LEVEL });
    expect(easier()).toBeDisabled();
    expect(harder()).not.toBeDisabled();
    view.unmount();

    renderDialog({ currentLevel: OGTE_MAX_LEVEL });
    expect(harder()).toBeDisabled();
    expect(easier()).not.toBeDisabled();
  });

  it('a neighbour known to be unswitchable disables its chevron; a still-loading neighbour stays steppable', () => {
    // Level 6 exists but the user already completed it.
    harness.pages.set(6, { exists: true, switchable: false, sentences: [] });
    // Level 4 hasn't answered yet.
    harness.pages.delete(4);
    renderDialog({ currentLevel: 5 });
    expect(harder()).toBeDisabled();
    expect(easier()).not.toBeDisabled();
  });

  it('arrow keys page levels', () => {
    renderDialog({ currentLevel: 5 });
    const dialog = screen.getByTestId('difficulty-check-dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(level()).toBe('06');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(level()).toBe('04');
  });

  it('a non-existent page shows the unavailable notice instead of sentence rows', () => {
    harness.pages.set(5, { exists: false, switchable: false, sentences: [] });
    renderDialog({ currentLevel: 5 });
    expect(screen.getByText('levelUnavailable')).toBeInTheDocument();
    expect(screen.queryByText('target L5')).not.toBeInTheDocument();
  });

  it('dismissing the dialog counts as keep: onDone once, no mutation, even with a paged level', async () => {
    const { onDone } = renderDialog({ currentLevel: 5 });
    fireEvent.click(harder());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(harness.setActiveCollectionByLevel).not.toHaveBeenCalled();
  });

  it('a failed switch keeps the dialog open: toast shown, no onDone, confirm re-enabled', async () => {
    harness.setActiveCollectionByLevel.mockImplementation(() =>
      Promise.reject(new Error('level completed')),
    );
    const { onDone } = renderDialog({ currentLevel: 5 });
    fireEvent.click(harder());
    fireEvent.click(confirm());
    await waitFor(() => expect(harness.toastError).toHaveBeenCalledTimes(1));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('difficulty-check-dialog')).toBeInTheDocument();
    expect(confirm()).not.toBeDisabled();
  });

  it('re-opening re-arms the pager at the course level', () => {
    const onDone = vi.fn();
    const { rerender } = render(
      <DifficultyCheckDialog open currentLevel={5} onDone={onDone} />,
    );
    fireEvent.click(harder());
    expect(level()).toBe('06');
    rerender(
      <DifficultyCheckDialog open={false} currentLevel={5} onDone={onDone} />,
    );
    rerender(<DifficultyCheckDialog open currentLevel={5} onDone={onDone} />);
    expect(level()).toBe('05');
  });
});
