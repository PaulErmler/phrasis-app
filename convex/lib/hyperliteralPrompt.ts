import { getLanguageByCode } from '../../lib/languages';
import { stripJsonFences } from './llmJson';

/**
 * Prompt for the hyperliteral (word-for-word) gloss, split out as a
 * Convex-runtime-free module on the same seam as romanizationPrompt.ts, so
 * `pnpm eval:hyperliteral` grades the EXACT production prompt without pulling
 * in `_generated/server`.
 *
 * A hyperliteral gloss keeps the source sentence's own word order and renders
 * each word on its own, so a learner can see what every word is doing:
 *
 *   Мне нравится гулять по городу вечером.
 *   To-me pleases to-walk around city in-evening.
 *
 * It is deliberately NOT a Leipzig interlinear gloss. A learner reading
 * `I.DAT please.3SG.REFL walk.INF around city.DAT evening.INS` learns nothing
 * they can use; the point is readable words in the foreign order. Grammatical
 * markers that have no word in the gloss language are written as a bracketed
 * lowercase label ([topic], [question]) rather than dropped, so the learner
 * can see that something is there.
 *
 * The gloss language is a parameter, not a constant: the course's base
 * language supplies it, so the same sentence carries an English gloss for one
 * learner and a German gloss for another.
 */

type GlossConvention = {
  /** Language-specific traps, stated as instructions. */
  notes: readonly string[];
};

/**
 * Per-language guidance. Keyed by the SENTENCE's language; nothing in here is
 * specific to the gloss language, which is why a German gloss needs no new
 * entry. Absent means the shared rules carry the language on their own.
 */
