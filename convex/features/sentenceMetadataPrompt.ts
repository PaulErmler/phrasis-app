import { getLanguageByCode, getSpeakerGenderMarking } from '../../lib/languages';

/**
 * Prompt builders for the sentence-metadata classifier, in a leaf module (no
 * Convex runtime imports) so `scripts/evalSentenceMetadata.mjs` can import the
 * exact production prompt and measure classifier accuracy against
 * `data_preparation/gender_eval/`. `fetchSentenceMetadata` is the production
 * consumer — the prompt here IS the prompt in production, single source of
 * truth.
 *
 * The speaker-gender instruction is assembled PER REQUEST from the languages
 * actually present, consulting `speakerGenderMarking` in `lib/languages.ts` —
 * no prompt ever embeds a global list of gender-marking languages, so a
 * config change is the single point of truth (see the speaker-gender spec,
 * decision 8).
 */

/** Display names of the request's marked languages, split by marking tier.
 * Request order, deduplicated (dialect variants can share a display name). */
export function partitionMarkedLanguages(languages: string[]): {
  grammatical: string[];
  stylistic: string[];
} {
  const grammatical: string[] = [];
  const stylistic: string[] = [];
  for (const code of languages) {
    const marking = getSpeakerGenderMarking(code);
    if (marking === 'none') continue;
    const name = getLanguageByCode(code)?.name ?? code;
    const bucket = marking === 'grammatical' ? grammatical : stylistic;
    if (!bucket.includes(name)) bucket.push(name);
  }
  return { grammatical, stylistic };
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The speakerGender field definition for THIS request's languages. Naming
 * only the marked subset keeps the classifier from fishing for morphology in
 * languages that cannot express it; the explicit lexical escape hatch (role
 * nouns like German "Lehrerin") stays open everywhere, because a user upload
 * with an explicit self-description must pin its voice (decision 6 — the
 * gold dataset's control files encode this).
 */
function buildSpeakerGenderFieldDefinition(languages: string[]): string {
  const { grammatical, stylistic } = partitionMarkedLanguages(languages);
  const lexicalNote =
    'An explicit lexical self-description in ANY language also fixes it (a gendered role noun or gendered self-reference pronoun predicated of the speaker, e.g. German "Ich bin Lehrerin" = female). Gendered forms referring to the addressee or a third person do NOT count. Otherwise return "neutral". Do NOT guess based on topic or stereotype.';

  if (grammatical.length === 0 && stylistic.length === 0) {
    return `- speakerGender: The grammatical gender of the speaker. None of the languages in this request mark the speaker's gender grammatically, so morphology cannot fix it — return "neutral". ${lexicalNote}`;
  }

  const clauses: string[] = [];
  if (grammatical.length > 0) {
    clauses.push(
      `${joinNames(grammatical)} mark${grammatical.length === 1 ? 's' : ''} it grammatically — look for gender agreement with a first-person subject: past-tense verbs, participles, predicate adjectives, first-person verb forms`,
    );
  }
  if (stylistic.length > 0) {
    clauses.push(
      `${joinNames(stylistic)} mark${stylistic.length === 1 ? 's' : ''} it stylistically — look for speaker-gender-linked forms: polite particles, gendered self-reference pronouns, gendered register`,
    );
  }
  return `- speakerGender: The grammatical gender of the speaker. Of the languages in this request, ${clauses.join('; ')}. The other languages in this request cannot mark it morphologically. Return "male" or "female" ONLY when at least one supplied rendering actually marks the SPEAKER's gender this way. ${lexicalNote}`;
}

/** The classifier system prompt for a request over these languages. */
export function buildMetadataSystemPrompt(languages: string[]): string {
  return `You analyze a sentence and return strict linguistic metadata as JSON.

You will receive one or more renderings of the SAME sentence in different languages. Use cross-lingual signals — gendered morphology in any one of the supplied translations is enough to fix the sentence's gender. Treat the renderings as semantically identical: do not invent extra meaning that no rendering supports.

Return ONLY a valid JSON object with EXACTLY these five keys and no others, no markdown, no explanation:

{
  "register": "formal" | "informal" | "neutral",
  "addresseeNumber": "singular" | "plural" | "not_applicable",
  "speakerGender": "male" | "female" | "neutral",
  "addresseeGender": "male" | "female" | "neutral" | "not_applicable",
  "addressesSomeone": true | false
}

FIELD DEFINITIONS:

- register: The formality level of the sentence. "formal" for polite/respectful forms (Spanish "usted", French "vous", German "Sie", Japanese です/ます, Korean 해요체/합쇼체, Hindi आप). "informal" for casual/familiar forms (Spanish "tú/vosotros", French "tu", German "du", Japanese plain form, Korean 반말, Hindi तुम). "neutral" only when there is no addressee or no formality marking at all.

- addresseeNumber: How many people are being addressed. "singular" if the sentence speaks to one person. "plural" if it speaks to more than one. "not_applicable" if the sentence has no addressee (e.g. "It is raining.", "The book is on the table.", a first-person statement with no "you"). This field NEVER takes "neutral" — its no-addressee value is "not_applicable".

${buildSpeakerGenderFieldDefinition(languages)}

- addresseeGender: Same rule, but for the person being addressed. "not_applicable" if there is no addressee. "neutral" if there is an addressee but no rendering grammatically marks their gender.

- addressesSomeone: Boolean. true if the sentence speaks to a 2nd-person addressee (imperatives, direct questions, vocatives, sentences containing "you"/"your", commands, requests, greetings). false otherwise (descriptive/narrative sentences like "It is raining.", "The Pacific Ocean is the largest body of water on Earth.", first-person statements with no second-person reference). When addressesSomeone is false, addresseeNumber should be "not_applicable" and addresseeGender should be "not_applicable".

Be strict: if no rendering forces a value, return "neutral" / "not_applicable". Do not invent gender information.`;
}

/**
 * The compact speakerGender rule for the custom-text autofill prompt
 * (`convex/features/customTexts.ts`), same per-request construction as the
 * classifier's field definition, phrased as one METADATA RULES bullet.
 */
export function buildAutofillSpeakerGenderRule(languages: string[]): string {
  const { grammatical, stylistic } = partitionMarkedLanguages(languages);
  const marked = [...grammatical, ...stylistic];
  const tail =
    'An explicit gendered self-description in any language (a role noun like German "Lehrerin") also fixes it. Otherwise return "neutral". Never guess from topic or stereotype.';
  if (marked.length === 0) {
    return `- speakerGender: "male" | "female" | "neutral" — none of this request's languages mark the speaker's gender grammatically, so morphology cannot fix it. ${tail}`;
  }
  return `- speakerGender: "male" | "female" | "neutral" — of this request's languages, ${joinNames(marked)} mark the speaker's gender (first-person gender agreement${stylistic.length > 0 ? ', or speaker-linked particles and self-reference pronouns' : ''}). Return "male" or "female" ONLY when at least one rendering marks the SPEAKER's gender this way. ${tail}`;
}

/**
 * The user turn: the renderings block exactly as production sends it. Each
 * entry is labelled with the language's display name when the code is known
 * (the classifier reads "Spanish", not "es").
 */
export function buildMetadataUserPrompt(
  entries: Array<{ language: string; text: string }>,
): string {
  const renderings = entries
    .map((t) => {
      const lang = getLanguageByCode(t.language);
      return `[${lang?.name ?? t.language}]: ${t.text}`;
    })
    .join('\n');
  return `Renderings of the same sentence:\n${renderings}\n\nReturn the metadata JSON now.`;
}
