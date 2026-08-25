/**
 * Furigana: the kana reading printed above a kanji (日本語 with にほんご over
 * it). Stored per sentence as a single annotated string in the bracket
 * notation Japanese tooling already uses:
 *
 *   毎朝[まいあさ]七時[しちじ]に起[お]きます。
 *
 * Chosen over a JSON segment array because it is readable in the Convex
 * dashboard and costs ~1.5x the sentence length rather than ~4x — this field
 * is read on every card fetch for a Japanese course, so the bandwidth matters.
 *
 * This module is the single source of truth for that format. The Node action
 * (convex/features/furigana.ts) builds the string with `fitReading` +
 * `serializeFurigana`; the client reads it back with `parseFurigana` and lays
 * it over its own word tokens with `splitFuriganaByRanges`. Keeping both
 * halves here means the writer and reader can never disagree about escaping
 * or run boundaries.
 *
 * Everything below is pure and dependency-free so it runs unchanged in the
 * Convex Node runtime, the V8 runtime, and the browser.
 */

/**
 * One run of the sentence. `reading` is present only on runs that carry ruby
 * — always a maximal run of non-kana characters (kanji, 々, digits). Plain
 * kana runs are emitted with no reading and render as bare text.
 */
export interface FuriganaSegment {
  text: string;
  reading?: string;
}

/**
 * Kana for run-splitting purposes: hiragana, katakana, and the long-vowel
 * mark ー (Script=Common, but it only ever continues a katakana run).
 *
 * ヶ and ヵ are deliberately excluded despite being Script=Katakana: they are
 * read as か/が inside counters (一ヶ月 = いっかげつ), so treating them as
 * kana would split the run and leave a reading that can't be aligned.
 */
function isKana(ch: string): boolean {
  if (ch === 'ヶ' || ch === 'ヵ') return false;
  return ch === 'ー' || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch);
}

/** Whether a string contains a kanji (or the 々 iteration mark). */
export function hasKanji(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

/** Katakana → hiragana. Morphological analyzers return readings in katakana. */
export function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/** Split a surface form into maximal alternating kana / non-kana runs. */
function toRuns(surface: string): { kana: boolean; text: string }[] {
  const runs: { kana: boolean; text: string }[] = [];
  for (const ch of surface) {
    const kana = isKana(ch);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kana === kana) last.text += ch;
    else runs.push({ kana, text: ch });
  }
  return runs;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lay a hiragana `reading` over a `surface` form, splitting ONLY at kana
 * boundaries: every maximal kanji run becomes one ruby unit, and the kana
 * already visible in the surface (okurigana) anchors the alignment.
 *
 *   fitReading('起きます', 'おきます')   → 起[お] + きます
 *   fitReading('話し合い', 'はなしあい') → 話[はな] + し + 合[あ] + い
 *   fitReading('出身',     'しゅっしん') → 出身[しゅっしん]
 *
 * Deliberately NOT per-kanji. Splitting a compound's reading across its
 * characters requires guessing, and a wrong guess produces fragments that
 * aren't pronounceable Japanese at all — the `furigana` npm package, which
 * does exactly that, renders 出身/しゅっしん as 出[し]身[ゅっしん]. Grouping
 * the run is both the standard typesetting convention and unable to fail
 * that way: the reading is either aligned correctly or not shown.
 *
 * The alignment itself is a regex built from the surface — kana runs become
 * literals, kanji runs become lazy captures — so backtracking finds the one
 * assignment consistent with the visible okurigana.
 *
 * Returns null when the reading can't be aligned (the analyzer gave a
 * dictionary-form reading, the surface was mixed script, …). Callers render
 * the token bare rather than guess.
 */
export function fitReading(
  surface: string,
  reading: string,
): FuriganaSegment[] | null {
  const runs = toRuns(surface);
  // Nothing to annotate, or nothing to anchor against.
  if (!runs.some((run) => !run.kana)) return null;

  const pattern = runs
    .map((run) =>
      run.kana ? escapeRegExp(katakanaToHiragana(run.text)) : '(.+?)',
    )
    .join('');
  const match = new RegExp(`^${pattern}$`).exec(reading);
  if (match === null) return null;

  let group = 0;
  return runs.map((run) =>
    run.kana ? { text: run.text } : { text: run.text, reading: match[++group] },
  );
}