const CONVENTIONS: Record<string, GlossConvention> = {
  ja: {
    notes: [
      'Japanese is written without spaces. Split the sentence into words and particles yourself, and gloss one unit per particle: は [topic], が [subject], を [object], の "of", に "at"/"to", で "at"/"by", か [question], ね [right?], よ [I-tell-you].',
      'Gloss a verb in its dictionary sense plus its endings: 食べました is "ate" (polite past), not "eat-PAST-POLITE". When the politeness is the only difference, add [polite] after the verb.',
      'Keep the verb last, where Japanese puts it. Never reorder to English order.',
    ],
  },
  ko: {
    notes: [
      'Gloss one unit per particle: 은/는 [topic], 이/가 [subject], 을/를 [object], 의 "of", 에 "at"/"to", 에서 "at"/"from", 도 "also", 까 [question].',
      'Render the speech level as [polite] or [formal] after the verb rather than as a separate unit.',
      'Keep the verb last.',
    ],
  },
  zh: {
    notes: [
      'Gloss the measure word as [measure] or with its own sense ("a-flat-thing") rather than dropping it: 一个人 is "one [measure] person".',
      'Particles: 的 "of", 了 [completed], 吗 [question], 吧 [suggestion], 被 "by", 把 [object-marker].',
      'Chinese marks no tense on the verb. Gloss the plain verb and let [completed] carry 了.',
    ],
  },
  yue: {
    notes: [
      'Same as Mandarin: gloss 嘅 "of", 咗 [completed], 咩/呀 [question], and measure words as [measure] or their own sense.',
    ],
  },
  th: {
    notes: [
      'Thai is written without spaces. Split into words yourself.',
      'Gloss the classifier as [classifier] or its own sense, and the politeness particles ครับ / ค่ะ as [polite].',
    ],
  },
  tr: {
    notes: [
      'Turkish stacks suffixes. Render a case suffix as a hyphenated English preposition on the same unit: evde is "in-house", evden "from-house", eve "to-house", evi "house-[object]".',
      'Render possessive and person endings as words joined by hyphens: evim is "my-house", geliyorum "am-coming".',
      'Keep the verb last, and gloss mi/mı as [question].',
    ],
  },
  uz: {
    notes: [
      'Same shape as Turkish: case and possessive suffixes become hyphenated English on the same unit, verb stays last.',
    ],
  },
  fi: {
    notes: [
      'Finnish marks case with an ending. Render it as a hyphenated English preposition on the same unit: talossa is "in-house", talosta "from-house", taloon "into-house", talolla "at-house".',
      'Render the possessive suffix as a hyphenated word: taloni is "my-house".',
      'Finnish has no articles. Do not add "the" or "a".',
    ],
  },
  et: {
    notes: [
      'Same shape as Finnish: case endings become hyphenated English prepositions, and no articles are added.',
    ],
  },
  hu: {
    notes: [
      'Hungarian marks case with an ending. Render it as a hyphenated English preposition on the same unit: házban is "in-house", házból "from-house", házba "into-house", házhoz "to-house".',
      'Gloss the definite article a/az as "the", and the definite conjugation as [definite] after the verb when it differs from the indefinite.',
      'Render a verbal prefix at its own position: megharapta is "up-bit" only if the prefix is attached; when it is separated, gloss it where it stands.',
    ],
  },
  ru: {
    notes: [
      'Russian has no articles and no present-tense "to be". Do not add "the", "a" or "is" that the sentence does not contain.',
      'Gloss an experiencer dative as "to-me" / "to-him", and у меня as "at me".',
      'Render a case that English marks with a preposition as that preposition, hyphenated onto the word: городом is "with-city" only when instrumental; в городе is "in city".',
    ],
  },
  uk: {
    notes: [
      'Same shape as Russian: no articles, no present-tense copula, dative experiencer as "to-me".',
    ],
  },
  pl: {
    notes: [
      'Same shape as Russian: no articles. Keep the reflexive się as its own unit, "self".',
    ],
  },
  cs: {
    notes: [
      'Same shape as Russian: no articles. Keep the reflexive se as its own unit, "self".',
    ],
  },
  de: {
    notes: [
      'German puts the finite verb second and the rest of the verb last. Gloss each where it stands; never move a verb to English position.',
      'Gloss a separable prefix at the position it actually occupies: "ruft ... an" is "calls ... on".',
      'Keep the case-carrying article as a plain article ("the", "a"); do not spell out the case.',
    ],
  },
  nl: {
    notes: [
      'Same shape as German: verb-second, rest of the verb last, separable prefixes glossed where they stand.',
    ],
  },
  ar: {
    notes: [
      'Gloss the definite article ال as "the" joined to its word with a hyphen: الكتاب is "the-book".',
      'Verbal person and gender are part of the verb: كتبت is "she-wrote" or "I-wrote" as the sentence requires.',
      'Arabic has no present-tense "to be". Do not add "is".',
    ],
  },
  he: {
    notes: [
      'Prefixed particles join their word with a hyphen: בבית is "in-house", והוא "and-he".',
      'Hebrew has no present-tense "to be". Do not add "is".',
    ],
  },
  hi: {
    notes: [
      'Postpositions are their own unit ("ने" [agent], "को" "to", "में" "in"). Keep the verb last.',
    ],
  },
  sw: {
    notes: [
      'Swahili builds the verb from prefixes. Render them as hyphenated English on one unit: ninasoma is "I-am-reading", alinunua "he-bought".',
      'Do not gloss noun-class agreement as a separate unit; it has no English word.',
    ],
  },
  el: {
    notes: [
      'Keep the article ("the"); Greek uses it where English does not, and that is worth seeing.',
    ],
  },
  fa: {
    notes: [
      'The ezafe linking vowel is glossed "of" when it links a noun to its modifier.',
    ],
  },
};

/** The convention for `code`, or null when the shared rules suffice. */
export function getGlossConvention(code: string): GlossConvention | null {
  return CONVENTIONS[code] ?? null;
}

