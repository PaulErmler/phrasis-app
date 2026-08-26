import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { AppUpdateGate } from '@/components/app/AppUpdateGate';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import type { Id } from '@/convex/_generated/dataModel';
import type { CardTranslation } from '@/components/app/learning/types';

/**
 * EditCardDialog registers a reload block while it is open. Its draft lives
 * only in component state, and the dialog can be opened from LibraryView,
 * outside LearnView's blanket block. These tests render the *real* dialog
 * inside the real AppUpdateGate, so the regression they guard is the wiring
 * itself: someone dropping the `useReloadBlock(open)` call (or tying it to
 * mount instead of `open`) would let a silent reload eat an in-progress edit.
 */

// The only Convex touchpoint is the editCard mutation, which these tests never
// invoke. The reload block is registered by merely being open.
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn().mockResolvedValue(null),
}));

const reloadMock = vi.fn();
const toastInfoMock = vi.fn();

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfoMock(...args) },
}));

const NOW = new Date('2026-07-27T12:00:00Z').getTime();
const MINUTE = 60_000;

/** Matches the component's own defaults (no dev overrides set under vitest). */
const HIDDEN_LONG_ENOUGH_MS = 10 * MINUTE;

const NEWER_BUILD = 'newer-build';

const CARD_ID = 'card-1' as Id<'cards'>;
const TRANSLATIONS: CardTranslation[] = [
  {
    language: 'en',
    text: 'hello',
    isBaseLanguage: true,
    isTargetLanguage: false,
  },
  {
    language: 'es',
    text: 'hola',
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
];

function mockVersionResponse(buildId: string) {
  return {
    ok: true,
    json: async () => ({ buildId }),
  } as unknown as Response;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Hides the tab, waits `awayMs`, and brings it back. */
async function goAwayAndReturn(awayMs: number) {
  await act(async () => {
    setVisibility('hidden');
  });
  await act(async () => {
    vi.setSystemTime(Date.now() + awayMs);
    setVisibility('visible');
  });
}

/** Owns the dialog's open state, like LibraryView does in production. */
function Harness({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <AppUpdateGate>
      <EditCardDialog
        open={open}
        onOpenChange={setOpen}
        cardId={CARD_ID}
        translations={TRANSLATIONS}
      />
    </AppUpdateGate>
  );
}

/** Renders, then flushes the gate's mount-time version check. */
async function renderHarness(initialOpen: boolean) {
  const result = render(<Harness initialOpen={initialOpen} />);
  await act(async () => {});
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  reloadMock.mockClear();
  toastInfoMock.mockClear();
  sessionStorage.clear();
  setVisibility('visible');

  // jsdom's Location methods are non-configurable, so the whole object has to
  // be swapped rather than the reload method spied on.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, reload: reloadMock },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EditCardDialog reload block', () => {
  it('holds the silent reload while open, and releases it once closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderHarness(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // A long absence with an update pending would normally reload silently.
    // The open dialog is the only thing standing in the way.
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    expect(reloadMock).not.toHaveBeenCalled();

    // Close through the dialog's own Cancel button, the real unblock path.
    // (The next-intl stub renders translation keys verbatim.)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The blocked cycle never wrote the one-shot reload-attempt key (blocking
    // short-circuits before the attempt), so the same build reloads now.
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does not block the reload while mounted closed', async () => {
    // The block must track `open`, not mere presence in the tree. LibraryView
    // keeps the dialog mounted (closed) next to every card row.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderHarness(false);
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
