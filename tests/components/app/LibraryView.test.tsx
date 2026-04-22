import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Convex mocks — useQuery returns whatever the latest mockImplementation gives,
// so each test can drive what the live library result looks like. Each
// mutation is a fresh vi.fn so we can assert call shape per test.
// ---------------------------------------------------------------------------
const masterCardFn = vi.fn().mockResolvedValue(null);
const unmasterCardFn = vi.fn().mockResolvedValue(null);
const hideCardFn = vi.fn().mockResolvedValue(null);
const unhideCardFn = vi.fn().mockResolvedValue(null);
const toggleFavoriteFn = vi.fn().mockResolvedValue(null);
const deleteCardFn = vi.fn().mockResolvedValue(null);
const editCardFn = vi.fn().mockResolvedValue(null);

const useQueryMock = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (ref: { __mockKey?: string }) => {
    switch (ref.__mockKey) {
      case 'masterCard':
        return masterCardFn;
      case 'unmasterCard':
        return unmasterCardFn;
      case 'hideCard':
        return hideCardFn;
      case 'unhideCard':
        return unhideCardFn;
      case 'toggleFavoriteCard':
        return toggleFavoriteFn;
      case 'deleteCardPermanently':
        return deleteCardFn;
      case 'editCard':
        return editCardFn;
      default:
        return vi.fn();
    }
  },
  usePreloadedQuery: () => ({ highlightWords: true }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    features: {
      library: { getLibraryCards: { __mockKey: 'getLibraryCards' } },
      scheduling: {
        masterCard: { __mockKey: 'masterCard' },
        unmasterCard: { __mockKey: 'unmasterCard' },
        hideCard: { __mockKey: 'hideCard' },
        unhideCard: { __mockKey: 'unhideCard' },
        toggleFavoriteCard: { __mockKey: 'toggleFavoriteCard' },
        deleteCardPermanently: { __mockKey: 'deleteCardPermanently' },
        editCard: { __mockKey: 'editCard' },
      },
      usage: {
        helpers: { getFeatureUsage: { __mockKey: 'getFeatureUsage' } },
      },
    },
  },
}));

vi.mock('@/hooks/use-ensure-content', () => ({
  useEnsureContent: () => undefined,
}));

vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({ preloadedCourseSettings: {} }),
}));

vi.mock('@/components/app/NoCourseEmptyState', () => ({
  NoCourseEmptyState: () => <div data-testid="no-course" />,
}));

// Stub LearningCardContent with a thin shell that exposes the toggle state and
// dispatches the parent callbacks. We don't care about audio/translation
// rendering here — only that the sticky/toggle wiring is correct.
vi.mock('@/components/app/learning/LearningCardContent', () => ({
  LearningCardContent: (props: {
    sourceText: string;
    isMastered?: boolean;
    isHidden?: boolean;
    onMaster: () => void;
    onHide: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
  }) => (
    <div
      data-testid={`card-${props.sourceText}`}
      data-mastered={String(props.isMastered ?? false)}
      data-hidden={String(props.isHidden ?? false)}
    >
      <button
        data-testid={`master-${props.sourceText}`}
        onClick={props.onMaster}
      >
        master
      </button>
      <button
        data-testid={`hide-${props.sourceText}`}
        onClick={props.onHide}
      >
        hide
      </button>
      {props.onEdit && (
        <button
          data-testid={`edit-${props.sourceText}`}
          onClick={props.onEdit}
        >
          edit
        </button>
      )}
      {props.onDelete && (
        <button
          data-testid={`delete-${props.sourceText}`}
          onClick={props.onDelete}
        >
          delete
        </button>
      )}
    </div>
  ),
}));

