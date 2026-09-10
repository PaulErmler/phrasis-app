/**
 * First-person (speaker gender) marking per language.
 *
 * A sentence is rendered in one voice, the text's own
 * (lib/preferenceResolution.ts). `FIRST_PERSON_CONFIG` is which languages
 * change their wording with that voice, and the example pair that shows it.
 *
 * The `Language` entries in lib/languages.ts carry only the flag
 * (`firstPersonMarking`); the examples and prompt text live here so the
 * catalogue stays readable. `tests/unit/lib/languageForms.test.ts` asserts
 * the flags and the configs agree. Adding a language: see
 * docs/agents/adding-a-language.md.
 *
 * Copy was drafted for learners and fact-checked against reference grammars
 * on 2026-09-06 and 2026-09-07; each entry lists its sources.
 */

import { getLanguageByCode, type Language } from './languages';

// ------------------------------------------------------------------ types

export type FirstPersonConfig = {
  /** One line under the step title. */
  intro: string;
  exampleEn: string;
  masculine: string;
  feminine: string;
  sources: string[];
};

// ------------------------------------------------------ first-person config

const TIRED: Pick<FirstPersonConfig, 'exampleEn'> = { exampleEn: "I'm tired." };

export const FIRST_PERSON_CONFIG: Record<string, FirstPersonConfig> = {
  ru: {
    ...TIRED,
    intro:
      'Russian changes past-tense verbs and some adjectives depending on who is speaking.',
    masculine: 'Я устал.',
    feminine: 'Я устала.',
    sources: ['https://en.wikipedia.org/wiki/Russian_grammar'],
  },
  uk: {
    ...TIRED,
    intro:
      'Ukrainian changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Я втомився.',
    feminine: 'Я втомилася.',
    sources: ['https://en.wikipedia.org/wiki/Ukrainian_grammar'],
  },
  pl: {
    ...TIRED,
    intro:
      'Polish changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Jestem zmęczony.',
    feminine: 'Jestem zmęczona.',
    sources: ['https://en.wikipedia.org/wiki/Polish_grammar'],
  },
  cs: {
    ...TIRED,
    intro:
      'Czech changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Jsem unavený.',
    feminine: 'Jsem unavená.',
    sources: ['https://en.wikipedia.org/wiki/Czech_declension'],
  },
  sk: {
    ...TIRED,
    intro:
      'Slovak changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Som unavený.',
    feminine: 'Som unavená.',
    sources: ['https://en.wikipedia.org/wiki/Slovak_declension'],
  },
  bg: {
    ...TIRED,
    intro:
      'Bulgarian changes adjectives and some past-tense forms depending on who is speaking.',
    masculine: 'Уморен съм.',
    feminine: 'Уморена съм.',
    sources: ['https://en.wikipedia.org/wiki/Bulgarian_grammar'],
  },
  hr: {
    ...TIRED,
    intro:
      'Croatian changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Umoran sam.',
    feminine: 'Umorna sam.',
    sources: ['https://en.wikipedia.org/wiki/Serbo-Croatian_grammar'],
  },
  sr: {
    ...TIRED,
    intro:
      'Serbian changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Уморан сам.',
    feminine: 'Уморна сам.',
    sources: ['https://en.wikipedia.org/wiki/Serbo-Croatian_grammar'],
  },
  sl: {
    ...TIRED,
    intro:
      'Slovene changes past-tense verbs and adjectives depending on who is speaking.',
    masculine: 'Utrujen sem.',
    feminine: 'Utrujena sem.',
    sources: ['https://en.wikipedia.org/wiki/Slovene_grammar'],
  },
  lt: {
    ...TIRED,
    intro:
      'Lithuanian changes adjectives and participles depending on who is speaking.',
    masculine: 'Aš pavargęs.',
    feminine: 'Aš pavargusi.',
    sources: ['https://en.wikipedia.org/wiki/Lithuanian_grammar'],
  },
  lv: {
    ...TIRED,
    intro:
      'Latvian changes adjectives and participles depending on who is speaking.',
    masculine: 'Esmu noguris.',
    feminine: 'Esmu nogurusi.',
    sources: ['https://en.wikipedia.org/wiki/Latvian_grammar'],
  },
  fr: {
    exampleEn: "I'm ready.",
    intro:
      'French changes adjectives and some past participles depending on who is speaking.',
    masculine: 'Je suis prêt.',
    feminine: 'Je suis prête.',
    sources: [
      'https://en.wiktionary.org/wiki/prête',
      'https://en.wiktionary.org/wiki/fatigué',
    ],
  },
  es: {
    ...TIRED,
    intro:
      'Spanish changes adjectives and nouns about yourself depending on who is speaking.',
    masculine: 'Estoy cansado.',
    feminine: 'Estoy cansada.',
    sources: ['https://en.wikipedia.org/wiki/Spanish_adjectives'],
  },
  es_latam: {
    ...TIRED,
    intro:
      'Spanish changes adjectives and nouns about yourself depending on who is speaking.',
    masculine: 'Estoy cansado.',
    feminine: 'Estoy cansada.',
    sources: ['https://en.wikipedia.org/wiki/Spanish_adjectives'],
  },
  ca: {
    ...TIRED,
    intro:
      'Catalan changes adjectives and nouns about yourself depending on who is speaking.',
    masculine: 'Estic cansat.',
    feminine: 'Estic cansada.',
    sources: ['https://en.wikipedia.org/wiki/Catalan_grammar'],
  },
  it: {
    ...TIRED,
    intro:
      'Italian changes adjectives and some past participles depending on who is speaking.',
    masculine: 'Sono stanco.',
    feminine: 'Sono stanca.',
    sources: ['https://en.wikipedia.org/wiki/Italian_grammar'],
  },
  pt: {
    ...TIRED,
    intro:
      'Portuguese changes adjectives and nouns about yourself depending on who is speaking.',
    masculine: 'Estou cansado.',
    feminine: 'Estou cansada.',
    sources: ['https://en.wikipedia.org/wiki/Portuguese_grammar'],
  },
  pt_pt: {
    ...TIRED,
    intro:
      'Portuguese changes adjectives and nouns about yourself depending on who is speaking.',
    masculine: 'Estou cansado.',
    feminine: 'Estou cansada.',
    sources: ['https://en.wikipedia.org/wiki/Portuguese_grammar'],
  },
  ro: {
    ...TIRED,
    intro:
      'Romanian changes adjectives and nouns about yourself depending on who is speaking.',
    masculine: 'Sunt obosit.',
    feminine: 'Sunt obosită.',
    sources: ['https://en.wikipedia.org/wiki/Romanian_grammar'],
  },
  el: {
    ...TIRED,
    intro:
      'Greek changes adjectives and participles depending on who is speaking.',
    masculine: 'Είμαι κουρασμένος.',
    feminine: 'Είμαι κουρασμένη.',
    sources: ['https://en.wiktionary.org/wiki/κουρασμένος'],
  },
  hi: {
    exampleEn: "I'm going.",
    intro:
      'Hindi changes present and past verb forms and adjectives depending on who is speaking.',
    masculine: 'मैं जा रहा हूँ।',
    feminine: 'मैं जा रही हूँ।',
    sources: ['https://en.wikibooks.org/wiki/Hindi/Verbs'],
  },
  he: {
    ...TIRED,
    intro:
      'Hebrew changes present-tense verbs and adjectives depending on who is speaking; past and future are the same for everyone.',
    masculine: 'אני עייף.',
    feminine: 'אני עייפה.',
    sources: ['https://en.wikipedia.org/wiki/Modern_Hebrew_grammar'],
  },
  ar: {
    ...TIRED,
    intro:
      'Arabic changes adjectives and participles about yourself (tired, going) depending on who is speaking; verbs stay the same.',
    masculine: 'أنا متعب.',
    feminine: 'أنا متعبة.',
    sources: [
      'https://en.wikipedia.org/wiki/Arabic_grammar',
      'https://en.wikipedia.org/wiki/Arabic_verbs',
      'https://en.wiktionary.org/wiki/متعب',
    ],
  },
  ar_eg: {
    ...TIRED,
    intro:
      'Egyptian Arabic changes adjectives and participles about yourself (tired, going) depending on who is speaking; verbs stay the same.',
    masculine: 'أنا تعبان.',
    feminine: 'أنا تعبانة.',
    sources: [
      'https://en.wikipedia.org/wiki/Egyptian_Arabic',
      'https://en.wiktionary.org/wiki/تعبان',
    ],
  },
  ar_sa: {
    ...TIRED,
    intro:
      'Saudi Arabic changes adjectives and participles about yourself (tired, going) depending on who is speaking; verbs stay the same.',
    masculine: 'أنا تعبان.',
    feminine: 'أنا تعبانة.',
    sources: [
      'https://en.wikipedia.org/wiki/Hejazi_Arabic',
      'https://en.wiktionary.org/wiki/تعبان',
    ],
  },
  ar_iq: {
    ...TIRED,
    intro:
      'Iraqi Arabic changes adjectives and participles about yourself (tired, going) depending on who is speaking; verbs stay the same.',
    masculine: 'آني تعبان.',
    feminine: 'آني تعبانة.',
    sources: [
      'https://en.wiktionary.org/wiki/آني',
      'https://archive.org/details/modern-iraqi-arabic-a-textbook-by-yasin-m-alkalesi',
      'https://en.wiktionary.org/wiki/تعبان',
    ],
  },
  ar_lev: {
    ...TIRED,
    intro:
      'Levantine Arabic changes adjectives and participles about yourself (tired, going) depending on who is speaking; verbs stay the same.',
    masculine: 'أنا تعبان.',
    feminine: 'أنا تعبانة.',
    sources: [
      'https://en.wikipedia.org/wiki/Levantine_Arabic_grammar',
      'https://en.wiktionary.org/wiki/تعبان',
    ],
  },
  th: {
    ...TIRED,
    intro:
      'Thai changes the word for "I" and the polite particle depending on who is speaking.',
    masculine: 'ผมเหนื่อยครับ',
    feminine: 'ฉันเหนื่อยค่ะ',
    sources: ['https://www.thaipod101.com/blog/2020/08/24/thai-pronouns/'],
  },
  ja: {
    exampleEn: "I'm a student.",
    intro:
      'Japanese changes the word for "I" and some sentence endings depending on who is speaking.',
    masculine: '僕は学生です。',
    feminine: '私は学生です。',
    sources: [
      'https://human.libretexts.org/Bookshelves/Languages/Japanese/Japanese_Introductory_1_(Hamada)/06:_Expanding_Your_Japanese_Toolkit_(1)/6.07:_Gender_and_First-Person_Pronouns',
    ],
  },
  vi: {
    ...TIRED,
    intro:
      'Vietnamese changes the word for "I" depending on your gender and your age relative to the listener.',
    masculine: 'Anh mệt rồi.',
    feminine: 'Chị mệt rồi.',
    sources: ['https://en.wikibooks.org/wiki/Vietnamese/Personal_pronouns'],
  },
  ko: {
    exampleEn: 'This is my older brother.',
    intro:
      'Korean changes a few family and self-reference words depending on who is speaking, such as 형 versus 오빠.',
    masculine: '제 형이에요.',
    feminine: '제 오빠예요.',
    sources: ['https://www.90daykorean.com/oppa-hyung-noona-unnie/'],
  },
  de: {
    exampleEn: "I'm a teacher.",
    intro:
      'German has separate masculine and feminine words for jobs and roles (Lehrer / Lehrerin); adjectives do not change.',
    masculine: 'Ich bin Lehrer.',
    feminine: 'Ich bin Lehrerin.',
    sources: ['https://en.wiktionary.org/wiki/Lehrerin'],
  },
  nl: {
    exampleEn: "I'm a teacher.",
    intro:
      'Dutch has feminine forms for some jobs and roles (leraar / lerares); adjectives do not change.',
    masculine: 'Ik ben leraar.',
    feminine: 'Ik ben lerares.',
    sources: [
      'https://taaladvies.net/taal-en-gender-beroeps-functie-en-rolbenamingen-algemeen/',
    ],
  },
  is: {
    ...TIRED,
    intro:
      'Icelandic changes adjectives and past participles depending on who is speaking.',
    masculine: 'Ég er þreyttur.',
    feminine: 'Ég er þreytt.',
    sources: ['https://en.wiktionary.org/wiki/%C3%BEreyttur'],
  },
  da: {
    exampleEn: "I'm her friend.",
    intro:
      'Danish keeps a feminine form for a few roles, above all veninde for a female friend; adjectives do not change.',
    masculine: 'Jeg er hendes ven.',
    feminine: 'Jeg er hendes veninde.',
    sources: [
      'https://dsn.dk/nyt-fra-sprognaevnet/oktober-2024-2/sangerinde-bedemand-og-forperson-holdninger-til-koennede-endelser-i-dansk/',
    ],
  },
};

