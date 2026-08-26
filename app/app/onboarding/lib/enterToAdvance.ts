import {
  isComposingKeyEvent,
  isEditableTarget,
} from '@/hooks/use-ime-safe-enter';

/**
 * Should this keydown advance the onboarding wizard?
 *
 * Enter acts as "Continue" so a keyboard user can answer the whole flow
 * without reaching for the mouse. Pure so the guard rules can be tested
 * without mounting the wizard (which pulls in the whole Convex query graph).
 *
 * The caller is responsible for the two pieces of state this can't see: that
 * the step actually renders the shared Continue button, and that Continue is
 * currently enabled.
 */
export function shouldAdvanceOnEnter(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter' || e.repeat) return false;
  // A chord is someone else's shortcut, not "go on".
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  // Enter inside a field is text entry, and in ja/zh/ko/vi it confirms an IME
  // conversion, treating that as "continue" would skip the step out from
  // under someone mid-word. See `useImeSafeEnter`.
  if (isEditableTarget(e.target) || isComposingKeyEvent(e)) return false;
  // A focused control already handles Enter natively. Without this, tabbing to
  // an option and pressing Enter would both pick it and skip the step in one
  // keystroke, and Enter on the Continue button would fire onContinue twice.
  if (
    e.target instanceof Element &&
    e.target.closest(
      'button, a, [role="button"], [role="radio"], [role="checkbox"], [role="switch"]',
    )
  ) {
    return false;
  }
  return true;
}
