import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import {
  useImeSafeEnter,
  isComposingKeyEvent,
  isEditableTarget,
} from '@/hooks/use-ime-safe-enter';

function Harness({ onSubmit }: { onSubmit: () => void }) {
  const { compositionProps, isComposingEvent } = useImeSafeEnter();
  return (
    <input
      data-testid="field"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isComposingEvent(e)) onSubmit();
      }}
      {...compositionProps}
    />
  );
}

/** Flush the deferred `compositionend` clear (one macrotask). */
function flushCompositionClear() {
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

describe('useImeSafeEnter', () => {
  let onSubmit: ReturnType<typeof vi.fn<() => void>>;
  let field: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    onSubmit = vi.fn<() => void>();
    render(<Harness onSubmit={onSubmit} />);
    field = screen.getByTestId('field');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits on a plain Enter with no IME involved', () => {
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Enter during composition', () => {
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit when the native event reports isComposing', () => {
    // Some engines set the flag without us ever seeing compositionstart.
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on the legacy keyCode 229 IME signal', () => {
    // Older Safari / Android WebViews: no composition events, no isComposing.
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('ignores an Enter that arrives after compositionend in the same tick', () => {
    // Safari <26 fires compositionend BEFORE the keydown that caused it, so
    // clearing the flag synchronously would let the confirming Enter submit.
    fireEvent.compositionStart(field);
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits on the next Enter once composition has settled', () => {
    fireEvent.compositionStart(field);
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    flushCompositionClear();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('handles the full Japanese type → convert → submit sequence', () => {
    // Type kana, press Enter to convert to kanji, press Enter again to submit.
    fireEvent.compositionStart(field);
    fireEvent.compositionUpdate(field, { data: 'きょう' });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(field, { data: '今日' });
    flushCompositionClear();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('stays composing across a restarted composition', () => {
    fireEvent.compositionStart(field);
    fireEvent.compositionEnd(field);
    // A new composition begins before the deferred clear runs — the pending
    // clear must be cancelled, not left to fire mid-composition.
    fireEvent.compositionStart(field);
    flushCompositionClear();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('isComposingKeyEvent', () => {
  it('detects the standard flag', () => {
    const e = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true });
    expect(isComposingKeyEvent(e)).toBe(true);
  });

  it('detects the legacy keyCode', () => {
    const e = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 });
    expect(isComposingKeyEvent(e)).toBe(true);
  });

  it('is false for an ordinary Enter', () => {
    const e = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 });
    expect(isComposingKeyEvent(e)).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('matches text-entry elements', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
  });

  it('matches contenteditable elements and their descendants', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    host.appendChild(child);
    document.body.appendChild(host);
    expect(isEditableTarget(host)).toBe(true);
    expect(isEditableTarget(child)).toBe(true);
    host.remove();
  });

  it('does not match contenteditable="false"', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'false');
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(false);
    div.remove();
  });

  it('does not match ordinary elements or null', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
