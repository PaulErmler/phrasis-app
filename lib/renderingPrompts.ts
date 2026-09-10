/**
 * The model-facing wording for a requested speaker gender and politeness
 * form, shared by the translation prompt, the versioning prompt, the
 * best-of-N judge, the chat tutor, the quick actions and the autofill
 * prompt, so every feature asks for a form in the same words and a prompt
 * change lands everywhere at once. Dependency-free: the eval scripts import
 * it too.
 */

import type { PolitenessForm } from './languageForms';

/** The speaker line: gender agreement on every first-person form. */
export function speakerInstruction(gender: 'male' | 'female'): string {
  const who = gender === 'male' ? 'a man' : 'a woman';
  const forms = gender === 'male' ? 'masculine' : 'feminine';
  return `Speaker gender agreement: every first-person form (verb, adjective, participle, pronoun, self-reference term) agrees with ${who} speaking. Use ${forms} first-person forms.`;
}

/**
 * The politeness line for one requested form of one language: the form's
 * own instruction from lib/languageForms.ts, applied to every sentence.
 */
export function politenessInstruction(
  form: Pick<PolitenessForm, 'promptLabel' | 'prompt'>,
): string {
  return `Required speech level / address form (T-V distinction, honorific register): ${form.promptLabel}. ${form.prompt} Apply it to every sentence, including sentences that address nobody, wherever the language marks it. Only when the source is inherently register-locked (a direct quotation, slang, a fixed formal expression) stay faithful to the source instead.`;
}

/**
 * The language block of the translation prompt: how this language grades
 * politeness (the config's intro), then the requested form. Empty for a
 * language that marks no form, or a sentence the form axis does not apply
 * to, so the model is told nothing about register it could over-apply.
 */
export function languagePolitenessBlock(args: {
  intro?: string;
  form: Pick<PolitenessForm, 'promptLabel' | 'prompt'> | null;
}): string[] {
  if (!args.form) return [];
  return [
    ...(args.intro ? [args.intro] : []),
    politenessInstruction(args.form),
  ];
}

/**
 * How a feature that writes NEW sentences (chat, autofill) describes the
 * forms a course studies in one language: a single form to use, or several
 * that the learner sees mixed.
 */
export function studiedFormsInstruction(
  languageName: string,
  forms: readonly PolitenessForm[],
): string | null {
  if (forms.length === 0) return null;
  const named = forms.map((form) => form.promptLabel).join(' or ');
  return forms.length === 1
    ? `${languageName} politeness: the learner studies the ${named}. ${forms[0].prompt}`
    : `${languageName} politeness: the learner studies ${named} and sees them mixed.`;
}

/**
 * The compact "Language: form / form" note a quick action anchors on.
 */
export function studiedFormsLabel(
  languageName: string,
  forms: readonly PolitenessForm[],
): string | null {
  if (forms.length === 0) return null;
  return `${languageName}: ${forms.map((form) => form.promptLabel).join(' / ')}`;
}