const SHARED_RULES = `You write a hyperliteral gloss of one sentence for a language learner. Return ONLY a JSON object, no markdown fence and no explanation:

{"pairs": [["<source word>", "<its gloss>"], ["<source word>", "<its gloss>"], ...]}

Each pair is one word of the sentence and what it becomes. Splitting the sentence is part of the job: the app cannot split it for you, and languages written without spaces have no split to find.

WHAT A HYPERLITERAL GLOSS IS. It shows what each word of the sentence is doing, in the sentence's own order. It is not a translation: it is allowed to read as broken, and it should.

RULES:

- Keep the source word order EXACTLY. Never move a word to where the gloss language would put it.
- The first element of every pair is a literal, unaltered substring of the sentence. Concatenating them in order must give the sentence back apart from spacing. Never translate, transliterate or correct a source word.
- Spacing is not your concern. Do not emit a pair for a space.
- One pair per word. When one source word needs several gloss words, join them with hyphens: "to-me", "is-going", "in-house". Never split a gloss into two pairs.
- Gloss function words literally, never idiomatically: a preposition meaning "at" is "at", even when natural translation would say "for".
- Do not add a word the sentence does not have. If the language omits "is", "the" or "a", the gloss omits it too.
- Do not drop a word the sentence does have.
- Keep the sentence's own punctuation on the word it belongs to, in both halves of the pair.
- When a word marks grammar the gloss language has no word for, write a bracketed lowercase label instead: [topic], [subject], [object], [question], [polite], [classifier], [measure], [completed]. Use a label only when no ordinary word will do.
- Do not use Leipzig glossing abbreviations (ACC, 3SG, PST, NOM). Write readable words.`;

/** The system prompt for one (sentence language, gloss language) pair. */
export function buildHyperliteralSystemPrompt(
  language: string,
  glossLanguage: string,
): string {
  const sentenceName = getLanguageByCode(language)?.name ?? language;
  const glossName = getLanguageByCode(glossLanguage)?.name ?? glossLanguage;
  const convention = getGlossConvention(language);
  const lines = [
    SHARED_RULES,
    '',
    `SENTENCE LANGUAGE: ${sentenceName}.`,
    `GLOSS LANGUAGE: ${glossName}. Write every unit, and every bracketed label, in ${glossName}.`,
  ];
  if (convention !== null) {
    lines.push('', `${sentenceName.toUpperCase()} RULES:`);
    for (const note of convention.notes) lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

/** One source word and what it becomes. */
export type HyperliteralPair = { source: string; gloss: string };

/**
 * Parse a model reply, or null when it isn't the shape the prompt asked for.
 * Lives beside the prompt because the two define one contract: a change to the
 * requested JSON has to move both.
 *
 * Pairs rather than one string because the app cannot recover the split
 * afterwards. A sentence written without spaces (Thai, Japanese, Chinese) has
 * no split to recover, and even a spaced one can disagree: Thai
 * `สบายดี ขอบใจนะ!` is two space-separated tokens whose gloss has four units.
 * Asking the model to segment is the only place the two can be made to agree.
 */
export function parseHyperliteral(raw: string): HyperliteralPair[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = (parsed as Record<string, unknown>).pairs;
  if (!Array.isArray(value) || value.length === 0) return null;

  const pairs: HyperliteralPair[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [source, gloss] = entry;
    if (typeof source !== 'string' || typeof gloss !== 'string') return null;
    const trimmedSource = source.trim();
    const trimmedGloss = gloss.trim();
    // A whitespace-only pair is the model reproducing the sentence's spaces,
    // which it does even when told not to. Dropping it is right — spacing is
    // the display's job — and rejecting the whole reply over one, which an
    // earlier version did, threw away half of otherwise perfect answers.
    if (trimmedSource.length === 0) continue;
    if (trimmedGloss.length === 0) return null;
    pairs.push({ source: trimmedSource, gloss: trimmedGloss });
  }
  return pairs.length > 0 ? pairs : null;
}

/**
 * The display line: the pairs' glosses in order. Derived rather than asked
 * for separately, so the line and the columns can never disagree.
 */
export function hyperliteralLine(pairs: readonly HyperliteralPair[]): string {
  return pairs.map((p) => p.gloss).join(' ');
}

/**
 * Whether the pairs actually reproduce the sentence. The prompt asks for
 * literal substrings; a model that translates or drops one would otherwise
 * produce a mapping that looks right and pairs the wrong words. Compared with
 * whitespace removed, because the model cannot know the sentence's own spacing
 * for a language that has none.
 */
export function pairsCoverSentence(
  pairs: readonly HyperliteralPair[],
  text: string,
): boolean {
  const strip = (s: string) => s.replace(/\s+/g, '');
  return strip(pairs.map((p) => p.source).join('')) === strip(text);
}