/** Segments → the stored bracket string. Inverse of `parseFurigana`. */
export function serializeFurigana(segments: FuriganaSegment[]): string {
  return segments
    .map((seg) =>
      seg.reading === undefined ? seg.text : `${seg.text}[${seg.reading}]`,
    )
    .join('');
}

/**
 * Read a stored annotation back into segments, verifying as it goes that the
 * segments still reconstruct `text` exactly.
 *
 * The verification is the whole point: annotations are generated once and
 * cached, so an edit to the sentence can leave a stale annotation behind for
 * as long as it takes the invalidation to run. Returning null on any mismatch
 * means the worst case is a card rendering without furigana, never a card
 * rendering kana over the wrong characters.
 *
 * A `[` in the sentence itself can't produce a false positive either: a
 * bracket only reads as a reading when its body is entirely kana AND the
 * result still reconstructs the original text.
 */
export function parseFurigana(
  annotated: string,
  text: string,
): FuriganaSegment[] | null {
  const segments: FuriganaSegment[] = [];
  // Code points, not UTF-16 units: rare kanji (𠮟) are astral, and indexing
  // by unit would split their surrogate pairs.
  const chars = [...annotated];
  let pending = '';

  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '[') {
      const close = chars.indexOf(']', i + 1);
      const body = close === -1 ? '' : chars.slice(i + 1, close).join('');
      // The ruby target is the maximal non-kana run immediately before the
      // bracket — exactly what `fitReading` emits a reading for.
      let cut = pending.length;
      const pendingChars = [...pending];
      while (cut > 0 && !isKana(pendingChars[cut - 1])) cut--;
      const target = pendingChars.slice(cut).join('');

      if (
        close !== -1 &&
        body.length > 0 &&
        target.length > 0 &&
        [...body].every(isKana)
      ) {
        const plain = pendingChars.slice(0, cut).join('');
        if (plain.length > 0) segments.push({ text: plain });
        segments.push({ text: target, reading: body });
        pending = '';
        i = close;
        continue;
      }
    }
    pending += chars[i];
  }
  if (pending.length > 0) segments.push({ text: pending });

  const reconstructed = segments.map((seg) => seg.text).join('');
  return reconstructed === text ? segments : null;
}

/**
 * Cut a segment list into consecutive chunks of the given code-point lengths,
 * so a caller that has tokenized the same sentence differently can render each
 * of its own chunks with the right ruby.
 *
 * A ruby segment is atomic — its reading belongs to the whole run — so when a
 * chunk boundary lands inside one, the segment is emitted whole in the chunk
 * that contains its start and the following chunks skip the characters it
 * already covered. Those chunks can come back empty; the caller renders
 * nothing for them. No text is lost either way, because the chunks are
 * rendered adjacently: the only effect is that a click target shifts by a
 * character or two on the rare word the two tokenizers disagree about.
 */
export function splitFuriganaByRanges(
  segments: FuriganaSegment[],
  lengths: number[],
): FuriganaSegment[][] {
  const out: FuriganaSegment[][] = [];
  let index = 0;
  // How much of segments[index] the previous chunk already consumed.
  let offset = 0;
  // Characters the previous chunk over-ran into this one's territory.
  let debt = 0;

  for (const length of lengths) {
    const chunk: FuriganaSegment[] = [];
    let remaining = length - debt;
    debt = 0;
    if (remaining < 0) {
      debt = -remaining;
      remaining = 0;
    }

    while (remaining > 0 && index < segments.length) {
      const seg = segments[index];
      const chars = [...seg.text];
      const available = chars.length - offset;

      if (seg.reading !== undefined || available <= remaining) {
        // Ruby runs are indivisible; plain runs that fit go whole.
        chunk.push(
          offset === 0
            ? seg
            : { text: chars.slice(offset).join(''), reading: seg.reading },
        );
        remaining -= available;
        index++;
        offset = 0;
      } else {
        chunk.push({ text: chars.slice(offset, offset + remaining).join('') });
        offset += remaining;
        remaining = 0;
      }
    }
    if (remaining < 0) debt = -remaining;
    out.push(chunk);
  }
  return out;
}
