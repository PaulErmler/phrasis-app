import {
  getLanguageByCode,
  getSpeakerGenderMarking,
} from '../../../lib/languages';
import { courseMarksSpeakerGender } from '../../../lib/speakerGender';

/**
 * Dynamic prompt sections injected (uncached) after the agent's static
 * instructions on every generation step. Pure string builders so they can be
 * unit-tested without a Convex runtime.
 */

export function languageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code;
}

/** "Romanian", "Romanian and Spanish", "Romanian, Spanish and French". */
export function joinLanguageNames(codes: string[]): string {
  const names = codes.map(languageName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function roleLabel(
  code: string,
  courseLanguages: { baseLanguages: string[]; targetLanguages: string[] },
): 'TARGET' | 'BASE' | null {
  if (courseLanguages.targetLanguages.includes(code)) return 'TARGET';
  if (courseLanguages.baseLanguages.includes(code)) return 'BASE';
  return null;
}

/**
 * The card's sentences in the target language(s): the source text when the
 * card was authored in a target language, then every translation whose
 * language is a target. This is the single definition of "the sentence the
 * user is learning". The card-context section and quick-action steering
 * (convex/features/chat/quickActions.ts) must select identically, or the
 * two prompts would point the model at different texts.
 */
export function targetSentenceLines(
  card: {
    sourceText: string;
    sourceLanguage: string;
    translations: { language: string; text: string }[];
  },
  targetLanguages: string[],
): { language: string; text: string }[] {
  return [
    ...(targetLanguages.includes(card.sourceLanguage)
      ? [{ language: card.sourceLanguage, text: card.sourceText }]
      : []),
    ...card.translations.filter((t) => targetLanguages.includes(t.language)),
  ];
}

/** `"text" (Language) / "text" (Language)`. The quoted form prompts embed. */
export function quoteSentences(
  lines: { language: string; text: string }[],
): string {
  return lines
    .map((l) => `"${l.text}" (${languageName(l.language)})`)
    .join(' / ');
}

export function buildCardContextSection(opts: {
  sourceText: string;
  sourceLanguage: string;
  translations: { language: string; text: string }[];
  baseLanguages: string[];
  targetLanguages: string[];
}): string {
  const label = (code: string) => {
    const role = roleLabel(code, opts);
    return role ? `${code} — ${role}` : code;
  };
  const lines = [`Original (${label(opts.sourceLanguage)}): "${opts.sourceText}"`];
  for (const t of opts.translations) {
    lines.push(`${label(t.language)}: "${t.text}"`);
  }

  // Spell out which line "this sentence" refers to. Without it the model
  // sometimes analyzes the base-language rendering of the card instead of
  // the sentence the user is actually learning.
  const targetLines = targetSentenceLines(opts, opts.targetLanguages);
  const quoted = quoteSentences(targetLines);
  const subjectRule = targetLines.length
    ? targetLines.length > 1
      ? `\n\nWhen the user says "this sentence", "this word", or "this card", they ALWAYS mean the TARGET-language texts: ${quoted}. Analyze and explain those — cover every target language — never the base-language rendering, which is only there as a translation aid.`
      : `\n\nWhen the user says "this sentence", "this word", or "this card", they ALWAYS mean the TARGET-language text: ${quoted}. Analyze and explain that text — never the base-language rendering, which is only there as a translation aid.`
    : '';

  return `The user is currently reviewing this card:\n${lines.join('\n')}${subjectRule}`;
}

export function buildLanguageSection(courseLanguages: {
  baseLanguages: string[];
  targetLanguages: string[];
}): string {
  const baseLangs = [...new Set(courseLanguages.baseLanguages)];
  const targetLangs = [...new Set(courseLanguages.targetLanguages)];
  // base first, then target. Must match the createCardTool contract.
  const allLangs = [...new Set([...baseLangs, ...targetLangs])];

  const nameLines = (codes: string[]) =>
    codes.map((code) => `- ${code}: ${languageName(code)}`).join('\n');

  const perCodeTextRule = allLangs
    .map((code) => `the "${code}" text must be ${languageName(code)}`)
    .join(', ');

  const schematic = allLangs
    .map((code) => `{"language":"${code}","text":"<${languageName(code)} sentence>"}`)
    .join(',');

  return `Course language configuration:

BASE languages (the user's native/reference languages — provide card translations in these, but NEVER explain these languages themselves):
${nameLines(baseLangs)}

TARGET languages (the languages the user is LEARNING — all explanations, synonyms, grammar notes, and examples are about these):
${nameLines(targetLangs)}

RULES:
- Explanations are always ABOUT the TARGET language(s)${targetLangs.length > 0 ? ` — ${joinLanguageNames(targetLangs)}` : ''}. Grammar, vocabulary, word order, and usage questions are answered for the target-language text, even when the user's question is phrased without naming a language.${targetLangs.length > 1 ? ' When a question is about the reviewed card rather than one specific word, cover EVERY target language — treat each one in its own right, never only the first.' : ''}
- "This sentence" / "this word" / "this card" ALWAYS refers to the target-language text, never to its base-language translation. Never analyze base-language grammar; if the user asks about a base-language word or phrase, answer with its equivalent(s) in ${targetLangs.length > 1 ? `each target language (${joinLanguageNames(targetLangs)})` : 'the target language'} and explain those.
- Write your replies IN the ${baseLangs.length > 1 ? 'PRIMARY BASE' : 'BASE'} language${baseLangs.length > 0 ? ` (${languageName(baseLangs[0])})` : ''}. Only quoted examples and vocabulary are in the target language${targetLangs.length > 1 ? 's' : ''}.

createCard order (one entry per code, exactly this order): ${allLangs.join(', ')}
Each entry's "text" must be written in the language named above — ${perCodeTextRule}. Never copy one entry's text into another slot.
Schematic: [${schematic}]`;
}

/**
 * Speaker-gender steering for chat generation. Emitted only when the feature
 * is on, the user chose Male or Female (Mixed = no steering), and a course
 * language actually marks speaker gender. Names only the COURSE's marked
 * languages — per-call data, never a global list (speaker-gender spec,
 * decision 8). Chat cards then pin at generation via morphology (decision 5):
 * the metadata classifier reads the gendered forms this section requests.
 */
export function buildSpeakerGenderSection(
  courseLanguages: { baseLanguages: string[]; targetLanguages: string[] },
  preference: string | undefined,
): string | undefined {
  if (preference !== 'male' && preference !== 'female') return undefined;
  if (
    !courseMarksSpeakerGender(
      courseLanguages.baseLanguages,
      courseLanguages.targetLanguages,
    )
  ) {
    return undefined;
  }
  const allLangs = [
    ...new Set([
      ...courseLanguages.baseLanguages,
      ...courseLanguages.targetLanguages,
    ]),
  ];
  const grammatical = allLangs.filter(
    (code) => getSpeakerGenderMarking(code) === 'grammatical',
  );
  const stylistic = allLangs.filter(
    (code) => getSpeakerGenderMarking(code) === 'stylistic',
  );
  const clauses: string[] = [];
  if (grammatical.length > 0) {
    clauses.push(
      `in ${joinLanguageNames(grammatical)}, use ${preference} first-person agreement (past-tense verbs, participles, predicate adjectives)`,
    );
  }
  if (stylistic.length > 0) {
    clauses.push(
      `in ${joinLanguageNames(stylistic)}, use the particles, self-reference pronouns and register of a ${preference} speaker`,
    );
  }

  return `Speaker gender:
The user has set this course to learn sentences spoken by a ${preference.toUpperCase()} speaker. When you create flashcards (createCard) or write example sentences that have a first-person speaker, write that speaker as ${preference}: ${clauses.join('; ')}. Do NOT force a speaker's gender into sentences that have none (descriptive or third-person sentences stay as they are), and never change the gender of other people a sentence talks about.`;
}

export type LearnerDifficulty = {
  /** Sublevel or collection shorthand shown to the user, e.g. "A1.2" or "B1". */
  label: string;
  /** CEFR band: "Pre-A1" | "A1" | … | "C2". */
  cefrTier: string;
};

/** What example sentences at this CEFR band should sound like. */
const CEFR_EXAMPLE_GUIDANCE: Record<string, string> = {
  'Pre-A1':
    'very short, high-frequency survival sentences (greetings, names, basic needs)',
  A1: 'basic everyday phrases, simple questions and answers, mainly present tense',
  A2: 'common everyday situations with simple connected sentences',
  B1: 'plans, opinions, and familiar topics, including past and future',
  B2: 'more complex topics and discussion; natural spoken vocabulary, not rare or literary',
  C1: 'nuanced, idiomatic phrasing; sophisticated but still spoken-register',
  C2: 'near-native subtlety; rare or literary phrasing is acceptable',
};

/**
 * Injected with the course languages so the tutor pitches example cards at
 * the level the user is actually studying, not textbook-C2 prose.
 */
export function buildDifficultySection(difficulty: LearnerDifficulty): string {
  const guidance =
    CEFR_EXAMPLE_GUIDANCE[difficulty.cefrTier] ??
    'everyday sentences typical of this CEFR band';
  const sublevel =
    difficulty.label !== difficulty.cefrTier ? ` (${difficulty.label})` : '';

  return `Learner difficulty:
The user is currently learning at CEFR ${difficulty.cefrTier}${sublevel}.
When you create flashcards (createCard), write example sentences at roughly this difficulty: ${guidance}. Stay close to this level — not much simpler (unless the user asks, e.g. a "simpler" request) and not much harder. If the user explicitly asks for easier or harder examples, follow that.`;
}
