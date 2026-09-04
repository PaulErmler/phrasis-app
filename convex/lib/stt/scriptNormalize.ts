/**
 * Fix the script of a transcript to match the app's target language.
 *
 * MAI-Transcribe-2 picks its own script: Serbian comes back in Latin,
 * Mandarin in Simplified characters, Cantonese in Traditional. The app pins
 * one script per language code (Cyrillic `sr`, Traditional `zh_traditional`
 * and `yue_traditional`, Simplified `zh` and `yue`), and both the TTS
 * validation comparator and the writing-mode grader compare the transcript
 * against text in that script. Converting the transcript once, right after
 * STT, keeps every downstream consumer unaware of the model's preference.
 * Word timings are converted too so stored per-word strings match the
 * sentence they align to.
 */

// Simplified→Traditional (`cn2t`, ~1.1 MB) and Traditional→Simplified
// (`t2cn`, ~104 KB) are separate subpath builds. Converters compile a lookup
// trie, so they are built once on first use, never at import time: every
// Convex isolate importing this module would otherwise pay for tries it may
// never need (same reasoning as convex/lib/localRomanization.ts).
import * as OpenCCToTraditional from 'opencc-js/cn2t';
import * as OpenCCToSimplified from 'opencc-js/t2cn';
import { serbianLatinToCyrillic } from '../serbianTranslit';
import { toSttLanguage } from './languages';
import type { WordTiming } from './openrouter';

type Converter = (text: string) => string;

let cnToTw: Converter | undefined;
let hkToCn: Converter | undefined;

const simplifiedToTaiwan: Converter = (text) =>
  (cnToTw ??= OpenCCToTraditional.Converter({ from: 'cn', to: 'tw' }))(text);
const hongKongToSimplified: Converter = (text) =>
  (hkToCn ??= OpenCCToSimplified.Converter({ from: 'hk', to: 'cn' }))(text);

/**
 * The converter that moves STT output into `targetLanguage`'s script, or
 * `null` when the model already writes the script the app expects. The
 * `tw` preset converts characters only; `twp` would also swap regional
 * vocabulary and change what the speaker said.
 */
export function scriptConverterFor(targetLanguage: string): Converter | null {
  switch (targetLanguage) {
    case 'sr':
      return serbianLatinToCyrillic;
    case 'zh_traditional':
      return simplifiedToTaiwan;
    case 'yue_traditional':
      // The model writes Cantonese in Traditional already (verified live,
      // 2026-09-04). Running cn→hk over Traditional text is not safe: a
      // handful of characters are both a Simplified form and a Traditional
      // character in their own right (后, 干, 里, 只), and the converter
      // would rewrite them.
      return null;
    case 'yue':
      return hongKongToSimplified;
    default:
      return null;
  }
}

/** Apply `scriptConverterFor(targetLanguage)` to the text and every word. */
export function normalizeTranscriptScript<
  T extends { text: string; wordTimings: WordTiming[] },
>(result: T, targetLanguage: string | undefined): T {
  if (!targetLanguage) return result;
  const convert = scriptConverterFor(targetLanguage);
  if (!convert) return result;
  return {
    ...result,
    text: convert(result.text),
    wordTimings: result.wordTimings.map((w) => ({
      ...w,
      word: convert(w.word),
    })),
  };
}

/**
 * For auto-detected (chat) transcripts: which app language's script the
 * transcript should take, given what the model detected and the active
 * course's languages.
 *
 * Serbian always resolves to `sr` (the app has no Latin-script Serbian).
 * Mandarin and Cantonese resolve only when the course names exactly one of
 * the pair (`zh` / `zh_traditional`, `yue` / `yue_traditional`); with both
 * or neither present there is no right answer and the transcript is left as
 * the model wrote it.
 */
export function resolveScriptTarget(
  detectedLanguage: string | undefined,
  courseLanguages: readonly string[],
): string | undefined {
  if (!detectedLanguage) return undefined;
  if (detectedLanguage === 'sr') return 'sr';
  if (detectedLanguage !== 'zh' && detectedLanguage !== 'yue') {
    return undefined;
  }
  const matches = [...new Set(courseLanguages)].filter(
    (code) => toSttLanguage(code) === detectedLanguage,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
