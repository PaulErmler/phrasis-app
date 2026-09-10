/**
 * The model-facing wording for a requested speaker gender, shared by the
 * translation prompt, the best-of-N judge, the chat tutor, the quick actions
 * and the autofill prompt, so every feature asks for a speaker in the same
 * words and a prompt change lands everywhere at once. Dependency-free: the
 * eval scripts import it too.
 */

/** The speaker line: gender agreement on every first-person form. */
export function speakerInstruction(gender: 'male' | 'female'): string {
  const who = gender === 'male' ? 'a man' : 'a woman';
  const forms = gender === 'male' ? 'masculine' : 'feminine';
  return `Speaker gender agreement: every first-person form (verb, adjective, participle, pronoun, self-reference term) agrees with ${who} speaking. Use ${forms} first-person forms.`;
}
