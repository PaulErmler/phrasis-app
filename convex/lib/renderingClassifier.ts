/**
 * The rendering classifier: given sentences in ONE language, say what each
 * wording actually is on the two axes the sentence-form settings control,
 * the speaker's gender as revealed by first-person forms and the politeness
 * form. Stamps `translations.renderedGender` / `renderedPoliteness`, which
 * drive the chips on the card and the "canonical already satisfies the
 * preference" shortcut in lib/preferenceResolution.ts.
 *
 * Convex-runtime-free (like translationAutofillPrompt.ts) so
 * scripts/eval-rendering-detection.ts grades through the exact production
 * prompt. The action that calls the model is
 * convex/features/renderingClassification.ts.
 *
 * Categories come from lib/languageForms.ts, so the prompt names the
 * language's own forms (です・ます, du/Sie, pan/pani) with their examples.
 * A language that marks neither axis is never classified.
 */

import { getLanguageByCode } from '../../lib/languages';
import {
  distinctPolitenessForms,
  getFirstPersonConfig,
  getPolitenessConfig,
  type PolitenessLevel,
} from '../../lib/languageForms';
import { stripJsonFences } from './llmJson';

export const RENDERED_GENDERS = ['masculine', 'feminine', 'unmarked'] as const;
export type RenderedGender = (typeof RENDERED_GENDERS)[number];
export const RENDERED_POLITENESS = [
  'casual',
  'polite',
  'formal',
  'unmarked',
] as const;
export type RenderedPoliteness = (typeof RENDERED_POLITENESS)[number];

export type RenderingClassification = {
  gender: RenderedGender;
  politeness: RenderedPoliteness;
};

/**
 * Two phrasings of the category descriptions, compared by
 * scripts/eval-rendering-detection.ts (product wording vs the terms of the
 * linguistics literature). Production uses whichever scored higher.
 */
export type PromptWording = 'product' | 'literature';

/** Which axes the classifier can say anything about for this language. */
export function renderingAxesFor(code: string): {
  gender: boolean;
  politeness: boolean;
} {
  return {
    gender: getFirstPersonConfig(code) !== undefined,
    politeness: getPolitenessConfig(code) !== undefined,
  };
}

/**
 * The global level each distinct form of a language is reported as: the
 * LOWEST level the form covers (German du -> casual, Sie -> formal; French
 * tu -> casual, vous -> polite; Japanese all three). Chips look the level
 * up through the same config, so the label is the form's own.
 */
export function reportedPolitenessLevels(code: string): PolitenessLevel[] {
  return distinctPolitenessForms(code).map((entry) => entry.levels[0]);
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

function politenessSection(code: string, wording: PromptWording): string {
  const config = getPolitenessConfig(code);
  if (!config) {
    return `"politeness": always "unmarked". ${languageName(code)} has no politeness forms this classifier tracks.`;
  }
  const levels = reportedPolitenessLevels(code);
  const lines = levels.map((level) => {
    const form = config.forms[level];
    return `  - "${level}": ${form.promptLabel}. ${wording === 'literature' ? form.prompt : form.description}. Example: "${form.example}"`;
  });
  const head =
    wording === 'literature'
      ? `"politeness": the speech level / address form the wording commits to. ${config.intro} Exactly one of:`
      : `"politeness": which of these forms the sentence uses. ${config.intro} Exactly one of:`;
  const unmarkedRule =
    config.marking === 'address'
      ? '"unmarked" when the sentence does not address anyone (no "you", no imperative, no vocative), so no form is chosen.'
      : config.marking === 'pronoun'
        ? '"unmarked" when the sentence contains no pronoun or particle that commits to a form.'
        : '"unmarked" only for a fragment with no predicate or particle at all.';
  return `${head}\n${lines.join('\n')}\n  ${unmarkedRule}`;
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
  return `You classify sentences written in ${languageName(code)}. For each numbered sentence, report two properties of its WORDING as it stands. Judge the form itself, never the topic, and never guess from stereotype.

Return ONLY a JSON array with one object per input sentence, in the same order, and no other text:
[{"i": 1, "gender": "masculine" | "feminine" | "unmarked", "politeness": "casual" | "polite" | "formal" | "unmarked"}, ...]

${genderSection(code, wording)}

${politenessSection(code, wording)}

Quoted speech inside the sentence belongs to the quoted person: judge only the sentence's own speaker and addressee.`;
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
 * "not classified" for that row instead of a wrong stamp. Axes the language
 * cannot mark, and politeness levels outside `reportedPolitenessLevels`,
 * are forced to "unmarked" whatever the model said.
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
    const politeness = obj.politeness;
    if (
      typeof gender !== 'string' ||
      !(RENDERED_GENDERS as readonly string[]).includes(gender) ||
      typeof politeness !== 'string' ||
      !(RENDERED_POLITENESS as readonly string[]).includes(politeness)
    ) {
      return;
    }
    // A level the language never reports names no form of its own (a
    // "polite" verdict on German, whose forms are du and Sie), so it is
    // not a stamp: unmarked keeps the gender verdict and stops the retry.
    const levelReported =
      politeness === 'unmarked' ||
      (reportedPolitenessLevels(code) as string[]).includes(politeness);
    out[index] = {
      gender: axes.gender ? (gender as RenderedGender) : 'unmarked',
      politeness:
        axes.politeness && levelReported
          ? (politeness as RenderedPoliteness)
          : 'unmarked',
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