// Stub EditCardDialog so we can detect it rendered without pulling in its
// dependency tree (it internally uses useMutation, quota hooks, etc. that
// would fight the simple convex/react mock above).
vi.mock('@/components/app/learning/EditCardDialog', () => ({
  EditCardDialog: (props: {
    open: boolean;
    cardId: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    props.open ? (
      <div data-testid={`edit-dialog-${props.cardId}`}>
        <button
          data-testid="edit-dialog-close"
          onClick={() => props.onOpenChange(false)}
        >
          close
        </button>
      </div>
    ) : null,
}));

import { LibraryView } from '@/components/app/LibraryView';

type Card = {
  _id: string;
  _creationTime: number;
  textId: string;
  sourceText: string;
  sourceLanguage: string;
  translations: never[];
  audioRecordings: never[];
  dueDate: number;
  isMastered: boolean;
  isHidden: boolean;
  isFavorite?: boolean;
  preReviewCount: number;
  schedulingPhase: 'preReview';
  fsrsState: null;
  hasMissingContent: boolean;
};

function makeCard(overrides: Partial<Card> & { _id: string; sourceText: string }): Card {
  return {
    _creationTime: 0,
    textId: `t-${overrides._id}`,
    sourceLanguage: 'es',
    translations: [],
    audioRecordings: [],
    dueDate: Date.now(),
    isMastered: false,
    isHidden: false,
    preReviewCount: 0,
    schedulingPhase: 'preReview',
    fsrsState: null,
    hasMissingContent: false,
    ...overrides,
  };
}

beforeEach(() => {
  masterCardFn.mockClear();
  unmasterCardFn.mockClear();
  hideCardFn.mockClear();
  unhideCardFn.mockClear();
  toggleFavoriteFn.mockClear();
  deleteCardFn.mockClear();
  editCardFn.mockClear();
  useQueryMock.mockReset();
});

describe('LibraryView master/hide toggle', () => {
  it('calls masterCard when clicking master on a non-mastered card', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isMastered: false }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('master-hola'));
    expect(masterCardFn).toHaveBeenCalledWith({ cardId: 'c1' });
    expect(unmasterCardFn).not.toHaveBeenCalled();
  });

  it('calls unmasterCard when clicking master on an already-mastered card', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isMastered: true }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('master-hola'));
    expect(unmasterCardFn).toHaveBeenCalledWith({ cardId: 'c1' });
    expect(masterCardFn).not.toHaveBeenCalled();
  });

  it('calls hideCard when clicking hide on a visible card', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isHidden: false }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('hide-hola'));
    expect(hideCardFn).toHaveBeenCalledWith({ cardId: 'c1' });
    expect(unhideCardFn).not.toHaveBeenCalled();
  });

  it('calls unhideCard when clicking hide on an already-hidden card', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isHidden: true }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('hide-hola'));
    expect(unhideCardFn).toHaveBeenCalledWith({ cardId: 'c1' });
    expect(hideCardFn).not.toHaveBeenCalled();
  });

  it('flips the rendered isMastered flag immediately after clicking master', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isMastered: false }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    expect(screen.getByTestId('card-hola').dataset.mastered).toBe('false');
    await user.click(screen.getByTestId('master-hola'));
    expect(screen.getByTestId('card-hola').dataset.mastered).toBe('true');
  });

  it('flips the rendered isHidden flag immediately after clicking hide', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isHidden: false }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    expect(screen.getByTestId('card-hola').dataset.hidden).toBe('false');
    await user.click(screen.getByTestId('hide-hola'));
    expect(screen.getByTestId('card-hola').dataset.hidden).toBe('true');
  });
});

