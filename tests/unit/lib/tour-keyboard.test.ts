import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bindTourKeyboard,
  shouldAdvanceTourOnEnter,
} from '@/lib/tutorials/driver-common';

/**
 * Enter used to dismiss tours because driver.js focuses the close button
 * (first focusable in the popover). These tests pin the replacement:
 * Enter advances, last-step Enter still calls moveNext (driver.js closes
 * when there is no next step), Esc is left to driver.js.
 */

function keyEvent(
  init: Partial<KeyboardEventInit> & { keyCode?: number } = {},
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init });
  if (init.keyCode !== undefined) {
    Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  }
  return e;
}

describe('shouldAdvanceTourOnEnter', () => {
  it('advances on a plain Enter', () => {
    expect(shouldAdvanceTourOnEnter(keyEvent())).toBe(true);
  });

  it('ignores every key that is not Enter', () => {
    for (const key of [' ', 'Tab', 'ArrowRight', 'a', 'Escape']) {
      expect(shouldAdvanceTourOnEnter(keyEvent({ key })), key).toBe(false);
    }
  });

  it('ignores auto-repeat, so a held Enter cannot skip several steps', () => {
    expect(shouldAdvanceTourOnEnter(keyEvent({ repeat: true }))).toBe(false);
  });

  it('ignores modifier chords', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(shouldAdvanceTourOnEnter(keyEvent({ [mod]: true })), mod).toBe(false);
    }
  });

  it('stands down during IME composition', () => {
    expect(shouldAdvanceTourOnEnter(keyEvent({ isComposing: true }))).toBe(false);
    expect(shouldAdvanceTourOnEnter(keyEvent({ keyCode: 229 }))).toBe(false);
  });
});

describe('bindTourKeyboard', () => {
  const unbinds: Array<() => void> = [];

  afterEach(() => {
    while (unbinds.length > 0) unbinds.pop()!();
  });

  function bind(d: { isActive: () => boolean; moveNext: () => void }) {
    const unbind = bindTourKeyboard(d);
    unbinds.push(unbind);
    return d;
  }

  it('Enter calls moveNext while the tour is active', () => {
    const d = bind({ isActive: () => true, moveNext: vi.fn() });
    window.dispatchEvent(keyEvent());
    expect(d.moveNext).toHaveBeenCalledOnce();
  });

  it('Enter on the last step still calls moveNext, so driver.js dismisses', () => {
    // driver.js's moveNext() on the last step is the same path as clicking
    // Done: it destroys via onDestroyStarted. We must not call destroy()
    // ourselves, that skips the hook.
    const d = bind({ isActive: () => true, moveNext: vi.fn() });
    window.dispatchEvent(keyEvent());
    expect(d.moveNext).toHaveBeenCalledOnce();
  });

  it('prevents the default so a focused close button does not dismiss', () => {
    bind({ isActive: () => true, moveNext: vi.fn() });
    const e = keyEvent();
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('does not steal Esc, driver.js already dismisses on Escape', () => {
    const d = bind({ isActive: () => true, moveNext: vi.fn() });
    const e = keyEvent({ key: 'Escape' });
    window.dispatchEvent(e);
    expect(d.moveNext).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores Enter once the tour is no longer active', () => {
    const d = bind({ isActive: () => false, moveNext: vi.fn() });
    window.dispatchEvent(keyEvent());
    expect(d.moveNext).not.toHaveBeenCalled();
  });

  it('unbind removes the listener', () => {
    const d = { isActive: () => true, moveNext: vi.fn() };
    const unbind = bindTourKeyboard(d);
    unbind();
    window.dispatchEvent(keyEvent());
    expect(d.moveNext).not.toHaveBeenCalled();
  });
});
