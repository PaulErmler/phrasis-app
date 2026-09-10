/**
 * The rendering classifier: given sentences in ONE language, say what each
 * wording reveals about the speaker's gender through its first-person
 * forms. Used as a VERIFIER: `verifyRendering`
 * (convex/features/renderingClassification.ts) checks a freshly generated
 * wording against its key (docs/architecture/rendering-keys.md).
 *
 * Convex-runtime-free (like translationAutofillPrompt.ts) so
 * scripts/eval-rendering-detection.ts grades through the exact production
 * prompt.
 *
 * The examples come from lib/languageForms.ts, so the prompt shows the
 * language's own masculine/feminine pair. A language whose wording does not
 * change with the speaker is never classified.
 */

import { getLanguageByCode } from '../../lib/languages';
import { getFirstPersonConfig } from '../../lib/languageForms';
import { stripJsonFences } from './llmJson';

export const RENDERED_GENDERS = ['masculine', 'feminine', 'unmarked'] as const;
export type RenderedGender = (typeof RENDERED_GENDERS)[number];
export type RenderingClassification = {
  gender: RenderedGender;
};

/**
 * Two phrasings of the category descriptions, compared by
 * scripts/eval-rendering-detection.ts (product wording vs the terms of the
 * linguistics literature). Production uses whichever scored higher.
 */
export type PromptWording = 'product' | 'literature';

/** Whether the classifier can say anything about this language. */
export function renderingAxesFor(code: string): { gender: boolean } {
  return { gender: getFirstPersonConfig(code) !== undefined };
}

function genderSection(code: string, wording: PromptWording): string {
  const config = getFirstPersonConfig(code);
  if (!config) {
    return `"gender": always "unmarked". ${languageName(code)} wording does not change with the speaker's gender.`;
  }
  const head =
    wording === 'literature'
      ? `"gender": speaker gender agreement in the first person. ${config.intro} Return "masculine" or "feminine" only when a first-person form (verb, adjective, participle, pronoun or self-reference term) agrees with the SPEAKER's gender.`
      : `"gender": what the sentence's own "I" forms reveal about the speaker. ${config.intro} Return "masculine" or "feminine" only when a form referring to the speaker is gender-marked.`;
  return `${head}
  Example: "${config.masculine}" = masculine, "${config.feminine}" = feminine (both: "${config.exampleEn}").
  "unmarked" when there is no first-person gender marking: no first person at all, a first-person form that does not mark gender, or gender marking that belongs to the addressee or a third person (those never count).`;
}

function languageName(code: string): string {
  return (
    getLanguageByCode(code)?.translationName ??
    getLanguageByCode(code)?.name ??
    code
  );
}

/**
 * The system prompt for one language. Sentences are numbered in the user
 * prompt and the model answers with one object per number, in order.
 */
export function buildRenderingClassifierPrompt(
  code: string,
  wording: PromptWording = 'product',
): string {
  return `You classify sentences written in ${languageName(code)}. For each numbered sentence, report one property of its WORDING as it stands. Judge the form itself, never the topic, and never guess from stereotype.

Return ONLY a JSON array with one object per input sentence, in the same order, and no other text:
[{"i": 1, "gender": "masculine" | "feminine" | "unmarked"}, ...]

${genderSection(code, wording)}

Quoted speech inside the sentence belongs to the quoted person: judge only the sentence's own speaker.`;
}

export function buildRenderingClassifierUserPrompt(
  sentences: readonly string[],
): string {
  const lines = sentences.map((text, i) => `${i + 1}. ${text}`).join('\n');
  return `Sentences:\n${lines}\n\nReturn the JSON array now.`;
}

/**
 * Parse the model's reply into one classification per input sentence.
 * Missing or invalid entries come back as `null` so a bad reply degrades to
 * "not classified" for that row instead of a wrong stamp. A language that
 * does not mark the speaker is forced to "unmarked" whatever the model
 * said.
 */
export function parseRenderingClassifications(
  code: string,
  raw: string,
  count: number,
): (RenderingClassification | null)[] {
  const axes = renderingAxesFor(code);
  const out: (RenderingClassification | null)[] = new Array(count).fill(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  parsed.forEach((entry, position) => {
    if (entry === null || typeof entry !== 'object') return;
    const obj = entry as Record<string, unknown>;
    const index =
      typeof obj.i === 'number' && Number.isInteger(obj.i)
        ? obj.i - 1
        : position;
    if (index < 0 || index >= count) return;
    const gender = obj.gender;
    if (
      typeof gender !== 'string' ||
      !(RENDERED_GENDERS as readonly string[]).includes(gender)
    ) {
      return;
    }
    out[index] = {
      gender: axes.gender ? (gender as RenderedGender) : 'unmarked',
    };
  });
  return out;
}

/**
 * The concrete language to classify a translation row under. Mixed-dialect
 * rows (`es_mixed`) resolve through their stored `regionVariant`; an accent
 * row (`en_gb`) is English and marks nothing.
 */
export function classificationLanguageForRow(row: {
  targetLanguage: string;
  regionVariant?: string;
}): string {
  const lang = getLanguageByCode(row.targetLanguage);
  if (lang?.variants && lang.variants.length > 0) {
    const match = lang.variants.find(
      (variant) => variant.voiceLocalePrefix === row.regionVariant,
    );
    return (match ?? lang.variants[0]).subCode;
  }
  return row.targetLanguage;
}