describe('LibraryView sticky-card behavior', () => {
  it('keeps a card visible after the live query stops returning it (hide in default view)', async () => {
    const user = userEvent.setup();
    const visible = [
      makeCard({ _id: 'c1', sourceText: 'hola', isHidden: false }),
      makeCard({ _id: 'c2', sourceText: 'mundo', isHidden: false }),
    ];
    // First render: both cards live. After hiding c1, simulate the live query
    // refresh returning only c2 (the default view excludes hidden cards).
    useQueryMock.mockReturnValue(visible);
    const { rerender } = render(
      <LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />,
    );

    await user.click(screen.getByTestId('hide-hola'));

    useQueryMock.mockReturnValue([visible[1]]);
    rerender(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    // c1 is still on screen via the sticky map, with the hide flag flipped on.
    const stickyCard = screen.getByTestId('card-hola');
    expect(stickyCard).toBeInTheDocument();
    expect(stickyCard.dataset.hidden).toBe('true');
    expect(screen.getByTestId('card-mundo')).toBeInTheDocument();
  });

  it('keeps a card visible after unhide while the hidden filter is active', async () => {
    const user = userEvent.setup();
    const hiddenCards = [
      makeCard({ _id: 'c1', sourceText: 'hola', isHidden: true }),
    ];
    useQueryMock.mockReturnValue(hiddenCards);
    const { rerender } = render(
      <LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />,
    );

    await user.click(screen.getByTestId('hide-hola'));

    // Simulate the live query under the 'hidden' filter no longer returning c1
    // because it's now isHidden: false.
    useQueryMock.mockReturnValue([]);
    rerender(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    const stickyCard = screen.getByTestId('card-hola');
    expect(stickyCard).toBeInTheDocument();
    expect(stickyCard.dataset.hidden).toBe('false');
  });

  it('keeps a hidden sticky card at its original position', async () => {
    const user = userEvent.setup();
    const visible = [
      makeCard({ _id: 'c1', sourceText: 'alpha' }),
      makeCard({ _id: 'c2', sourceText: 'beta' }),
      makeCard({ _id: 'c3', sourceText: 'gamma' }),
    ];
    useQueryMock.mockReturnValue(visible);
    const { rerender } = render(
      <LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />,
    );

    // Hide the middle card; live query then drops it.
    await user.click(screen.getByTestId('hide-beta'));
    useQueryMock.mockReturnValue([visible[0], visible[2]]);
    rerender(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    const renderedTexts = screen
      .getAllByTestId(/^card-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(renderedTexts).toEqual(['card-alpha', 'card-beta', 'card-gamma']);
  });

  it('toggles back through unhide when clicking hide twice on a sticky card', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola', isHidden: false }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('hide-hola'));
    expect(hideCardFn).toHaveBeenCalledWith({ cardId: 'c1' });
    expect(screen.getByTestId('card-hola').dataset.hidden).toBe('true');

    // Live query in the default view no longer returns c1 — but sticky keeps
    // it visible. Clicking hide again must call unhideCard, not hideCard.
    await act(async () => {
      useQueryMock.mockReturnValue([]);
    });
    await user.click(screen.getByTestId('hide-hola'));
    expect(unhideCardFn).toHaveBeenCalledWith({ cardId: 'c1' });
    expect(screen.getByTestId('card-hola').dataset.hidden).toBe('false');
  });
});

describe('LibraryView edit flow', () => {
  it('opens the edit dialog when clicking edit on a card', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola' }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    expect(screen.queryByTestId('edit-dialog-c1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('edit-hola'));
    expect(screen.getByTestId('edit-dialog-c1')).toBeInTheDocument();
  });

  it('closes the edit dialog when the dialog requests close', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola' }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('edit-hola'));
    expect(screen.getByTestId('edit-dialog-c1')).toBeInTheDocument();
    await user.click(screen.getByTestId('edit-dialog-close'));
    expect(screen.queryByTestId('edit-dialog-c1')).not.toBeInTheDocument();
  });
});

describe('LibraryView delete flow', () => {
  it('does not call deleteCard when the confirm dialog is cancelled', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue([
      makeCard({ _id: 'c1', sourceText: 'hola' }),
    ]);

    render(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    await user.click(screen.getByTestId('delete-hola'));
    // AlertDialog renders the cancel button with the translation key (next-intl stub returns keys verbatim).
    await user.click(
      screen.getByRole('button', { name: 'actions.deleteConfirmCancel' }),
    );
    expect(deleteCardFn).not.toHaveBeenCalled();
    expect(screen.getByTestId('card-hola')).toBeInTheDocument();
  });

  it('calls deleteCard and drops the card once the live query stops returning it', async () => {
    const user = userEvent.setup();
    const both = [
      makeCard({ _id: 'c1', sourceText: 'hola' }),
      makeCard({ _id: 'c2', sourceText: 'mundo' }),
    ];
    useQueryMock.mockReturnValue(both);

    const { rerender } = render(
      <LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />,
    );

    await user.click(screen.getByTestId('delete-hola'));
    await user.click(
      screen.getByRole('button', { name: 'actions.deleteConfirmConfirm' }),
    );
    expect(deleteCardFn).toHaveBeenCalledWith({ cardId: 'c1' });

    // In production the deleteCard mutation invalidates getLibraryCards and
    // the subscription refires without the deleted row — simulate that here.
    useQueryMock.mockReturnValue([both[1]]);
    rerender(<LibraryView hasActiveCourse onOpenCourseMenu={() => {}} />);

    expect(screen.queryByTestId('card-hola')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-mundo')).toBeInTheDocument();
  });
});
