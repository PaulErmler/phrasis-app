/**
 * Scoring for the hyperliteral gloss bench.
 *
 * The gold data glosses in the Leipzig style, which the app deliberately does
 * not (see convex/lib/hyperliteralPrompt.ts). So the reference is reduced to
 * its LEXICAL SKELETON when the gold set is built — the same units with the
 * grammatical tags deleted — and the model is scored against that, position by
 * position. `see-IPFV-1SG girl-ACC` becomes `['see', 'girl']`, and a model
 * answering `saw girl-[object]` scores full marks on both positions.
 *
 * What this measures: did each source word get a gloss carrying the right
 * meaning, in the source's own order. What it deliberately does NOT measure:
 * whether the model reproduced the reference's surface, which would reward
 * copying a style the app does not want.
 */

/** A gold row's reference. `null` marks a position whose gloss is pure
 *  grammatical concord, which carries no lexeme to match against. */
export type Skeleton = (string | null)[];

export type GlossScore = {
  /** The gloss has one unit per source word. `null` where the language is
   *  written without spaces and the count has no well-defined target. */
  unitsOk: boolean | null;
  modelUnits: number;
  sourceWords: number;
  /** Share of reference lexemes found in the gloss IN ORDER. */
  lexical: number;
  /** Reference lexemes that were scorable at all. */
  scorable: number;
  /** No Leipzig abbreviation leaked into the output. */
  noLeipzig: boolean;
  /** Every multi-word gloss is hyphen-joined, not space-separated. */
  spacesOk: boolean;
};

const LEIPZIG =
  /(^|[-.[])(NOM|ACC|GEN|DAT|INS|INSTR|LOC|ABL|ELA|INE|ILL|ADE|ALL|PTV|PRT|ESS|TRA|ABE|COM|VOC|ERG|ABS|SG|PL|DU|1SG|2SG|3SG|1PL|2PL|3PL|PST|PRS|FUT|PFV|IPFV|AOR|PTCP|INF|GER|CVB|SBJV|IMP|COND|POT|CAUS|PASS|REFL|RECP|DEF|INDF|CLF|NMLZ|ADN|COP|EVID|HON|NEG)([-.\]]|$)/;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,;:!?"'`´]/g, '')
    .trim();

/** The words a gloss unit offers, with hyphens and brackets opened up. */
function unitWords(unit: string): string[] {
  return norm(unit)
    .replace(/[[\]]/g, ' ')
    .split(/[-\s/]+/)
    .filter((w) => w.length > 0);
}

/** Glue the sources use inside a reference lexeme that carries no meaning of
 *  its own: `to-exist` is the verb "exist", and a gloss saying `exists` has
 *  not missed anything. Requiring every hyphen part to match would mark most
 *  correct answers wrong. */
const GLUE = new Set([
  'to',
  'the',
  'a',
  'an',
  'of',
  'be',
  'is',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'in',
  'on',
  'at',
  'by',
  'it',
  'that',
]);

/**
 * Forms of one word that the stem test cannot reach because they are short or
 * irregular. `be`/`been`, `sit`/`sat` and `go`/`went` were all scored as
 * misses against correct glosses.
 */
const SAME_WORD: string[][] = [
  ['be', 'is', 'are', 'am', 'was', 'were', 'been', 'being'],
  ['sit', 'sits', 'sat', 'sitting'],
  ['go', 'goes', 'went', 'gone', 'going'],
  ['have', 'has', 'had', 'having'],
  ['do', 'does', 'did', 'done', 'doing'],
  ['say', 'says', 'said', 'saying'],
  ['see', 'sees', 'saw', 'seen', 'seeing'],
  ['eat', 'eats', 'ate', 'eaten', 'eating'],
  ['take', 'takes', 'took', 'taken', 'taking'],
  ['come', 'comes', 'came', 'coming'],
  ['give', 'gives', 'gave', 'given', 'giving'],
  ['get', 'gets', 'got', 'gotten', 'getting'],
  ['make', 'makes', 'made', 'making'],
  ['buy', 'buys', 'bought', 'buying'],
  ['bring', 'brings', 'brought', 'bringing'],
  ['run', 'runs', 'ran', 'running'],
  ['write', 'writes', 'wrote', 'written', 'writing'],
  ['read', 'reads', 'reading'],
  ['know', 'knows', 'knew', 'known', 'knowing'],
  ['i', 'me', 'my', 'mine'],
  ['you', 'your', 'yours'],
  ['he', 'him', 'his'],
  ['she', 'her', 'hers'],
  ['we', 'us', 'our', 'ours'],
  ['they', 'them', 'their', 'theirs'],
  ['not', 'no', "n't"],
];
const FORMS = new Map<string, number>();
SAME_WORD.forEach((group, i) => group.forEach((w) => FORMS.set(w, i)));

