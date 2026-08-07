import { describe, it, expect, afterEach } from 'vitest';

import { shouldAdvanceOnEnter } from '@/app/app/onboarding/lib/enterToAdvance';

/**
 * Enter acts as "Continue" through the onboarding wizard. The interesting part
 * is everything it must NOT do: hijack typing, break IME composition, or
 * double-fire on top of a focused control's own Enter handling.
 */

function keyEvent(
  target: EventTarget,
  init: Partial<KeyboardEventInit> & { keyCode?: number } = {},
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Enter', ...init });
  Object.defineProperty(e, 'target', { value: target });
  if (init.keyCode !== undefined) {
    Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  }
  return e;
}

function mount<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldAdvanceOnEnter', () => {
  it('advances on a plain Enter over inert content', () => {
    expect(shouldAdvanceOnEnter(keyEvent(mount(document.createElement('div'))))).toBe(
      true,
    );
  });

  it('ignores every key that is not Enter', () => {
    const div = mount(document.createElement('div'));
    for (const key of [' ', 'Tab', 'ArrowRight', 'a', 'Escape']) {
      expect(shouldAdvanceOnEnter(keyEvent(div, { key })), key).toBe(false);
    }
  });

  it('ignores auto-repeat, so a held Enter cannot skip several steps', () => {
    const div = mount(document.createElement('div'));
    expect(shouldAdvanceOnEnter(keyEvent(div, { repeat: true }))).toBe(false);
  });

  it('ignores modifier chords', () => {
    const div = mount(document.createElement('div'));
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(shouldAdvanceOnEnter(keyEvent(div, { [mod]: true })), mod).toBe(false);
    }
  });

  it('stands down inside text-entry fields', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      const el = mount(document.createElement(tag));
      expect(shouldAdvanceOnEnter(keyEvent(el)), tag).toBe(false);
    }
    const editable = mount(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    expect(shouldAdvanceOnEnter(keyEvent(editable))).toBe(false);
  });

  // ja/zh/ko/vi type through an IME where Enter CONFIRMS the conversion.
  it('stands down during IME composition', () => {
    const div = mount(document.createElement('div'));
    expect(shouldAdvanceOnEnter(keyEvent(div, { isComposing: true }))).toBe(false);
    // Legacy signal, the only one older Safari / some Android WebViews set.
    expect(shouldAdvanceOnEnter(keyEvent(div, { keyCode: 229 }))).toBe(false);
  });

  // Otherwise tabbing to an option and pressing Enter would both pick it and
  // skip the step, and Enter on Continue would fire onContinue twice.
  it('defers to a focused control that handles Enter itself', () => {
    const button = mount(document.createElement('button'));
    expect(shouldAdvanceOnEnter(keyEvent(button))).toBe(false);

    const link = mount(document.createElement('a'));
    expect(shouldAdvanceOnEnter(keyEvent(link))).toBe(false);

    for (const role of ['button', 'radio', 'checkbox', 'switch']) {
      const el = mount(document.createElement('div'));
      el.setAttribute('role', role);
      expect(shouldAdvanceOnEnter(keyEvent(el)), role).toBe(false);
    }
  });

  it('defers when the event target is nested inside a control', () => {
    const button = mount(document.createElement('button'));
    const icon = document.createElement('span');
    button.appendChild(icon);
    expect(shouldAdvanceOnEnter(keyEvent(icon))).toBe(false);
  });
});
