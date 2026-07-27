import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { StepperImportView } from '@/components/app/import-texts/prototypes/StepperImportView';
import type { ImportController } from '@/components/app/import-texts/useImportController';

/**
 * The cell editor on the Review step saves on Enter, inserts a newline on
 * Shift+Enter and cancels on Escape — and both Enter and Escape are guarded by
 * `isComposingEvent`: during an IME conversion, Enter confirms the conversion
 * and Escape cancels it, so neither may commit or discard the cell edit.
 *
 * `useImeSafeEnter` is unit-tested on its own; these tests assert the editor
 * is actually *wired* to it, mirroring FullReviewCardContent.ime.test.tsx.
 */

const ROWS = [['It is hot today.', '今日は暑いですね。']];

function makeController(): ImportController {
  return {
    courseLanguages: ['en', 'ja'],
    input: 'It is hot today.\t今日は暑いですね。',
    setInput: vi.fn(),
    fileName: null,
    setFileName: vi.fn(),
    onFileSelected: vi.fn(),
    delimiter: 'auto',
    setDelimiter: vi.fn(),
    hasHeader: false,
    setHasHeader: vi.fn(),
    rows: ROWS,
    columnCount: 2,
    detectedDelimiter: '\t',
    mapping: { en: 0, ja: 1 },
    setMappingForLanguage: vi.fn(),
    resetMapping: vi.fn(),
    validation: {
      statuses: [
        {
          kind: 'valid',
          translations: [
            { language: 'en', text: ROWS[0][0] },
            { language: 'ja', text: ROWS[0][1] },
          ],
        },
      ],
      validCount: 1,
      warningCount: 0,
      errorCount: 0,
      importableCount: 1,
      mappingComplete: true,
      quotaSufficient: true,
      canImport: true,
    },
    dataRows: ROWS,
    dataRowAbsolute: [0],
    updateCell: vi.fn(),
    deleteRow: vi.fn(),
    quotaBalance: 10,
    quotaUnlimited: false,
    quotaLoading: false,
    isSubmitting: false,
    submit: vi.fn(),
    paywallOpen: false,
    setPaywallOpen: vi.fn(),
    reset: vi.fn(),
  };
}

/** Render, walk to the Review step and open the ja cell editor. */
function renderEditor() {
  const c = makeController();
  render(<StepperImportView c={c} />);
  fireEvent.click(screen.getByTestId('import-next')); // input -> map
  fireEvent.click(screen.getByTestId('import-next')); // map -> review
  fireEvent.click(screen.getByTestId('import-review-edit-0-ja'));
  return {
    c,
    editor: () =>
      screen.queryByTestId<HTMLTextAreaElement>('import-review-edit-input-0-ja'),
  };
}

/** Flush the deferred composition-end clear (one macrotask). */
function settleComposition() {
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

describe('StepperImportView — cell editor keydown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Enter commits the edited draft', () => {
    const { c, editor } = renderEditor();
    fireEvent.change(editor()!, { target: { value: '今日は寒いですね。' } });
    fireEvent.keyDown(editor()!, { key: 'Enter' });
    expect(c.updateCell).toHaveBeenCalledWith(0, 'ja', '今日は寒いですね。');
    expect(editor()).toBeNull();
  });

  it('Shift+Enter does not commit', () => {
    const { c, editor } = renderEditor();
    fireEvent.keyDown(editor()!, { key: 'Enter', shiftKey: true });
    expect(c.updateCell).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
  });

  it('Escape cancels without committing and discards the draft', () => {
    const { c, editor } = renderEditor();
    fireEvent.change(editor()!, { target: { value: 'typo in progress' } });
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(c.updateCell).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
    // Reopening seeds the draft from the cell again, not the discarded text.
    fireEvent.click(screen.getByTestId('import-review-edit-0-ja'));
    expect(editor()!.value).toBe('今日は暑いですね。');
  });

  it('does NOT commit on the Enter that confirms an IME conversion', () => {
    const { c, editor } = renderEditor();
    fireEvent.compositionStart(editor()!);
    fireEvent.change(editor()!, { target: { value: 'きょうは' } });
    fireEvent.keyDown(editor()!, { key: 'Enter', isComposing: true });
    expect(c.updateCell).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
  });

  it('does NOT cancel on the Escape that aborts an IME conversion', () => {
    const { c, editor } = renderEditor();
    fireEvent.compositionStart(editor()!);
    fireEvent.change(editor()!, { target: { value: 'きょうは' } });
    fireEvent.keyDown(editor()!, { key: 'Escape', isComposing: true });
    expect(editor()).not.toBeNull();
    expect(c.updateCell).not.toHaveBeenCalled();
  });

  it('does NOT commit on the legacy keyCode 229 signal', () => {
    const { c, editor } = renderEditor();
    fireEvent.change(editor()!, { target: { value: 'きょうは' } });
    fireEvent.keyDown(editor()!, { key: 'Enter', keyCode: 229 });
    expect(c.updateCell).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
  });

  it('suppresses Enter once when compositionend precedes keydown (Safari), then commits', () => {
    const { c, editor } = renderEditor();
    fireEvent.compositionStart(editor()!);
    fireEvent.change(editor()!, { target: { value: '今日は寒いですね。' } });
    // Safari <26 emits compositionend BEFORE the keydown that caused it.
    fireEvent.compositionEnd(editor()!);
    fireEvent.keyDown(editor()!, { key: 'Enter' });
    expect(c.updateCell).not.toHaveBeenCalled();

    settleComposition();
    fireEvent.keyDown(editor()!, { key: 'Enter' });
    expect(c.updateCell).toHaveBeenCalledWith(0, 'ja', '今日は寒いですね。');
    expect(editor()).toBeNull();
  });

  it('suppresses Escape once when compositionend precedes keydown (Safari), then cancels', () => {
    const { c, editor } = renderEditor();
    fireEvent.compositionStart(editor()!);
    fireEvent.change(editor()!, { target: { value: 'きょうは' } });
    fireEvent.compositionEnd(editor()!);
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(editor()).not.toBeNull();

    settleComposition();
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(editor()).toBeNull();
    expect(c.updateCell).not.toHaveBeenCalled();
  });
});
