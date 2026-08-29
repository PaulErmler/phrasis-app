/**
 * Aligns STT word timings onto the canonical source text.
 *
 * The transcription may differ from the original text (punctuation,
 * capitalization, word splits). The UI should always display the real text.
 * This helper maps the STT-produced timings onto the words the user sees, so
 * karaoke highlighting lights up the canonical tokens, not the transcribed
 * ones.
 */
import { getWordSegmenter } from '@/lib/wordTokenize';

export interface ScribeWord {
  word: string;
  start: number;
  end: number;
}

export interface AlignedWord {
  /** Token exactly as it appears in the source text (including punctuation). */
  display: string;
  /** Whitespace preceding the token. Preserved so rendering looks natural. */
  leading: string;
  /**
   * Non-word run that follows the LAST word in the source text (final period,
   * "!", "؟", etc.). Empty string on every token except the last. Kept off
   * `display` so the last word's clickable span contains only word characters
   * Mixing in trailing LTR punctuation inside an RTL `<span>` made the
   * popover trigger silently fail for Arabic sentences.
   */
  trailing: string;
  /** Timing in seconds; interpolated when the token has no Scribe match. */
  start: number;
  end: number;
  /** True if the timing came from a direct Scribe match (not interpolation). */
  matched: boolean;
}

/** Strip surrounding punctuation/symbols + lowercase + NFC normalise. */
export function normalise(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize('NFC')
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

/**
 * Split text into word-like tokens, each preceded by any non-word run that
 * came before it (whitespace, punctuation). Uses Intl.Segmenter so non-
 * whitespace-delimited scripts (Chinese, Japanese, Thai) get one token per
 * linguistic word instead of collapsing into a single sentence-token. Falls
 * back to a whitespace split if Segmenter throws on an invalid locale.
 *
 * Any non-word run that follows the LAST word (final period/quote) is
 * returned separately as `trailing`. Callers render it after the last word's
 * clickable span so the rendered output still includes the final punctuation
 * without contaminating the trigger's child content, historically this
 * trailing run was glued onto `display`, but mixing LTR punctuation inside
 * an RTL `<span>` silently broke the popover trigger on Arabic sentences.
 */
function tokenise(
  text: string,
  language: string,
): { tokens: { display: string; leading: string }[]; trailing: string } {
  try {
    const segmenter = getWordSegmenter(language);
    const tokens: { display: string; leading: string }[] = [];
    let pendingLeading = '';
    for (const seg of segmenter.segment(text)) {
      if (seg.isWordLike) {
        tokens.push({ leading: pendingLeading, display: seg.segment });
        pendingLeading = '';
      } else {
        pendingLeading += seg.segment;
      }
    }
    return { tokens, trailing: pendingLeading };
  } catch {
    const tokens: { display: string; leading: string }[] = [];
    const regex = /(\s*)(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      tokens.push({ leading: m[1], display: m[2] });
    }
    return { tokens, trailing: '' };
  }
}

/**
 * Walk real-text tokens and Scribe tokens in parallel; for each real token
 * look ahead up to `LOOKAHEAD` Scribe positions for a normalised match. This
 * handles the common transcription drifts. Scribe adding a filler token,
 * merging two words, or dropping punctuation, without collapsing when a
 * single mismatch occurs.
 */
const LOOKAHEAD = 2;

export function alignWordTimings(
  text: string,
  scribe: ScribeWord[] | null | undefined,
  language: string,
): AlignedWord[] {
  const { tokens, trailing } = tokenise(text, language);
  if (tokens.length === 0) return [];

  type Partial = {
    display: string;
    leading: string;
    trailing: string;
    start: number | null;
    end: number | null;
    matched: boolean;
  };

  const partials: Partial[] = tokens.map((t, i) => ({
    ...t,
    // Only the last token carries the trailing run; every other token
    // contributes its inter-word non-word run to the NEXT token's leading.
    trailing: i === tokens.length - 1 ? trailing : '',
    start: null,
    end: null,
    matched: false,
  }));

  if (scribe && scribe.length > 0) {
    let j = 0;
    for (let i = 0; i < partials.length; i++) {
      const realNorm = normalise(partials[i].display);
      if (!realNorm) continue; // pure-punctuation token, leave unmatched
      for (let k = 0; k <= LOOKAHEAD && j + k < scribe.length; k++) {
        if (normalise(scribe[j + k].word) === realNorm) {
          partials[i].start = scribe[j + k].start;
          partials[i].end = scribe[j + k].end;
          partials[i].matched = true;
          j = j + k + 1;
          break;
        }
      }
    }
  }

  // Fill missing timings by interpolation from surrounding matches so every
  // token still has a sensible active window. A token that neighbours matched
  // words inherits the gap between them; unmatched runs at the ends inherit
  // the adjacent anchor's boundary.
  for (let i = 0; i < partials.length; i++) {
    if (partials[i].start !== null && partials[i].end !== null) continue;

    let prevEnd: number | null = null;
    for (let k = i - 1; k >= 0; k--) {
      if (partials[k].end !== null) {
        prevEnd = partials[k].end;
        break;
      }
    }
    let nextStart: number | null = null;
    for (let k = i + 1; k < partials.length; k++) {
      if (partials[k].start !== null) {
        nextStart = partials[k].start;
        break;
      }
    }

    const fallback = prevEnd ?? nextStart ?? 0; // if truly nothing matched, anchor at 0
    partials[i].start = partials[i].start ?? prevEnd ?? fallback;
    partials[i].end = partials[i].end ?? nextStart ?? fallback;
  }

  return partials.map((p) => ({
    display: p.display,
    leading: p.leading,
    trailing: p.trailing,
    start: p.start as number,
    end: p.end as number,
    matched: p.matched,
  }));
}

/**
 * Ratio of real-text tokens that found an exact Scribe match. Useful as a
 * quality gate. Callers can render plain text when the ratio is too low.
 */
export function matchRatio(aligned: AlignedWord[]): number {
  if (aligned.length === 0) return 0;
  const matched = aligned.filter((w) => w.matched).length;
  return matched / aligned.length;
}

/**
 * Finds the word whose active window contains `t`. For non-last words the
 * window extends from the word's start to the next word's start (keeps the
 * highlight steady across any gap Scribe leaves between words). For the LAST
 * word it stops at the word's own `end`. Once the final syllable finishes
 * the highlight should clear, even if the audio clip has trailing silence.
 */
export function findCurrentIndex(words: AlignedWord[], t: number): number {
  if (words.length === 0) return -1;
  if (t < words[0].start) return -1;
  for (let i = 0; i < words.length; i++) {
    const nextStart = i < words.length - 1 ? words[i + 1].start : words[i].end;
    if (t >= words[i].start && t < nextStart) return i;
  }
  return -1;
}
