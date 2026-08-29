import { describe, expect, it } from 'vitest';
import { extractJsonResult } from '../../../e2e/cli-json-output';

const RESULT = {
  purged: ['fixture-1@e2e.test', 'fixture-2@e2e.test'],
  failed: [],
  remaining: 3,
  auditRowsDeleted: 2,
  scanTruncated: false,
};
const PRETTY = JSON.stringify(RESULT, null, 2);

describe('extractJsonResult', () => {
  it('parses a bare JSON result', () => {
    expect(extractJsonResult(PRETTY)).toEqual(RESULT);
  });

  it('tolerates CLI output before the result', () => {
    expect(
      extractJsonResult(`Preparing Convex functions...\n${PRETTY}`),
    ).toEqual(RESULT);
  });

  it('tolerates CLI output after the result', () => {
    // Regression: a single trailing line (version notice, deprecation
    // warning) used to be glued onto every parse candidate, so the scan
    // returned undefined and the fixture purge silently no-oped.
    expect(
      extractJsonResult(
        `${PRETTY}\nA new version of convex is available. Run npm i convex@latest.`,
      ),
    ).toEqual(RESULT);
  });

  it('tolerates output on both sides of the result', () => {
    expect(extractJsonResult(`notice before\n${PRETTY}\nnotice after`)).toEqual(
      RESULT,
    );
  });

  it('returns the whole result, not a fragment inside it', () => {
    // The last array element ('"fixture-2@e2e.test"') is valid JSON on its
    // own; a bottom-up scan would return it instead of the object.
    const parsed = extractJsonResult(PRETTY) as typeof RESULT;
    expect(parsed.purged).toEqual(RESULT.purged);
  });

  it('parses primitive results too', () => {
    expect(extractJsonResult('null')).toBeNull();
    expect(extractJsonResult('true')).toBe(true);
    expect(extractJsonResult('42')).toBe(42);
  });

  it('returns undefined when there is no JSON at all', () => {
    expect(extractJsonResult('nothing to see here\nstill nothing')).toBe(
      undefined,
    );
    expect(extractJsonResult('')).toBe(undefined);
  });
});