function matches(word: string, part: string): boolean {
  if (word === part) return true;
  const a = FORMS.get(word);
  if (a !== undefined && a === FORMS.get(part)) return true;
  // Same stem either way, so an inflected gloss ("ate"/"eat", "houses"/"house")
  // still counts.
  const stem = part.length >= 5 ? part.slice(0, part.length - 1) : part;
  return (
    (part.length >= 4 && word.startsWith(stem)) ||
    (word.length >= 4 &&
      part.startsWith(word.slice(0, Math.max(3, word.length - 1))))
  );
}

/** Does this unit carry the reference lexeme? */
function covers(unit: string, lexeme: string): boolean {
  // `top/up` is the source offering two wordings of one gloss, so either
  // satisfies it.
  return norm(lexeme)
    .replace(/[[\]]/g, '')
    .split('/')
    .filter((alt) => alt.trim().length > 0)
    .some((alt) => coversAlternative(unit, alt));
}

function coversAlternative(unit: string, target: string): boolean {
  if (target.length === 0) return true;
  const parts = target.split(/[-\s]+/).filter((p) => p.length > 0);
  const content = parts.filter((p) => !GLUE.has(p));
  // All content parts must land; glue is credited if it happens to appear but
  // never required. A target that is nothing but glue falls back to any part.
  const required = content.length > 0 ? content : parts;
  const words = unitWords(unit);
  return required.every((part) => words.some((w) => matches(w, part)));
}

/**
 * Languages written without spaces between words. Their gold sources split the
 * sentence however the article's author chose (`太陽が` keeps its particle,
 * `猫 が いる` separates it), so the SOURCE's token count is not a target a
 * model could hit. For these the reference's own unit count is the target
 * instead, which is what the gloss is actually aligned to.
 */
export const NO_WORD_BOUNDARIES = new Set(['ja', 'zh', 'yue', 'th']);

/**
 * How many reference lexemes appear in the gloss IN ORDER.
 *
 * Deliberately not a position-by-position comparison. The sources glue a
 * Japanese particle onto its word (`sun-SBJ east-POSS sky-LOC rise`) where the
 * app's prompt asks for it as its own unit (`sun [subject] east of sky at
 * rises`). Both are correct; only the segmentation differs, and a positional
 * scorer marked the second one 25% for being off by one from the first word
 * on. Ordered coverage asks the question the app actually cares about: was
 * every word glossed, and did the gloss keep the sentence's order.
 */
function orderedCoverage(units: string[], lexemes: string[]): number {
  if (lexemes.length === 0) return 0;
  // Longest common subsequence over (unit, lexeme) matches.
  const table: number[][] = Array.from({ length: units.length + 1 }, () =>
    new Array<number>(lexemes.length + 1).fill(0),
  );
  for (let i = 1; i <= units.length; i++) {
    for (let j = 1; j <= lexemes.length; j++) {
      table[i][j] = covers(units[i - 1], lexemes[j - 1])
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[units.length][lexemes.length] / lexemes.length;
}

export function scoreGloss(
  gloss: string,
  sourceWords: number | null,
  skeleton: Skeleton,
): GlossScore {
  const units = gloss
    .trim()
    .split(/\s+/)
    .filter((u) => u.length > 0);
  const lexemes = skeleton.filter((s): s is string => Boolean(s));
  return {
    unitsOk: sourceWords === null ? null : units.length === sourceWords,
    modelUnits: units.length,
    sourceWords: sourceWords ?? units.length,
    lexical: orderedCoverage(units, lexemes),
    scorable: lexemes.length,
    noLeipzig: !units.some((u) => LEIPZIG.test(u)),
    spacesOk: sourceWords === null ? true : units.length <= sourceWords,
  };
}
