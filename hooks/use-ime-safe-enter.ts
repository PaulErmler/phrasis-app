'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CompositionEventHandler, KeyboardEvent } from 'react';

/**
 * Guards "Enter submits" handlers against Input Method Editor (IME) composition.
 *
 * Japanese, Chinese, Korean and Vietnamese are typed through an IME: you type
 * kana / pinyin / jamo / Telex and press **Enter to confirm the conversion**.
 * That Enter is part of typing, not a submit gesture — treating it as submit
 * grades a half-composed answer. See `documentation/review_modes.md`.
 *
 * Four checks, because no single one is reliable across browsers:
 *
 * 1. `composingRef` — set from `compositionstart` / `compositionend`. The
 *    baseline signal; works everywhere composition events fire.
 * 2. `nativeEvent.isComposing` — the standard property. Not on React's
 *    SyntheticEvent, so it must be read off the native event.
 * 3. Deferred clear of `composingRef` — Safari on macOS fired `compositionend`
 *    *before* `keydown`, so on the confirming Enter both (1) and (2) already
 *    read false. WebKit only fixed the ordering in April 2026
 *    (https://bugs.webkit.org/show_bug.cgi?id=165004), so every older
 *    Safari/iOS in the field still needs this. One macrotask is far shorter
 *    than the gap between two deliberate keypresses, so a genuine second Enter
 *    still submits.
 * 4. `keyCode === 229` — the legacy "the IME is handling this key" signal, and
 *    the only one older Safari and some Android WebViews set correctly.
 *    Trade-off: a few IMEs (e.g. Doubao) report 229 for every key even in
 *    Latin mode, which suppresses Enter entirely for those users. Every call
 *    site keeps a visible submit/send button, so they are never stuck.
 *
 * Result, and what every major editor does: after an IME conversion the first
 * Enter confirms the text and the second one submits.
 *
 * Usage:
 * ```tsx
 * const { compositionProps, isComposingEvent } = useImeSafeEnter();
 * const onKeyDown = (e) => {
 *   if (e.key === 'Enter' && !isComposingEvent(e)) submit();
 * };
 * <input onKeyDown={onKeyDown} {...compositionProps} />
 * ```
 */
export function useImeSafeEnter() {
  const composingRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingClear = useCallback(() => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingClear, [cancelPendingClear]);

  const compositionProps = useMemo<{
    onCompositionStart: CompositionEventHandler<Element>;
    onCompositionEnd: CompositionEventHandler<Element>;
  }>(
    () => ({
      onCompositionStart: () => {
        cancelPendingClear();
        composingRef.current = true;
      },
      onCompositionEnd: () => {
        // Deferred — see (3) above. Never clear synchronously.
        cancelPendingClear();
        clearTimerRef.current = setTimeout(() => {
          clearTimerRef.current = null;
          composingRef.current = false;
        }, 0);
      },
    }),
    [cancelPendingClear],
  );

  /** True when this keydown belongs to an in-flight IME composition. */
  const isComposingEvent = useCallback((e: KeyboardEvent<Element>): boolean => {
    return (
      composingRef.current ||
      e.nativeEvent.isComposing ||
      e.nativeEvent.keyCode === 229
    );
  }, []);

  return { compositionProps, isComposingEvent };
}

/**
 * Non-hook variant for global (window-level) keydown listeners, which have no
 * element to attach composition handlers to. Covers checks (2) and (4) only —
 * that is all a listener outside the React tree can see.
 */
export function isComposingKeyEvent(e: globalThis.KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

/**
 * True when the event originated in a text-entry field. Global keydown
 * listeners must bail out on these, or they hijack ordinary typing — Space,
 * Enter and Escape all mean something inside an input.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (!(target instanceof HTMLElement)) return false;
  // `isContentEditable` is typed boolean but is undefined in jsdom and in some
  // older engines, so treat it as a hint and fall back to the attribute — which
  // `closest` also resolves for nodes nested inside an editable host.
  if (target.isContentEditable === true) return true;
  const host = target.closest('[contenteditable]');
  return !!host && host.getAttribute('contenteditable') !== 'false';
}