FIRST_PERSON_CONFIG.vi_south = FIRST_PERSON_CONFIG.vi;

// ---------------------------------------------------------------- helpers

/**
 * The concrete language codes a course language resolves to for these
 * settings: a mixed dialect expands to its sub-variants (es_mixed -> es +
 * es_latam), an accent variant collapses to the language whose text it
 * shares (en_gb -> en), everything else is itself.
 */
export function concreteLanguageCodes(code: string): string[] {
  const lang = getLanguageByCode(code);
  if (!lang) return [code];
  if (lang.variants) return lang.variants.map((variant) => variant.subCode);
  if (lang.sharesTextWith) return [lang.sharesTextWith];
  return [code];
}

/** Whether this language's wording changes with the speaker's gender. */
export function languageMarksFirstPerson(code: string): boolean {
  return concreteLanguageCodes(code).some(
    (c) => FIRST_PERSON_CONFIG[c] !== undefined,
  );
}

export function getFirstPersonConfig(
  code: string,
): FirstPersonConfig | undefined {
  for (const c of concreteLanguageCodes(code)) {
    const config = FIRST_PERSON_CONFIG[c];
    if (config) return config;
  }
  return undefined;
}

/**
 * Every language the flags in lib/languages.ts say is marked must have a
 * config here and vice versa. Exposed for the unit test.
 */
export function firstPersonFlagMismatches(
  languages: readonly Language[],
): string[] {
  const out: string[] = [];
  for (const lang of languages) {
    const config = FIRST_PERSON_CONFIG[lang.code];
    if (lang.firstPersonMarking && !config)
      out.push(`${lang.code}: firstPersonMarking flagged, no config`);
    if (!lang.firstPersonMarking && config)
      out.push(`${lang.code}: first-person config present, no flag`);
  }
  return out;
}
