/**
 * Resolve a persisted language order against the currently available languages.
 * Keeps persisted order where possible and appends any newly available languages.
 */
export function resolveLanguageOrder(
  persisted: string[] | undefined,
  fallback: string[],
): string[] {
  if (!persisted || persisted.length === 0) return fallback;
  const fallbackSet = new Set(fallback);
  const filtered = persisted.filter((code) => fallbackSet.has(code));
  for (const code of fallback) {
    if (!filtered.includes(code)) filtered.push(code);
  }
  return filtered;
}
