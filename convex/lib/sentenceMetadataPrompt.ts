import { getLanguageByCode } from '../../lib/languages';

/**
 * The sentence-metadata classifier prompt, split out of
 * features/sentenceMetadata.ts as a Convex-runtime-free module (the same
 * seam as translationAutofillPrompt.ts) so the eval runner
 * (scripts/eval-sentence-metadata.mjs) grades through the EXACT production
 * prompt without dragging in `_generated/server`. features/sentenceMetadata.ts builds its request from
 * the two builders below, change the prompt here and production and the
 * evals move together.
 */

const METADATA_SYSTEM_PROMPT = `You analyze a sentence and return strict linguistic metadata as JSON.

You will receive one or more renderings of the SAME sentence in different languages. Use cross-lingual signals. Gendered morphology in any one of the supplied translations fixes the sentence's gender, subject to GENDER SCOPE below. Treat the renderings as semantically identical: do not invent extra meaning that no rendering supports.

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

- addresseeNumber: How many people are being addressed. "singular" if the sentence speaks to one person. "plural" if it speaks to more than one. "not_applicable" if the sentence has no addressee (e.g. "It is raining.", "The book is on the table.", a first-person statement with no "you"). This field NEVER takes "neutral". Its no-addressee value is "not_applicable".

- speakerGender: The gender of the SPEAKER, whoever utters the sentence. "male"/"female" ONLY when a rendering carries a marker referring to that speaker:
  * First-person agreement morphology: Romance participles and adjectives ("estoy cansada" = female, "sono andato" = male), Slavic past tense ("я пошёл" = male, "я пошла" = female), Arabic, Hebrew and Hindi first-person verb forms and suffixes.
  * Gendered self-reference: Japanese 僕/俺 vs あたし, Thai ผม vs ดิฉัน, Vietnamese anh vs chị as "I".
  * Kinship terms asymmetric by speaker gender. The term names a relative but reveals who is speaking: Korean 형/누나 = male speaker, 오빠/언니 = female speaker. Any-gender terms (Korean 동생) fix nothing.
  * A gendered noun predicated of the speaker: "I am X's father/husband/older brother" = male, "I am X's mother/wife/older sister" = female. German "Ich bin Ärztin" = female.
  Otherwise "neutral". Do NOT guess from topic or stereotype.

- addresseeGender: Same rule, but for the person being addressed. "not_applicable" if there is no addressee. "neutral" if there is an addressee but no rendering grammatically marks their gender.

- addressesSomeone: Boolean. true if the sentence speaks to a 2nd-person addressee (imperatives, direct questions, vocatives, sentences containing "you"/"your", commands, requests, greetings). false otherwise (descriptive/narrative sentences like "It is raining.", "The Pacific Ocean is the largest body of water on Earth.", first-person statements with no second-person reference). When addressesSomeone is false, addresseeNumber should be "not_applicable" and addresseeGender should be "not_applicable".

GENDER SCOPE (speakerGender and addresseeGender only, never register): a marker counts only if it refers to THIS sentence's own speaker or addressee.
  * Inside a quotation the marking is the quoted person's, and their addressee's: "Ella dijo: «Estoy cansada»" and "Он спросил: «Ты устала?»" are both speakerGender "neutral". The marker applies only when the quoted person is the speaker ("Dije: «Estoy cansada»").
  * Second-person agreement marks the addressee: "ты сказала" = addresseeGender "female", speakerGender "neutral".
  * A third-person subject or any other person mentioned marks only that person. The gender of a relative, spouse or acquaintance says nothing about the speaker's own.

Be strict: if no rendering forces a value, return "neutral" / "not_applicable". Do not invent gender information.`;

/** The classifier system prompt. Static — the same string for every request. */
export function buildMetadataSystemPrompt(): string {
  return METADATA_SYSTEM_PROMPT;
}

/**
 * The user prompt `fetchSentenceMetadata` sends: one `[LanguageName]: text`
 * line per rendering (English language name, falling back to the raw code
 * for unknown codes), then the fixed closing instruction.
 */
export function buildMetadataUserPrompt(
  renderings: { language: string; text: string }[],
): string {
  const lines = renderings
    .map((t) => {
      const lang = getLanguageByCode(t.language);
      return `[${lang?.name ?? t.language}]: ${t.text}`;
    })
    .join('\n');
  return `Renderings of the same sentence:\n${lines}\n\nReturn the metadata JSON now.`;
}
