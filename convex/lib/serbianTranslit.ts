/**
 * Serbian Latin → Cyrillic.
 *
 * The app writes Serbian in Cyrillic end to end (lib/languages.ts pins the
 * translation prompt to ћирилица), but the speech-to-text model emits Latin
 * script regardless of the hint it is given. The two alphabets are a strict
 * bijection (30 letters each), so the transcript is converted rather than
 * compared leniently: writing mode submits it as the learner's answer and a
 * Latin answer against a Cyrillic target would be graded wrong.
 *
 * The three Latin digraphs (lj, nj, dž) are read before single letters. That
 * misreads the rare words where the two letters belong to different
 * syllables (`injekcija` → инјекција, `nadživeti` → надживети), which is
 * the same trade-off every Serbian keyboard converter makes. Letters outside
 * Gaj's alphabet (q, w, x, y), digits and punctuation pass through.
 */

const DIGRAPHS: Record<string, string> = {
  lj: 'љ',
  Lj: 'Љ',
  LJ: 'Љ',
  nj: 'њ',
  Nj: 'Њ',
  NJ: 'Њ',
  dž: 'џ',
  Dž: 'Џ',
  DŽ: 'Џ',
};

const LOWER: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'ц',
  č: 'ч',
  ć: 'ћ',
  d: 'д',
  đ: 'ђ',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'ј',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  r: 'р',
  s: 'с',
  š: 'ш',
  t: 'т',
  u: 'у',
  v: 'в',
  z: 'з',
  ž: 'ж',
};

const UPPER: Record<string, string> = Object.fromEntries(
  Object.entries(LOWER).map(([latin, cyrillic]) => [
    latin.toUpperCase(),
    cyrillic.toUpperCase(),
  ]),
);

export function serbianLatinToCyrillic(text: string): string {
  // Diacritics arrive decomposed from some sources (č as c + U+030C); the
  // tables are keyed on the composed form.
  const s = text.normalize('NFC');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const pair = s.slice(i, i + 2);
    const digraph = DIGRAPHS[pair];
    if (digraph !== undefined) {
      out += digraph;
      i += 1;
      continue;
    }
    const ch = s[i];
    out += LOWER[ch] ?? UPPER[ch] ?? ch;
  }
  return out;
}
