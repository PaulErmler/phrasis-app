import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * EditCardDialog with stored writing alternatives: the card sentence stays
 * the plain top field (no delete icon), the user's accepted answers render
 * under their language as editable rows with delete/undo, and Save routes
 * each change to the right mutation — editCard only when a sentence
 * changed (it burns card_edits quota), the alternative mutations otherwise.
 */

const {
  editCardMock,
  updateAlternativeMock,
  deleteAlternativeMock,
  listForCardState,
} = vi.hoisted(() => ({
  editCardMock: vi.fn().mockResolvedValue(null),
  updateAlternativeMock: vi.fn().mockResolvedValue(null),
  deleteAlternativeMock: vi.fn().mockResolvedValue(null),
  listForCardState: { rows: [] as unknown[] },
}));

vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>();
  const { getFunctionName } = await import('convex/server');
  return {
    ...actual,
    useQuery: (_ref: unknown, args: unknown) =>
      args === 'skip' ? undefined : listForCardState.rows,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'features/scheduling:editCard') return editCardMock;
      if (name === 'features/writingAlternatives:updateAlternative')
        return updateAlternativeMock;
      if (name === 'features/writingAlternatives:deleteAlternative')
        return deleteAlternativeMock;
      throw new Error(`Unexpected mutation: ${name}`);
    },
  };
});
vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: () => <div data-testid="usage-limit-dialog" />,
}));

import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import type { CardTranslation } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

const CARD_ID = 'card_1' as Id<'cards'>;
const ALT_1 = 'alt_1';
const ALT_2 = 'alt_2';

const TRANSLATIONS: CardTranslation[] = [
  {
    language: 'en',
    text: 'I would like a coffee.',
    isBaseLanguage: true,
    isTargetLanguage: false,
  },
  {
    language: 'es',
    text: 'Quisiera un café.',
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
];

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <EditCardDialog
      open
      onOpenChange={onOpenChange}
      cardId={CARD_ID}
      translations={TRANSLATIONS}
    />,
  );
  return onOpenChange;
}

describe('EditCardDialog: accepted alternatives', () => {
  beforeEach(() => {
    editCardMock.mockClear();
    updateAlternativeMock.mockClear();
    deleteAlternativeMock.mockClear();
    listForCardState.rows = [
      { _id: ALT_1, language: 'es', text: 'Me gustaría un café.' },
      { _id: ALT_2, language: 'es', text: 'Querría un café.' },
    ];
  });

  it('lists the alternatives under their language, below the card sentence, without touching base rows', () => {
    renderDialog();
    const group = screen.getByTestId('edit-alternatives-es');
    expect(group).toHaveTextContent('alternativesLabel');
    expect(
      screen.getByDisplayValue('Me gustaría un café.'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Querría un café.')).toBeInTheDocument();
    // The card sentence keeps its plain field at the top of the block.
    expect(screen.getByDisplayValue('Quisiera un café.')).toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-alternatives-en'),
    ).not.toBeInTheDocument();
    // Exactly one delete icon per alternative — none for the sentences.
    expect(
      screen.getAllByRole('button', { name: 'deleteAlternative' }),
    ).toHaveLength(2);
  });

  it('saves a reworded alternative via updateAlternative without calling editCard', async () => {
    const onOpenChange = renderDialog();
    fireEvent.change(screen.getByDisplayValue('Me gustaría un café.'), {
      target: { value: 'Me encantaría un café.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateAlternativeMock).toHaveBeenCalledExactlyOnceWith({
      alternativeId: ALT_1,
      text: 'Me encantaría un café.',
    });
    expect(editCardMock).not.toHaveBeenCalled();
    expect(deleteAlternativeMock).not.toHaveBeenCalled();
  });

  it('marks a row deleted (undoable) and deletes it on save', async () => {
    const onOpenChange = renderDialog();
    const [firstDelete] = screen.getAllByRole('button', {
      name: 'deleteAlternative',
    });
    fireEvent.click(firstDelete);
    // Undo affordance appears; the input is disabled until save or undo.
    expect(
      screen.getByRole('button', { name: 'undoDeleteAlternative' }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Me gustaría un café.')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(deleteAlternativeMock).toHaveBeenCalledExactlyOnceWith({
      alternativeId: ALT_1,
    });
    expect(editCardMock).not.toHaveBeenCalled();
    expect(updateAlternativeMock).not.toHaveBeenCalled();
  });

  it('undo restores the row so save touches nothing', () => {
    renderDialog();
    const [firstDelete] = screen.getAllByRole('button', {
      name: 'deleteAlternative',
    });
    fireEvent.click(firstDelete);
    fireEvent.click(
      screen.getByRole('button', { name: 'undoDeleteAlternative' }),
    );
    expect(screen.getByDisplayValue('Me gustaría un café.')).not.toBeDisabled();
    // Nothing pending — save stays disabled.
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
  });

  it('still calls editCard when a sentence changed, alongside alternative edits', async () => {
    const onOpenChange = renderDialog();
    fireEvent.change(screen.getByDisplayValue('Quisiera un café.'), {
      target: { value: 'Quisiera un té.' },
    });
    const [firstDelete] = screen.getAllByRole('button', {
      name: 'deleteAlternative',
    });
    fireEvent.click(firstDelete);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(editCardMock).toHaveBeenCalledTimes(1);
    expect(deleteAlternativeMock).toHaveBeenCalledExactlyOnceWith({
      alternativeId: ALT_1,
    });
  });

  it('an emptied alternative blocks save instead of silently deleting', () => {
    renderDialog();
    fireEvent.change(screen.getByDisplayValue('Me gustaría un café.'), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
    expect(deleteAlternativeMock).not.toHaveBeenCalled();
  });

  /**
   * The learning view rebuilds the `translations` array on every render.
   * The draft used to be re-seeded from it on every identity change, which
   * flashed the stored sentence back into the fields while Save was pending
   * and could wipe a draft mid-typing.
   */
  it('keeps the typed draft when the parent rebuilds the translations prop while open', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <EditCardDialog
        open
        onOpenChange={onOpenChange}
        cardId={CARD_ID}
        translations={TRANSLATIONS}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Quisiera un café.'), {
      target: { value: 'Quisiera un té.' },
    });
    rerender(
      <EditCardDialog
        open
        onOpenChange={onOpenChange}
        cardId={CARD_ID}
        translations={TRANSLATIONS.map((tr) => ({ ...tr }))}
      />,
    );
    expect(screen.getByDisplayValue('Quisiera un té.')).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('Quisiera un café.'),
    ).not.toBeInTheDocument();
  });

  it('re-seeds the draft when re-opened', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <EditCardDialog
        open
        onOpenChange={onOpenChange}
        cardId={CARD_ID}
        translations={TRANSLATIONS}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Quisiera un café.'), {
      target: { value: 'Quisiera un té.' },
    });
    rerender(
      <EditCardDialog
        open={false}
        onOpenChange={onOpenChange}
        cardId={CARD_ID}
        translations={TRANSLATIONS}
      />,
    );
    rerender(
      <EditCardDialog
        open
        onOpenChange={onOpenChange}
        cardId={CARD_ID}
        translations={TRANSLATIONS}
      />,
    );
    expect(screen.getByDisplayValue('Quisiera un café.')).toBeInTheDocument();
  });
});
