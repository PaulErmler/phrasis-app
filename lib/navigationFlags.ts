/**
 * Session-scoped navigation flags passed between routes that unmount each
 * other (e.g. learn → home). sessionStorage instead of React state because
 * the route segments involved never share a mounted parent that could carry
 * the flag.
 */

const RETURNING_FROM_LEARN_KEY = 'phrasis:returning-from-learn';

export function setReturningFromLearnFlag(): void {
  try {
    sessionStorage.setItem(RETURNING_FROM_LEARN_KEY, '1');
  } catch {
    // Storage unavailable (private mode / quota) — the entrance animation
    // simply doesn't play.
  }
}

export function consumeReturningFromLearnFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const set = sessionStorage.getItem(RETURNING_FROM_LEARN_KEY) === '1';
    sessionStorage.removeItem(RETURNING_FROM_LEARN_KEY);
    return set;
  } catch {
    return false;
  }
}
