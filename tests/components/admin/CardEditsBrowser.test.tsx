import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// The browser is a thin shell over one paginated query; the backend
// (convex/admin/cardEdits.ts) is covered elsewhere. Here the mocked
// usePaginatedQuery pins two contracts: which args each filter re-queries
// with, and that a stubbed result page renders every audit field.
// ---------------------------------------------------------------------------
const usePaginatedQueryMock = vi.fn();
const loadMoreMock = vi.fn();

vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    admin: {
      cardEdits: { listCardEdits: { __mockKey: 'listCardEdits' } },
    },
  },
}));

import { CardEditsBrowser } from '@/components/admin/CardEditsBrowser';
import { languageName } from '@/lib/languages';

type EditRow = Record<string, unknown>;

function makeEdit(overrides: EditRow = {}): EditRow {
  return {
    _id: 'edit1',
    _creationTime: Date.UTC(2026, 7, 1, 12, 0, 0),
    userId: 'user_42',
    kind: 'manual_edit',
    path: 'in_place',
    sourceText: 'Quisiera un café.',
    sourceLanguage: 'es',
    collectionOrigin: undefined,
    textWasUserCreated: false,
    changes: [
      {
        language: 'es',
        role: 'target',
        isSourceLanguage: true,
        soundsSame: false,
        beforeFlagCount: 0,
        before: 'Querría un café.',
        after: 'Quisiera un cafecito.',
      },
    ],
    retranslations: [],
    ...overrides,
  };
}

function setPage(
  results: EditRow[],
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'Exhausted' = 'Exhausted',
) {
  usePaginatedQueryMock.mockReturnValue({
    results,
    status,
    loadMore: loadMoreMock,
  });
}

beforeEach(() => {
  usePaginatedQueryMock.mockReset();
  loadMoreMock.mockClear();
  setPage([]);
});

describe('CardEditsBrowser query args', () => {
  it('queries all kinds (empty args) with a 20-item first page by default', () => {
    render(<CardEditsBrowser />);
    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ __mockKey: 'listCardEdits' }),
      {},
      { initialNumItems: 20 },
    );
  });

  it.each([
    ['Manual edit', 'manual_edit'],
    ['Chat replace', 'chat_also_correct'],
    ['Flag', 'flag'],
  ] as const)(
    're-queries with kind=%s when its filter is clicked',
    async (label, kind) => {
      const user = userEvent.setup();
      render(<CardEditsBrowser />);

      await user.click(screen.getByRole('button', { name: label }));
      expect(usePaginatedQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ __mockKey: 'listCardEdits' }),
        { kind },
        { initialNumItems: 20 },
      );
    },
  );

  it('returns to the unfiltered args when All is clicked after a kind filter', async () => {
    const user = userEvent.setup();
    render(<CardEditsBrowser />);

    await user.click(screen.getByRole('button', { name: 'Flag' }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(usePaginatedQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ __mockKey: 'listCardEdits' }),
      {},
      { initialNumItems: 20 },
    );
  });
});

describe('CardEditsBrowser page states', () => {
  it('shows the loading placeholder on the first page', () => {
    setPage([], 'LoadingFirstPage');
    render(<CardEditsBrowser />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the empty state when the log has no rows', () => {
    setPage([], 'Exhausted');
    render(<CardEditsBrowser />);
    expect(screen.getByText('No card edits yet')).toBeInTheDocument();
  });

  it('renders a Load more button while more pages exist and requests 20 more', async () => {
    const user = userEvent.setup();
    setPage([makeEdit()], 'CanLoadMore');
    render(<CardEditsBrowser />);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(loadMoreMock).toHaveBeenCalledWith(20);
  });

  it('hides Load more when the log is exhausted', () => {
    setPage([makeEdit()], 'Exhausted');
    render(<CardEditsBrowser />);
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });
});

describe('CardEditsBrowser row rendering', () => {
  it('renders the audit fields of an edit row: source, kind, change pair, footer', () => {
    setPage([makeEdit()]);
    render(<CardEditsBrowser />);

    expect(screen.getByText('Quisiera un café.')).toBeInTheDocument();
    expect(screen.getByText('manual edit')).toBeInTheDocument();
    // Change block: language name, role annotations, before (struck) / after.
    expect(screen.getByText(languageName('es'))).toBeInTheDocument();
    expect(screen.getByText('(target, source)')).toBeInTheDocument();
    const before = screen.getByText('Querría un café.');
    expect(before).toHaveClass('line-through');
    expect(screen.getByText('Quisiera un cafecito.')).not.toHaveClass(
      'line-through',
    );
    // Footer carries timestamp + user id.
    expect(screen.getByText(/user_42/)).toBeInTheDocument();
  });

  it('renders the optional badges: forked path, collection origin, own sentence', () => {
    setPage([
      makeEdit({
        path: 'fork',
        collectionOrigin: 'premade',
        textWasUserCreated: true,
      }),
    ]);
    render(<CardEditsBrowser />);

    expect(screen.getByText('forked')).toBeInTheDocument();
    expect(screen.getByText('premade')).toBeInTheDocument();
    expect(screen.getByText('own sentence')).toBeInTheDocument();
  });

  it('annotates a change with soundsSame and prior flag count', () => {
    setPage([
      makeEdit({
        changes: [
          {
            language: 'en',
            role: 'base',
            isSourceLanguage: false,
            soundsSame: true,
            beforeFlagCount: 2,
            before: 'I would want a coffee.',
            after: undefined, // flags carry no replacement wording
          },
        ],
      }),
    ]);
    render(<CardEditsBrowser />);

    expect(
      screen.getByText('(base, sounds same, 2 prior flag(s))'),
    ).toBeInTheDocument();
    // No `after` line for a flag-style change.
    expect(screen.getByText('I would want a coffee.')).toHaveClass(
      'line-through',
    );
  });

  it('renders retranslation rows with status tone label, rule, texts and source', () => {
    setPage([
      makeEdit({
        retranslations: [
          {
            _id: 'rt1',
            language: 'en',
            status: 'applied_audio_kept',
            rule: 'sounds-same',
            beforeText: 'I would want a coffee.',
            userSuggestion: 'I would like a coffee.',
            afterText: 'I would like a coffee, please.',
            afterTranslationSource: 'llm:gpt',
          },
        ],
      }),
    ]);
    render(<CardEditsBrowser />);

    expect(
      screen.getByText('Retranslations of the shared sentence'),
    ).toBeInTheDocument();
    // Underscores become spaces in the status label.
    expect(screen.getByText('applied audio kept')).toBeInTheDocument();
    expect(screen.getByText(/sounds-same/)).toBeInTheDocument();
    expect(screen.getByText('I would want a coffee.')).toBeInTheDocument();
    expect(
      screen.getByText('suggested: I would like a coffee.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('I would like a coffee, please.'),
    ).toBeInTheDocument();
    expect(screen.getByText('llm:gpt')).toBeInTheDocument();
  });
});
