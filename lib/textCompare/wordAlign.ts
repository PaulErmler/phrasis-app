import { normalize, type NormalizeOptions } from './normalize';
import { segmentWords, segmentGraphemes } from './segment';
import { damerauLevenshtein } from './editDistance';

export type WordTag = 'equal' | 'typo' | 'wrong' | 'missing' | 'extra';

export interface AlignedWord {
  tag: WordTag;
  /** The expected word (or '' for `extra`). Original surface form. */
  expected: string;
  /** The user's word (or '' for `missing`). Original surface form. */
  actual: string;
}

export interface WordAlignResult {
  words: AlignedWord[];
  /** Counts by tag */
  counts: Record<WordTag, number>;
}

export interface WordAlignOptions extends NormalizeOptions {
  locale?: string;
}

const COST_EQUAL = 0;
const COST_TYPO = 0.4;
const COST_DIFF = 1; // substitute
const COST_GAP = 1; // insert/delete

interface WordToken {
  raw: string;
  norm: string;
  graphemes: string[];
}

function tokenize(input: string, opts: WordAlignOptions): WordToken[] {
  const locale = opts.locale ?? 'en';
  const tokens: WordToken[] = [];
  for (const seg of segmentWords(input, locale)) {
    if (!seg.isWord) continue;
    const norm = normalize(seg.text, opts);
    if (!norm) continue;
    tokens.push({
      raw: seg.text,
      norm,
      graphemes: segmentGraphemes(norm, locale),
    });
  }
  return tokens;
}

function classify(
  a: WordToken,
  b: WordToken,
): { tag: 'equal' | 'typo' | 'wrong'; cost: number } {
  if (a.norm === b.norm) return { tag: 'equal', cost: COST_EQUAL };
  const dist = damerauLevenshtein(a.graphemes, b.graphemes);
  const len = Math.max(a.graphemes.length, b.graphemes.length);
  const threshold = Math.max(1, Math.floor(len / 4));
  if (dist <= threshold) return { tag: 'typo', cost: COST_TYPO };
  return { tag: 'wrong', cost: COST_DIFF };
}

export function alignWords(
  expected: string,
  actual: string,
  opts: WordAlignOptions = {},
): WordAlignResult {
  const exp = tokenize(expected, opts);
  const act = tokenize(actual, opts);
  const n = exp.length;
  const m = act.length;

  const counts: Record<WordTag, number> = {
    equal: 0,
    typo: 0,
    wrong: 0,
    missing: 0,
    extra: 0,
  };

  if (n === 0 && m === 0) return { words: [], counts };

  // Needleman–Wunsch
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  const back: ('match' | 'gap-exp' | 'gap-act')[][] = Array.from(
    { length: n + 1 },
    () => new Array(m + 1).fill('match'),
  );

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i * COST_GAP;
    back[i][0] = 'gap-act';
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j * COST_GAP;
    back[0][j] = 'gap-exp';
  }

  const matchCache: Map<
    string,
    { tag: 'equal' | 'typo' | 'wrong'; cost: number }
  > = new Map();
  const matchOf = (i: number, j: number) => {
    const key = `${i}|${j}`;
    let r = matchCache.get(key);
    if (!r) {
      r = classify(exp[i], act[j]);
      matchCache.set(key, r);
    }
    return r;
  };

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const m_ = matchOf(i - 1, j - 1);
      const matchScore = dp[i - 1][j - 1] + m_.cost;
      const gapAct = dp[i - 1][j] + COST_GAP; // delete from expected → missing
      const gapExp = dp[i][j - 1] + COST_GAP; // insert in actual → extra
      let best = matchScore;
      let move: 'match' | 'gap-exp' | 'gap-act' = 'match';
      if (gapAct < best) {
        best = gapAct;
        move = 'gap-act';
      }
      if (gapExp < best) {
        best = gapExp;
        move = 'gap-exp';
      }
      dp[i][j] = best;
      back[i][j] = move;
    }
  }

  // Trace back
  const trace: AlignedWord[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && back[i][j] === 'match') {
      const m_ = matchOf(i - 1, j - 1);
      const tag: WordTag = m_.tag;
      trace.push({ tag, expected: exp[i - 1].raw, actual: act[j - 1].raw });
      counts[tag]++;
      i--;
      j--;
    } else if (i > 0 && back[i][j] === 'gap-act') {
      trace.push({ tag: 'missing', expected: exp[i - 1].raw, actual: '' });
      counts.missing++;
      i--;
    } else {
      trace.push({ tag: 'extra', expected: '', actual: act[j - 1].raw });
      counts.extra++;
      j--;
    }
  }
  trace.reverse();
  return { words: trace, counts };
}
