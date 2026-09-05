import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Integration suite for the collection browse dialog: the REAL
// useCollectionDetail hook drives the REAL CollectionDetailDialog, with the
// Convex layer mocked at the convex/react boundary (same house style as
// LibraryView.test.tsx: api refs carry __mockKey tags, useMutation dispatches
// on them, and usePaginatedQuery serves test-controlled pages keyed by the
// browse direction).
// ---------------------------------------------------------------------------
function makeMutationMock() {
  const fn = vi.fn().mockResolvedValue(null) as ReturnType<typeof vi.fn> & {
    withOptimisticUpdate: (cb: unknown) => typeof fn;
  };
  fn.withOptimisticUpdate = () => fn;
  return fn;
}

const addCardsFn = makeMutationMock();
const addSingleFn = makeMutationMock();
const setMarkFn = makeMutationMock();
const requestTranslationsFn = makeMutationMock();
const prewarmTranslationsFn = makeMutationMock();
const requestAudioFn = makeMutationMock();

type PaginatedPage = {
  results: unknown[];
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  loadMore: ReturnType<typeof vi.fn>;
  isLoading: boolean;
};

const forwardLoadMore = vi.fn();
const earlierLoadMore = vi.fn();
// Reassigned per test (fresh object identity re-fires the hook's effects).
let forwardPage: PaginatedPage;
let earlierPage: PaginatedPage;

function setForwardPage(
  results: unknown[],
  status: PaginatedPage['status'] = 'Exhausted',
) {
  forwardPage = {
    results,
    status,
    loadMore: forwardLoadMore,
    isLoading: false,
  };
}
function setEarlierPage(
  results: unknown[],
  status: PaginatedPage['status'] = 'Exhausted',
) {
  earlierPage = {
    results,
    status,
    loadMore: earlierLoadMore,
    isLoading: false,
  };
}

const usePaginatedQueryMock = vi.fn(
  (_ref: unknown, args: unknown, _opts: unknown): PaginatedPage => {
    if (args === 'skip') {
      return {
        results: [],
        status: 'LoadingFirstPage',
        loadMore: vi.fn(),
        isLoading: true,
      };
    }
    return (args as { direction: string }).direction === 'after'
      ? forwardPage
      : earlierPage;
  },
);

vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) =>
    usePaginatedQueryMock(
      ...(args as Parameters<typeof usePaginatedQueryMock>),
    ),
  useMutation: (ref: { __mockKey?: string }) => {
    switch (ref.__mockKey) {
      case 'addCardsFromCollection':
        return addCardsFn;
      case 'addSingleTextFromCollection':
        return addSingleFn;
      case 'setCollectionTextMark':
        return setMarkFn;
      case 'requestPreviewTranslations':
        return requestTranslationsFn;
      case 'prewarmPreviewTranslations':
        return prewarmTranslationsFn;
      case 'requestPreviewAudio':
        return requestAudioFn;
      default:
        return makeMutationMock();
    }
  },
  usePreloadedQuery: () => ({
    highlightWords: false,
    showIpa: false,
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    features: {
      decks: {
        addCardsFromCollection: { __mockKey: 'addCardsFromCollection' },
        addSingleTextFromCollection: {
          __mockKey: 'addSingleTextFromCollection',
        },
      },
      collections: {
        browseCollectionTexts: { __mockKey: 'browseCollectionTexts' },
        setCollectionTextMark: { __mockKey: 'setCollectionTextMark' },
        requestPreviewTranslations: { __mockKey: 'requestPreviewTranslations' },
        prewarmPreviewTranslations: { __mockKey: 'prewarmPreviewTranslations' },
        requestPreviewAudio: { __mockKey: 'requestPreviewAudio' },
      },
      home: {
        getHomeSummary: { __mockKey: 'getHomeSummary' },
      },
    },
  },
}));

// Quota: unlimited by default so the "+Add N" surface renders unlocked.
let quotaState = {
  balance: 0,
  included: 0,
  used: 0,
  unlimited: true,
  isAvailable: true,
  isLoading: false,
};
vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => quotaState,
}));

vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({ preloadedCourseSettings: {} }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

vi.mock('@/lib/report-error', () => ({ reportError: vi.fn() }));

// The global tests/setup.ts translator stub is a bare function; the dialog's
// description lookup also calls `tDesc.has(key)` (next-intl's rich
// translator). Override with an identity-stable translator that carries a
// `has` that reports every key missing, so descriptions fall back to the raw
// collection name.
vi.mock('next-intl', () => {
  const stubTranslator = Object.assign((key: string) => key, {
    has: () => false,
  });
  return {
    useTranslations: () => stubTranslator,
    useLocale: () => 'en',
  };
});

// Row-internal presentation: not under test, keep the tree light. The
// AudioButton stub still exposes the generate hook so onRequestAudio's
// plumbing into requestPreviewAudio stays covered.
vi.mock('@/components/app/learning/HighlightedText', () => ({
  HighlightedText: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock('@/components/app/learning/AnnotationLines', () => ({
  AnnotationLines: () => null,
}));
vi.mock('@/components/app/learning/AudioButton', () => ({
  AudioButton: ({
    language,
    onRequestGenerate,
  }: {
    language: string;
    onRequestGenerate?: () => void;
  }) => (
    <button
      data-testid={`audio-generate-${language}`}
      onClick={() => onRequestGenerate?.()}
    >
      audio
    </button>
  ),
}));

import { CollectionDetailDialog } from '@/components/app/CollectionDetailDialog';
import { useCollectionDetail } from '@/components/app/useCollectionDetail';
import type { CollectionProgressItem } from '@/components/app/CollectionCarouselUI';
import {
  COLLECTION_PREVIEW_SIZE,
  PREVIEW_FIRST_PAGE_SIZE,
  PREVIEW_PAGE_SIZE,
} from '@/convex/lib/collections';

const COLLECTION: CollectionProgressItem = {
  collectionId: 'col1',
  collectionName: 'A1.1',
  cardsAdded: 2,
  ignoredCount: 0,
  prioritizedCount: 0,
  browseAnchor: 2,
  totalTexts: 10,
};

type Row = {
  _id: string;
  status: 'added' | 'prioritized' | 'ignored' | 'none';
  collectionRank: number;
  text: string;
  sourceLanguage: string;
  translations: Array<{
    language: string;
    text: string;
    isBaseLanguage: boolean;
    isTargetLanguage: boolean;
  }>;
  audioRecordings: unknown[];
  missingTranslationLanguages: string[];
  needsAnnotationBackfill: boolean;
};

function makeRow(overrides: Partial<Row> & { _id: string }): Row {
  return {
    status: 'none',
    collectionRank: 3,
    text: 'Hola',
    sourceLanguage: 'es',
    translations: [
      {
        language: 'en',
        text: `en-${overrides._id}`,
        isBaseLanguage: true,
        isTargetLanguage: false,
      },
      {
        language: 'es',
        text: `es-${overrides._id}`,
        isBaseLanguage: false,
        isTargetLanguage: true,
      },
    ],
    audioRecordings: [],
    missingTranslationLanguages: [],
    needsAnnotationBackfill: false,
    ...overrides,
  };
}

/**
 * Harness wiring the real hook to the real dialog the way CollectionCarousel
 * does. The open button snapshots the browse anchor; the dialog receives the
 * live browse object.
 */
function Harness({
  collections = [COLLECTION],
}: {
  collections?: CollectionProgressItem[];
}) {
  const detail = useCollectionDetail({ collections });
  const opened = detail.openedCollection;
  return (
    <>
      <button
        data-testid="open-dialog"
        onClick={() => detail.setOpenCollectionId(COLLECTION.collectionId)}
      >
        open
      </button>
      <CollectionDetailDialog
        open={detail.openCollectionId !== null}
        onOpenChange={(open) => {
          if (!open) detail.setOpenCollectionId(null);
        }}
        collectionName={opened?.collectionName ?? null}
        totalTexts={opened?.totalTexts ?? 0}
        cardsAdded={opened?.cardsAdded ?? 0}
        ignoredCount={opened?.ignoredCount ?? 0}
        prioritizedCount={opened?.prioritizedCount ?? 0}
        isActive={false}
        isComplete={detail.isOpenedComplete}
        browse={detail.browse}
        isAdding={detail.isAdding}
        onSelect={() => {}}
        onAddCards={() => void detail.handleAddCards()}
        sentencesRemaining={detail.sentencesRemaining}
      />
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  const view = render(<Harness />);
  await user.click(screen.getByTestId('open-dialog'));
  return { user, ...view };
}

beforeEach(() => {
  addCardsFn.mockReset().mockResolvedValue(null);
  addSingleFn.mockReset().mockResolvedValue(null);
  setMarkFn.mockReset().mockResolvedValue(null);
  requestTranslationsFn.mockReset().mockResolvedValue(null);
  prewarmTranslationsFn.mockReset().mockResolvedValue(null);
  requestAudioFn.mockReset().mockResolvedValue({ scheduled: true });
  forwardLoadMore.mockClear();
  earlierLoadMore.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
  usePaginatedQueryMock.mockClear();
  quotaState = {
    balance: 0,
    included: 0,
    used: 0,
    unlimited: true,
    isAvailable: true,
    isLoading: false,
  };
  setForwardPage([makeRow({ _id: 'text1', collectionRank: 3 })]);
  setEarlierPage([]);
});

describe('CollectionDetailDialog browse query wiring', () => {
  it('runs the forward browse query anchored at the collection frontier once opened', async () => {
    await openDialog();

    expect(usePaginatedQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ __mockKey: 'browseCollectionTexts' }),
      expect.anything(),
      expect.anything(),
    );
    const forwardCall = usePaginatedQueryMock.mock.calls.find(
      ([, args]) =>
        args !== 'skip' &&
        (args as { direction: string }).direction === 'after',
    );
    expect(forwardCall?.[1]).toEqual({
      collectionId: 'col1',
      anchorRank: 2,
      direction: 'after',
    });
    expect(forwardCall?.[2]).toEqual({
      initialNumItems: PREVIEW_FIRST_PAGE_SIZE,
    });
    // The added-history feed stays skipped until "show added" is toggled on.
    const earlierCall = usePaginatedQueryMock.mock.calls.find(
      ([, args]) =>
        args !== 'skip' && (args as { direction: string }).direction === 'upTo',
    );
    expect(earlierCall).toBeUndefined();
    // Rows from the served page render.
    expect(screen.getByTestId('collection-text-none')).toBeInTheDocument();
    expect(screen.getByText('en-text1')).toBeInTheDocument();
  });

  it('mounts the upTo history query when "show added" is toggled on', async () => {
    setEarlierPage([
      makeRow({ _id: 'old1', status: 'added', collectionRank: 1 }),
    ]);
    const { user } = await openDialog();

    await user.click(screen.getByTestId('collection-show-added-toggle'));

    const earlierCall = usePaginatedQueryMock.mock.calls.find(
      ([, args]) =>
        args !== 'skip' && (args as { direction: string }).direction === 'upTo',
    );
    expect(earlierCall?.[1]).toEqual({
      collectionId: 'col1',
      anchorRank: 2,
      direction: 'upTo',
    });
    expect(screen.getByTestId('collection-text-added')).toBeInTheDocument();
  });

  it('the added-count stat toggles the same history feed as "show added"', async () => {
    setEarlierPage([
      makeRow({ _id: 'old1', status: 'added', collectionRank: 1 }),
    ]);
    const { user } = await openDialog();

    await user.click(screen.getByTestId('collection-added-stat'));

    expect(screen.getByTestId('collection-show-added-toggle')).toHaveAttribute(
      'data-state',
      'on',
    );
    expect(screen.getByTestId('collection-text-added')).toBeInTheDocument();

    await user.click(screen.getByTestId('collection-added-stat'));
    expect(screen.getByTestId('collection-show-added-toggle')).toHaveAttribute(
      'data-state',
      'off',
    );
    expect(
      screen.queryByTestId('collection-text-added'),
    ).not.toBeInTheDocument();
  });
});

describe('CollectionDetailDialog row actions', () => {
  it('single add calls addSingleTextFromCollection with the row id, spins while pending, then settles to the server row', async () => {
    let resolveAdd: (value: unknown) => void = () => {};
    addSingleFn.mockImplementation(
      () => new Promise((resolve) => (resolveAdd = resolve)),
    );
    const { user, rerender } = await openDialog();

    const addButton = screen.getByTestId('collection-text-add');
    await user.click(addButton);

    expect(addSingleFn).toHaveBeenCalledWith({ textId: 'text1' });
    // In-flight: the per-row button is disabled with its spinner.
    expect(addButton).toBeDisabled();

    resolveAdd(null);
    await waitFor(() => expect(addButton).not.toBeDisabled());

    // Server settles: the reactive page now reports the row as added. The
    // row recolors to the added state and loses its action buttons.
    setForwardPage([
      makeRow({ _id: 'text1', collectionRank: 3, status: 'added' }),
    ]);
    rerender(<Harness />);
    expect(screen.getByTestId('collection-text-added')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-text-add')).not.toBeInTheDocument();
  });

  it('prioritize calls setCollectionTextMark with mark prioritized, and clears it from a prioritized row', async () => {
    const { user, rerender } = await openDialog();

    await user.click(screen.getByTestId('collection-text-prioritize'));
    expect(setMarkFn).toHaveBeenCalledWith({
      textId: 'text1',
      mark: 'prioritized',
    });

    // Server settles to prioritized; clicking again clears the mark.
    setForwardPage([
      makeRow({ _id: 'text1', collectionRank: 3, status: 'prioritized' }),
    ]);
    rerender(<Harness />);
    expect(
      screen.getByTestId('collection-text-prioritized'),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('collection-text-prioritize'));
    expect(setMarkFn).toHaveBeenLastCalledWith({ textId: 'text1', mark: null });
  });

  it('ignore calls setCollectionTextMark with mark ignored', async () => {
    const { user } = await openDialog();

    await user.click(screen.getByTestId('collection-text-ignore'));
    expect(setMarkFn).toHaveBeenCalledWith({
      textId: 'text1',
      mark: 'ignored',
    });
  });

  it('an ignored row stays visible this session (pinned) even with showIgnored off', async () => {
    const { rerender } = await openDialog();

    // Simulate the reactive settle after ignoring: status flips in place.
    setForwardPage([
      makeRow({ _id: 'text1', collectionRank: 3, status: 'ignored' }),
    ]);
    rerender(<Harness />);
    // showIgnored is off, but the observed none→ignored transition pins the
    // row for the rest of the session.
    expect(screen.getByTestId('collection-text-ignored')).toBeInTheDocument();
  });

  it('the audio button requests preview audio for its row and language', async () => {
    const { user } = await openDialog();

    await user.click(screen.getByTestId('audio-generate-es'));
    expect(requestAudioFn).toHaveBeenCalledWith({
      textId: 'text1',
      language: 'es',
    });
  });
});

describe('CollectionDetailDialog batch add', () => {
  it('Add N calls addCardsFromCollection with the collection id and default batch size', async () => {
    addCardsFn.mockResolvedValue({ cardsAdded: 5, scanIncomplete: false });
    const { user } = await openDialog();

    await user.click(screen.getByRole('button', { name: /addN/ }));

    await waitFor(() =>
      expect(addCardsFn).toHaveBeenCalledWith({
        collectionId: 'col1',
        batchSize: COLLECTION_PREVIEW_SIZE,
        exclusive: true,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('clamps the batch size to the remaining sentences quota', async () => {
    quotaState = { ...quotaState, unlimited: false, balance: 2 };
    addCardsFn.mockResolvedValue({ cardsAdded: 2, scanIncomplete: false });
    const { user } = await openDialog();

    await user.click(screen.getByRole('button', { name: /addN/ }));

    await waitFor(() =>
      expect(addCardsFn).toHaveBeenCalledWith({
        collectionId: 'col1',
        batchSize: 2,
        exclusive: true,
      }),
    );
  });

  it('shows the locked Upgrade button instead of Add N when the quota is exhausted', async () => {
    quotaState = { ...quotaState, unlimited: false, balance: 0 };
    await openDialog();

    expect(
      screen.queryByRole('button', { name: /addN/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upgrade/ })).toBeInTheDocument();
    expect(addCardsFn).not.toHaveBeenCalled();
  });
});

describe('CollectionDetailDialog pagination', () => {
  it('shows the skeleton while the first page loads', async () => {
    setForwardPage([], 'LoadingFirstPage');
    await openDialog();

    expect(
      screen.queryByTestId('collection-text-none'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('collection-load-more'),
    ).not.toBeInTheDocument();
  });

  it('Show more requests a full page and holds the button in its loading state until rows are revealed', async () => {
    setForwardPage(
      [makeRow({ _id: 'text1', collectionRank: 3 })],
      'CanLoadMore',
    );
    const { user, rerender } = await openDialog();

    const loadMoreButton = screen.getByTestId('collection-load-more');
    expect(loadMoreButton).not.toBeDisabled();
    await user.click(loadMoreButton);

    expect(forwardLoadMore).toHaveBeenCalledWith(PREVIEW_PAGE_SIZE);
    // Reveal gate: while the new page is fetching/translating the button
    // stays as a disabled spinner.
    expect(screen.getByTestId('collection-load-more')).toBeDisabled();

    // The next page lands with complete translations: rows reveal, the
    // button re-arms.
    setForwardPage(
      [
        makeRow({ _id: 'text1', collectionRank: 3 }),
        makeRow({ _id: 'text2', collectionRank: 4 }),
      ],
      'CanLoadMore',
    );
    rerender(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('collection-load-more')).not.toBeDisabled(),
    );
    expect(screen.getByText('en-text2')).toBeInTheDocument();
  });

  it('load earlier pages the history feed', async () => {
    setEarlierPage(
      [makeRow({ _id: 'old1', status: 'added', collectionRank: 1 })],
      'CanLoadMore',
    );
    const { user } = await openDialog();

    await user.click(screen.getByTestId('collection-show-added-toggle'));
    await user.click(screen.getByTestId('collection-load-earlier'));
    expect(earlierLoadMore).toHaveBeenCalledWith(PREVIEW_PAGE_SIZE);
  });
});
