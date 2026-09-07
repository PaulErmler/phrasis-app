import { getLanguageByCode } from '../../lib/languages';
import { stripJsonFences } from './llmJson';

/**
 * Prompt for model-generated romanization, split out as a Convex-runtime-free
 * module on the same seam as sentenceMetadataPrompt.ts, so `pnpm eval:rom`
 * grades the EXACT production prompt without pulling in `_generated/server`.
 *
 * Only two languages route here, and only because they have nowhere else to
 * go (see `romanizationBackend` in lib/languages.ts):
 *
 * - Thai has no romanizer at all. Google v3 does not support it, and the
 *   pure-JS libraries are not learner-grade. It uses RTGS, the Royal
 *   Institute standard, which is what appears on Thai signage — note that
 *   RTGS records neither tone nor vowel length, so เขา, ขาว and ข้าว all
 *   come out "khao". That is the standard's own documented limitation, not
 *   an engine failure.
 * - Hebrew had `hebrew-transliteration`, which is SBL Academic style: it
 *   transliterates the consonants of unpointed Hebrew and drops the vowels,
 *   so שלום לכולם came out "šlwm lkwlm". It scored 38% against
 *   data_preparation/romanization_eval where the model scores 96%.
 *
 * Everything else keeps a deterministic engine, which is free, instant and
 * reproducible: Mandarin, Cantonese and Korean score 95-99% on their local
 * libraries, and Arabic routes to Google v3.
 */

type RomanizationConvention = {
  /** Which spoken variety the romanization should reflect. */
  variety: string;
  /** The named system, so the target is checkable against a gold set. */
  system: string;
  /** Language-specific traps, stated as instructions. */
  notes: readonly string[];
};

const CONVENTIONS: Record<string, RomanizationConvention> = {
  th: {
    variety: 'Standard (Bangkok) Thai',
    system:
      'the Royal Thai General System of Transcription (RTGS), the Royal Institute standard used on Thai road signs and in official documents',
    notes: [
      'Use ONLY the 26 unmodified Latin letters. RTGS records no tone and no vowel length, so never write a tone mark, an accent, a macron or a doubled vowel: เขา, ขาว and ข้าว are all "khao".',
      'Thai is written without spaces between words. Split the sentence into words yourself and separate the words with spaces. Syllables WITHIN a word are joined, not hyphenated: สวัสดี is "sawatdi", not "sa-wat-di".',
      'Transcribe the SOUND, not the spelling. Final consonants take their spoken value, and a vowel is written where it is pronounced rather than where it is written: ประเทศ is "prathet", ทร in ทราย is "s" ("sai").',
      'Initial consonants: ก k; ข ฃ ค ฅ ฆ kh; ง ng; จ ฉ ช ฌ ch; ซ ศ ษ ส s; ญ ย y; ฎ ด d; ฏ ต t; ฐ ฑ ฒ ถ ท ธ th; ณ น n; บ b; ป p; ผ พ ภ ph; ฝ ฟ f; ม m; ร r; ล ฬ l; ว w; ห ฮ h.',
      'Final consonants: ก ข ค ฆ k; ง ng; จ ช ซ ฎ ฏ ฐ ฑ ฒ ด ต ถ ท ธ ศ ษ ส t; ญ ณ น ร ล ฬ n; บ ป พ ฟ ภ p; ม m.',
      'Vowels: –ะ –ั –า a; –ำ am; –ิ –ี i; –ึ –ื –ือ ue; –ุ –ู u; เ–ะ เ–็ เ– e; แ–ะ แ– ae; โ–ะ โ– เ–าะ –อ o; เ–อะ เ–ิ เ–อ oe.',
      'Diphthongs: เ–ีย ia; เ–ือ uea; –ัว –ว– ua; ใ– ไ– –ัย –าย ai; เ–า –าว ao; –ุย ui; โ–ย –อย oi; เ–ย oei; เ–ือย ueai; –วย uai; –ิว io; เ–ว eo; แ–ว aeo; เ–ียว iao.',
      'ฤ is "rue", "ri" or "roe" depending on the word; ฤๅ is "rue"; ฦ and ฦๅ are "lue".',
      'Drop silent letters and the karan mark ์ entirely: จันทร์ is "chan".',
      'Use a hyphen only to remove a real ambiguity: before a syllable that starts with a vowel, and before "ng" when the previous syllable ends in a vowel. สง่า is "sa-nga", not "sanga".',
    ],
  },
  he: {
    variety: 'Modern Israeli Hebrew',
    system:
      'a vowelled learner romanization (for example "shalom", "toda raba")',
    notes: [
      'The input is unpointed, without niqqud. Supply the vowels yourself from the word, not from the letters: every syllable needs a vowel. A consonant-only answer such as "toda rbh" is wrong.',
      'Use the modern merged pronunciation: ח and כ both kh, ע silent, ת always t, ו as v, צ as ts.',
      'Resolve an ambiguous spelling from the sentence context.',
      'Write it the way a learner would read it aloud in English spelling. Do not use academic symbols (š, ḥ, ʾ, ʿ) or macrons.',
    ],
  },
};

/** The convention for `code`, or null when this language does not route here. */
export function getRomanizationConvention(
  code: string,
): RomanizationConvention | null {
  return CONVENTIONS[code] ?? null;
}

const SHARED_RULES = `You romanize one sentence for a language learner. Return ONLY a JSON object, no markdown fence and no explanation:

{"romanization": "<the sentence in Latin script>"}

RULES:

- Romanize the whole sentence. Do not skip a word you are unsure of; give your best reading of it.
- Separate words with a single space. Never insert a line break.
- Write how the sentence is SPOKEN, not how it is spelled. Apply the assimilation and vowel reduction a native speaker actually produces.
- Every syllable carries a vowel. A run of consonants with no vowel means you have failed to read the word.
- Keep the sentence's punctuation out of the output. Read digits and abbreviations as the words they are spoken as.
- This is a reading aid, not a phonetic transcription. Do not use IPA symbols or tone letters (˥ ˦ ˧ ˨ ˩).`;

/** The system prompt for one language. Static per language. */
export function buildRomanizationSystemPrompt(language: string): string {
  const convention = getRomanizationConvention(language);
  if (convention === null) {
    throw new Error(
      `No romanization convention configured for language "${language}"`,
    );
  }
  const name = getLanguageByCode(language)?.name ?? language;
  return [
    SHARED_RULES,
    '',
    `LANGUAGE: ${name}. Romanize ${convention.variety}.`,
    `SYSTEM: ${convention.system}.`,
    '',
    `${name.toUpperCase()} RULES:`,
    ...convention.notes.map((note) => `- ${note}`),
  ].join('\n');
}

/**
 * Parse a model reply, or null when it isn't the shape the prompt asked for.
 * Lives beside the prompt because the two define one contract: a change to
 * the requested JSON has to move both.
 */
export function parseRomanization(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = (parsed as Record<string, unknown>).romanization;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
