/**
 * Extract the JSON result a `convex run` invocation printed, out of whatever
 * else the CLI mixed into the output (version notices, warnings) — before AND
 * after the result.
 *
 * Scans contiguous line windows for one that parses as JSON. Two ordering
 * rules keep it honest: top-down over start lines, and widest-first over end
 * lines. Top-down + widest-first finds the complete result before any line
 * INSIDE it (a lone array element is valid JSON on its own) can match; and
 * varying the window end is what tolerates trailing output — an earlier
 * version glued every trailing line onto each candidate, so one stray notice
 * after the result made all candidates fail and the teardown's fixture purge
 * silently no-oped, the exact quiet failure it exists to prevent.
 *
 * Separate module (no node imports, no `__dirname`) so it stays unit-testable
 * under vitest; global-teardown.ts runs only under Playwright's transformer.
 */
export function extractJsonResult(out: string): unknown {
  const lines = out.trim().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].trim();
    // A JSON result's first line starts a value; skip prose lines outright.
    if (!first || !/^[[{"\-\d]|^(?:true|false|null)$/.test(first)) continue;
    for (let j = lines.length; j > i; j--) {
      try {
        return JSON.parse(lines.slice(i, j).join('\n'));
      } catch {
        /* shrink the window from the bottom */
      }
    }
  }
  return undefined;
}
