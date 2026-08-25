import { getLanguageByCode } from '../../lib/languages';

/**
 * Prompt for the sentence-metadata classifier, in a leaf module (no Convex
 * runtime imports) so `scripts/evalSentenceMetadata.mjs` can import the exact
 * production prompt and measure classifier accuracy against
 * `data_preparation/gender_eval/`. `fetchSentenceMetadata` is the production
 * consumer — the prompt here IS the prompt in production, single source of
 * truth.
 */

export const METADATA_SYSTEM_PROMPT = `You analyze a sentence and return strict linguistic metadata as JSON.

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

- speakerGender: The grammatical gender of the speaker. Return "male" or "female" ONLY when at least one supplied translation contains gender-marked morphology referring to the speaker. Examples that fix the gender:
  * Spanish/Italian/Portuguese/French past participles or adjectives agreeing with a first-person subject ("estoy cansada" = female, "sono andato" = male).
  * Russian past-tense verbs with first-person subject ("я пошёл" = male, "я пошла" = female).
  * Arabic verb conjugations and pronoun suffixes referring to the speaker.
  * Hebrew verb forms in first person.
  * Hindi verb agreement with first-person subject.
  * Polish/Czech past tense gendered forms.
  Otherwise return "neutral". Do NOT guess based on topic or stereotype.

- addresseeGender: Same rule, but for the person being addressed. "not_applicable" if there is no addressee. "neutral" if there is an addressee but no rendering grammatically marks their gender.

- addressesSomeone: Boolean. true if the sentence speaks to a 2nd-person addressee (imperatives, direct questions, vocatives, sentences containing "you"/"your", commands, requests, greetings). false otherwise (descriptive/narrative sentences like "It is raining.", "The Pacific Ocean is the largest body of water on Earth.", first-person statements with no second-person reference). When addressesSomeone is false, addresseeNumber should be "not_applicable" and addresseeGender should be "not_applicable".

Be strict: if no rendering forces a value, return "neutral" / "not_applicable". Do not invent gender information.`;

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
