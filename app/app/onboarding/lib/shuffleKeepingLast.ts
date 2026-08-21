/**
 * Fisher–Yates shuffle of `items`, then pin `last` at the end so a catch-all
 * option (e.g. "Other") stays bottom-right in a 2-column grid.
 */
export function shuffleKeepingLast<T>(
  items: readonly T[],
  last: T,
  random: () => number = Math.random,
): T[] {
  const rest = items.filter((item) => item !== last);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = rest[i];
    const b = rest[j];
    if (a === undefined || b === undefined) continue;
    rest[i] = b;
    rest[j] = a;
  }
  return [...rest, last];
}
