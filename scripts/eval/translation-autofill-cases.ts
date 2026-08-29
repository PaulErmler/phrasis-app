import type { Metadata } from '../../convex/lib/sentenceMetadataShape';

/**
 * Fixtures for scripts/eval-translation-autofill.ts.
 *
 * The autofill prompt is language-neutral on purpose, so the cases carry the
 * language coverage: register systems (T‑V pronouns, Japanese/Korean speech
 * levels, Hindi आप/तुम), gendered morphology (Romance participles, Slavic
 * past tense, Hebrew verbs), script splits (Simplified/Traditional, Serbian
 * Cyrillic), dialect vocabulary (en_gb/en_us, es/es_latam, pt/pt_pt, vi
 * north/south), spoken-vernacular Cantonese, idioms, and polysemy.
 *
 * Checks are deliberately mechanical: regexes over the translation and exact
 * matching on the five metadata fields. They catch rule violations (wrong
 * register pronoun, wrong script, literal idiom, wrong dialect word), not
 * whether a translation reads well — read failures to judge that. Where a
 * metadata value is genuinely arguable the expectation is a set rather than
 * a single value — a case that fails for everyone teaches nothing.
 *
 * Regex hygiene: `\b` only works next to ASCII letters, so word-boundary
 * checks are ASCII-language-only; non-Latin checks match bare substrings
 * chosen to be unambiguous in context.
 */

/**
 * The phenomenon the case exercises. The report breaks accuracy down by
 * this, so a prompt change that fixes register while breaking idioms shows
 * up as a class regression rather than a two-point drop in the total.
 */
export type CaseKind =
  | 'register'
  | 'speakerGender'
  | 'addresseeGender'
  | 'addresseeNumber'
  | 'noAddressee'
  | 'idiom'
  | 'polysemy'
  | 'dialect'
  | 'script'
  | 'multiSource'
  | 'properNoun'
  | 'robustness';

/** Per-target mechanical checks, applied after postProcessTranslation. */
export type TargetCheck = {
  /** Every pattern must match the translation. */
  mustMatch?: RegExp[];
  /** No pattern may match the translation. */
  mustNotMatch?: RegExp[];
};

/**
 * Expected metadata. Omitted field = not scored for this case. An array
 * widens a genuinely arguable field instead of pretending the boundary is
 * sharp.
 */
export type MetadataExpectation = {
  register?: Metadata['register'] | Metadata['register'][];
  addresseeNumber?: Metadata['addresseeNumber'] | Metadata['addresseeNumber'][];
  speakerGender?: Metadata['speakerGender'] | Metadata['speakerGender'][];
  addresseeGender?: Metadata['addresseeGender'] | Metadata['addresseeGender'][];
  addressesSomeone?: boolean;
};

export type EvalCase = {
  id: string;
  kind: CaseKind;
  /** Source texts, as the user would have typed them (language = ISO code). */
  texts: { language: string; text: string }[];
  /** Target codes requested from the autofill (concrete, never `*_mixed`). */
  targets: string[];
  expectMetadata?: MetadataExpectation;
  /** Keyed by target code; targets without an entry get only the automatic
   *  shape/script checks. */
  checks?: Record<string, TargetCheck>;
  /** Why this case is in the set. Printed next to a failure. */
  why: string;
};

export const CASES: EvalCase[] = [
  // ------------------------------------------------------------- register
  {
    id: 'register-formal-de-source',
    kind: 'register',
    texts: [{ language: 'de', text: 'Könnten Sie mir bitte helfen?' }],
    targets: ['fr', 'es', 'ja', 'ru'],
    expectMetadata: {
      register: 'formal',
      addressesSomeone: true,
      addresseeNumber: ['singular', 'plural'],
      addresseeGender: 'neutral',
      speakerGender: 'neutral',
    },
    checks: {
      fr: {
        mustMatch: [/[Vv]ous/],
        mustNotMatch: [/\b[Tt]u\b/, /\b[Tt]e\b/],
      },
      es: {
        mustMatch: [/usted|[Pp]odría|[Pp]uede\b/],
        mustNotMatch: [/\b[Pp]uedes\b|\b[Pp]odrías\b/],
      },
      ja: { mustMatch: [/(ますか|ませんか|ください|いただけ)/] },
      ru: { mustNotMatch: [/\bты\b/iu, /\bтебе\b/iu] },
    },
    why: 'German Sie fixes formal register; every T‑V language must follow.',
  },
  {
    id: 'register-informal-de-source',
    kind: 'register',
    texts: [{ language: 'de', text: 'Kannst du mir dein Buch leihen?' }],
    targets: ['fr', 'es', 'ja', 'hi'],
    expectMetadata: {
      register: 'informal',
      addressesSomeone: true,
      addresseeNumber: 'singular',
    },
    checks: {
      fr: { mustMatch: [/\b[Tt]u\b|\b[Tt]on\b/], mustNotMatch: [/[Vv]ous/] },
      es: { mustMatch: [/\b[Pp]uedes|prestas\b/], mustNotMatch: [/usted/] },
      ja: { mustNotMatch: [/(です|ます|ください)/] },
      hi: { mustMatch: [/तुम|तू/], mustNotMatch: [/आप/] },
    },
    why: 'German du fixes informal register; ja must use plain form, hi तुम.',
  },
  {
    id: 'register-formal-ja-source',
    kind: 'register',
    texts: [{ language: 'ja', text: '明日、駅で待っていてください。' }],
    targets: ['de', 'ko', 'en'],
    expectMetadata: {
      register: ['formal', 'neutral'],
      addressesSomeone: true,
    },
    checks: {
      de: { mustNotMatch: [/\bdu\b|\bdich\b|\bdir\b/i] },
      // Any polite ending counts: 해요체 (-요) or 합쇼체 (-ㅂ니다/-십시오),
      // end-anchored so 반말 like 있어 fails.
      ko: { mustMatch: [/(요|니다|십시오)[.!?…]?\s*$/] },
      en: { mustMatch: [/station/i, /wait/i] },
    },
    why: 'Japanese ください is polite; de should not drop to du, ko keeps 존댓말.',
  },
  {
    id: 'register-informal-ru-source',
    kind: 'register',
    texts: [{ language: 'ru', text: 'Ты уже посмотрел этот фильм?' }],
    targets: ['de', 'fr', 'ko'],
    expectMetadata: {
      register: 'informal',
      addressesSomeone: true,
      addresseeNumber: 'singular',
      addresseeGender: 'male',
    },
    checks: {
      de: { mustMatch: [/\b[Dd]u\b/], mustNotMatch: [/\bSie\b/] },
      fr: { mustMatch: [/\b[Tt]u\b/], mustNotMatch: [/[Vv]ous/] },
      ko: { mustNotMatch: [/(습니까|십니까)/] },
    },
    why: 'Russian ты + masculine посмотрел: informal register AND male addressee.',
  },
  // -------------------------------------------------------- speaker gender
  {
    id: 'speaker-female-fr-source',
    kind: 'speakerGender',
    texts: [{ language: 'fr', text: 'Je suis très fatiguée aujourd’hui.' }],
    targets: ['es', 'ru', 'it'],
    expectMetadata: {
      speakerGender: 'female',
      addressesSomeone: false,
      addresseeNumber: 'not_applicable',
      addresseeGender: 'not_applicable',
    },
    checks: {
      es: { mustMatch: [/cansada/i], mustNotMatch: [/cansado\b/i] },
      ru: { mustMatch: [/устала|уставшая/i], mustNotMatch: [/устал\b/iu] },
      it: { mustMatch: [/stanca/i], mustNotMatch: [/stanco\b/i] },
    },
    why: 'French fatiguée marks a female speaker; gender must carry across.',
  },
  {
    id: 'speaker-male-it-source',
    kind: 'speakerGender',
    texts: [{ language: 'it', text: 'Ieri sono andato a casa presto.' }],
    targets: ['fr', 'ru', 'pl'],
    expectMetadata: { speakerGender: 'male', addressesSomeone: false },
    checks: {
      // No \b after the accented letter: JS \b is ASCII-only, so /rentré\b/
      // can never match. Feminine forms are excluded by mustNotMatch below.
      fr: {
        mustMatch: [/(rentré|allé|parti)/i],
        mustNotMatch: [/(rentrée|allée|partie)/i],
      },
      ru: {
        mustMatch: [/(пошёл|ушёл|пошел|ушел|вернулся|поехал)/i],
        mustNotMatch: [/(пошла|ушла|вернулась|поехала)/i],
      },
      pl: {
        mustMatch: [/(poszedłem|wróciłem|pojechałem)/i],
        mustNotMatch: [/(poszłam|wróciłam|pojechałam)/i],
      },
    },
    why: 'Italian andato marks a male speaker; Slavic past tense must agree.',
  },
  {
    id: 'speaker-female-he-target',
    kind: 'speakerGender',
    texts: [{ language: 'es', text: 'Estoy lista para salir.' }],
    targets: ['he', 'fr', 'en'],
    expectMetadata: { speakerGender: 'female', addressesSomeone: false },
    checks: {
      he: { mustMatch: [/מוכנה/], mustNotMatch: [/מוכן\s/] },
      fr: { mustMatch: [/prête/i], mustNotMatch: [/prêt\s|prêt[.!]/i] },
      en: { mustMatch: [/ready/i] },
    },
    why: 'Spanish lista fixes female; Hebrew must use the feminine adjective.',
  },
  // ------------------------------------------------------ addressee gender
  {
    id: 'addressee-female-es-source',
    kind: 'addresseeGender',
    texts: [{ language: 'es', text: '¿Estás cansada?' }],
    targets: ['he', 'ru', 'en'],
    expectMetadata: {
      addresseeGender: 'female',
      addressesSomeone: true,
      addresseeNumber: 'singular',
      register: 'informal',
      speakerGender: 'neutral',
    },
    checks: {
      he: { mustMatch: [/עייפה/], mustNotMatch: [/עייף[?\s]/] },
      ru: { mustMatch: [/устала|устала\?/iu], mustNotMatch: [/устал[?\s]/iu] },
      en: { mustMatch: [/tired/i] },
    },
    why: 'Spanish cansada fixes a female addressee; he/ru must agree.',
  },
  {
    id: 'addressee-male-he-source',
    kind: 'addresseeGender',
    texts: [{ language: 'he', text: 'אתה בא מחר?' }],
    targets: ['ru', 'es', 'de'],
    expectMetadata: {
      addresseeGender: 'male',
      addressesSomeone: true,
      addresseeNumber: 'singular',
    },
    checks: {
      ru: { mustNotMatch: [/придёшь ли она/iu] },
      es: { mustMatch: [/[Vv]ienes|[Vv]endrás/] },
      de: { mustMatch: [/[Kk]ommst/] },
    },
    why: 'Hebrew אתה is explicitly male-you; metadata must record it.',
  },
  {
    id: 'addressee-msa-neutral-rule',
    kind: 'addresseeGender',
    texts: [{ language: 'en', text: 'You are always welcome here.' }],
    targets: ['ar', 'de'],
    expectMetadata: {
      addressesSomeone: true,
      // The ar note: a forced MSA gender choice must not leak into metadata.
      addresseeGender: ['neutral'],
      speakerGender: 'neutral',
    },
    checks: {
      de: { mustMatch: [/willkommen/i] },
    },
    why: 'MSA must pick a grammatical gender, but the ar prompt note forbids letting that choice set addresseeGender.',
  },
  // ------------------------------------------------------ addressee number
  {
    id: 'addressee-plural-en-source',
    kind: 'addresseeNumber',
    texts: [{ language: 'en', text: 'Are you all coming to dinner tonight?' }],
    targets: ['es', 'es_latam', 'de'],
    expectMetadata: {
      addresseeNumber: 'plural',
      addressesSomeone: true,
    },
    checks: {
      es: { mustMatch: [/(vosotr|venís|vais)/i], mustNotMatch: [/ustedes/i] },
      es_latam: {
        mustMatch: [/(ustedes|vienen|van)/i],
        mustNotMatch: [/vosotr/i],
      },
      de: { mustMatch: [/\b(ihr|Ihr)\b/] },
    },
    why: '“You all” is plural; es must use vosotros, es_latam ustedes.',
  },
  {
    id: 'addressee-plural-de-ihr',
    kind: 'addresseeNumber',
    texts: [{ language: 'de', text: 'Kommt ihr morgen zu uns?' }],
    targets: ['es', 'fr', 'en'],
    expectMetadata: {
      addresseeNumber: 'plural',
      register: ['informal', 'neutral'],
      addressesSomeone: true,
    },
    checks: {
      es: { mustMatch: [/(venís|vosotr)/i] },
      fr: { mustMatch: [/[Vv]ous venez|[Vv]enez-vous/] },
      en: { mustNotMatch: [/\bhe\b|\bshe\b/i] },
    },
    why: 'German ihr is unambiguously plural informal.',
  },
  // ---------------------------------------------------------- no addressee
  {
    id: 'no-addressee-weather',
    kind: 'noAddressee',
    texts: [{ language: 'en', text: 'It rained all night in the mountains.' }],
    targets: ['de', 'ja', 'ar'],
    expectMetadata: {
      addressesSomeone: false,
      addresseeNumber: 'not_applicable',
      addresseeGender: 'not_applicable',
      speakerGender: 'neutral',
      register: 'neutral',
    },
    checks: {
      de: { mustMatch: [/(geregnet|regnete)/i] },
    },
    why: 'Descriptive sentence: all addressee fields must be not_applicable.',
  },
  {
    id: 'no-addressee-first-person',
    kind: 'noAddressee',
    texts: [
      { language: 'en', text: 'I work at a small bakery near the harbor.' },
    ],
    targets: ['fr', 'ko', 'ru'],
    expectMetadata: {
      addressesSomeone: false,
      addresseeNumber: 'not_applicable',
      addresseeGender: 'not_applicable',
      speakerGender: 'neutral',
    },
    checks: {
      fr: { mustMatch: [/boulangerie/i] },
      ru: { mustMatch: [/пекарн/iu] },
    },
    why: 'First-person statement with no “you”: not an addressee sentence.',
  },
  // ---------------------------------------------------------------- idioms
  {
    id: 'idiom-cats-and-dogs',
    kind: 'idiom',
    texts: [{ language: 'en', text: "It's raining cats and dogs out there." }],
    targets: ['de', 'es', 'fr'],
    expectMetadata: {
      addressesSomeone: false,
      register: ['neutral', 'informal'],
    },
    checks: {
      de: {
        mustNotMatch: [/Katzen/i, /Hunde/i],
        mustMatch: [/(gieß|schütt|Bindfäden|Strömen|Eimern)/i],
      },
      es: {
        mustNotMatch: [/gatos/i, /perros/i],
        mustMatch: [/(cántaros|diluvi|torrencial|mares)/i],
      },
      fr: { mustNotMatch: [/chats/i, /chiens/i] },
    },
    why: 'The classic literal-translation trap; meaning, not words.',
  },
  {
    id: 'idiom-daumen-druecken',
    kind: 'idiom',
    texts: [{ language: 'de', text: 'Ich drücke dir für morgen die Daumen!' }],
    targets: ['en', 'es', 'fr'],
    expectMetadata: {
      addressesSomeone: true,
      register: ['informal', 'neutral'],
      addresseeNumber: 'singular',
    },
    checks: {
      en: {
        mustMatch: [/fingers crossed|cross(ing)? my fingers|luck/i],
        mustNotMatch: [/thumbs?/i],
      },
      es: {
        mustNotMatch: [/pulgares/i],
        mustMatch: [/(suerte|dedos)/i],
      },
      fr: { mustNotMatch: [/pouces/i] },
    },
    why: 'German Daumen drücken must become the target-language idiom.',
  },
  {
    id: 'idiom-tomar-el-pelo',
    kind: 'idiom',
    texts: [{ language: 'es', text: '¡Me estás tomando el pelo!' }],
    targets: ['en', 'de', 'ru'],
    expectMetadata: {
      addressesSomeone: true,
      register: 'informal',
      addresseeNumber: 'singular',
    },
    checks: {
      en: {
        mustMatch: [/(pulling my leg|kidding|joking|having me on)/i],
        mustNotMatch: [/hair/i],
      },
      de: {
        mustNotMatch: [/Haare?\b/i],
        mustMatch: [/(Arm|veräppel|verarsch|Witz|nimmst.*hoch)/i],
      },
      ru: { mustNotMatch: [/волос/iu] },
    },
    why: 'Spanish tomar el pelo: “hair” in the output means word-by-word translation.',
  },
  // -------------------------------------------------------------- polysemy
  {
    id: 'polysemy-river-bank',
    kind: 'polysemy',
    texts: [
      { language: 'en', text: 'We had a picnic on the bank of the river.' },
    ],
    targets: ['de', 'es', 'ru'],
    expectMetadata: { addressesSomeone: false },
    checks: {
      de: { mustMatch: [/[Uu]fer/], mustNotMatch: [/\bBank\b/] },
      es: { mustMatch: [/(orilla|ribera)/i], mustNotMatch: [/banco/i] },
      ru: { mustMatch: [/берег/iu], mustNotMatch: [/банк/iu] },
    },
    why: 'bank = riverbank here; the financial reading is a context failure.',
  },
  {
    id: 'polysemy-bat',
    kind: 'polysemy',
    texts: [{ language: 'en', text: 'A bat flew out of the cave at dusk.' }],
    targets: ['de', 'es', 'fr'],
    expectMetadata: { addressesSomeone: false, register: 'neutral' },
    checks: {
      de: { mustMatch: [/Fledermaus/i], mustNotMatch: [/Schläger/i] },
      es: { mustMatch: [/murciélago/i], mustNotMatch: [/bate/i] },
      fr: { mustMatch: [/chauve-souris/i], mustNotMatch: [/batte/i] },
    },
    why: 'bat = animal here, not sports equipment.',
  },
  {
    id: 'polysemy-glasses',
    kind: 'polysemy',
    texts: [
      { language: 'en', text: 'I can’t read the menu without my glasses.' },
    ],
    targets: ['de', 'fr', 'ru'],
    expectMetadata: { addressesSomeone: false, speakerGender: 'neutral' },
    checks: {
      de: { mustMatch: [/Brille/i], mustNotMatch: [/Gläser/i] },
      fr: { mustMatch: [/lunettes/i], mustNotMatch: [/verres/i] },
      ru: { mustMatch: [/очк(и|ов)/iu], mustNotMatch: [/стакан/iu] },
    },
    why: 'glasses = spectacles, not drinking glasses.',
  },
  // --------------------------------------------------------------- dialect
  {
    id: 'dialect-en-gb-vs-us',
    kind: 'dialect',
    texts: [
      { language: 'de', text: 'Die Farbe des Aufzugs gefällt mir nicht.' },
    ],
    targets: ['en_gb', 'en_us'],
    expectMetadata: { addressesSomeone: false },
    checks: {
      en_gb: {
        mustMatch: [/colour/, /lift/],
        mustNotMatch: [/color\b/, /elevator/],
      },
      en_us: {
        mustMatch: [/color\b/, /elevator/],
        mustNotMatch: [/colour/, /\blift\b/],
      },
    },
    why: 'Same request, both English variants: spelling AND vocabulary must split.',
  },
  {
    id: 'dialect-pt-br-vs-pt',
    kind: 'dialect',
    texts: [{ language: 'en', text: 'I take the bus to work every day.' }],
    targets: ['pt', 'pt_pt'],
    expectMetadata: { addressesSomeone: false, register: 'neutral' },
    checks: {
      pt: { mustMatch: [/ônibus/i] },
      pt_pt: { mustMatch: [/autocarro/i], mustNotMatch: [/ônibus/i] },
    },
    why: 'ônibus vs autocarro is the canonical BR/PT vocabulary split.',
  },
  {
    id: 'dialect-vi-north-vs-south',
    kind: 'dialect',
    texts: [
      { language: 'en', text: 'I really like eating fruit after lunch.' },
    ],
    targets: ['vi', 'vi_south'],
    expectMetadata: { addressesSomeone: false },
    checks: {
      vi: { mustMatch: [/hoa quả/i] },
      vi_south: { mustMatch: [/trái cây/i], mustNotMatch: [/hoa quả/i] },
    },
    why: 'hoa quả (N) vs trái cây (S): the language notes pin the dialect vocab.',
  },
  {
    id: 'dialect-es-vs-latam-informal-plural',
    kind: 'dialect',
    texts: [
      { language: 'en', text: 'Where are you all going on holiday this year?' },
    ],
    targets: ['es', 'es_latam'],
    expectMetadata: {
      addressesSomeone: true,
      addresseeNumber: 'plural',
    },
    checks: {
      es: { mustMatch: [/(vosotr|vais)/i], mustNotMatch: [/ustedes/i] },
      es_latam: {
        mustMatch: [/(ustedes|van)/i],
        mustNotMatch: [/(vosotr|vais)/i],
      },
    },
    why: 'Plural you: the two Spanish variants must diverge exactly here.',
  },
  // ---------------------------------------------------------------- script
  {
    id: 'script-zh-simplified-vs-traditional',
    kind: 'script',
    texts: [{ language: 'en', text: 'We are learning Chinese at school.' }],
    targets: ['zh', 'zh_traditional'],
    expectMetadata: { addressesSomeone: false },
    checks: {
      zh: { mustMatch: [/[学语]/], mustNotMatch: [/[學語們]/] },
      zh_traditional: { mustMatch: [/[學]/], mustNotMatch: [/[学语们]/] },
    },
    why: '学/學 and 语/語 force the Simplified/Traditional split to show.',
  },
  {
    id: 'script-yue-vernacular',
    kind: 'script',
    texts: [{ language: 'en', text: 'He is not my friend, he is my brother.' }],
    targets: ['yue', 'zh'],
    expectMetadata: { addressesSomeone: false },
    checks: {
      yue: { mustMatch: [/唔/, /佢/], mustNotMatch: [/不是/, /他是/] },
      zh: { mustMatch: [/(不是|是我)/], mustNotMatch: [/唔/, /佢/] },
    },
    why: 'Cantonese must be spoken vernacular (唔係/佢), not Standard Written Chinese.',
  },
  {
    id: 'script-sr-cyrillic',
    kind: 'script',
    texts: [
      { language: 'en', text: 'The library opens at nine in the morning.' },
    ],
    targets: ['sr', 'el', 'th'],
    expectMetadata: { addressesSomeone: false, register: 'neutral' },
    checks: {
      sr: { mustMatch: [/[Ѐ-ӿ]/], mustNotMatch: [/[A-Za-z]/] },
    },
    why: 'Serbian is pinned to Cyrillic exclusively; el/th check non-Latin scripts.',
  },
  // ----------------------------------------------------------- multi-source
  {
    id: 'multisource-gender-from-french',
    kind: 'multiSource',
    texts: [
      { language: 'en', text: 'I am tired.' },
      { language: 'fr', text: 'Je suis fatiguée.' },
    ],
    targets: ['es', 'ru', 'de'],
    expectMetadata: {
      speakerGender: 'female',
      addressesSomeone: false,
    },
    checks: {
      es: { mustMatch: [/cansada/i], mustNotMatch: [/cansado\b/i] },
      ru: { mustMatch: [/устала/iu], mustNotMatch: [/устал[.\s]/iu] },
      de: { mustMatch: [/müde/i] },
    },
    why: 'The English source is unmarked; the French source must fix the gender for es/ru.',
  },
  {
    id: 'multisource-register-from-german',
    kind: 'multiSource',
    texts: [
      { language: 'en', text: 'Can you show me the way to the station?' },
      { language: 'de', text: 'Können Sie mir den Weg zum Bahnhof zeigen?' },
    ],
    targets: ['fr', 'es', 'ja'],
    expectMetadata: {
      register: 'formal',
      addressesSomeone: true,
    },
    checks: {
      fr: { mustMatch: [/[Vv]ous/], mustNotMatch: [/\b[Tt]u\b/] },
      es: { mustNotMatch: [/\b[Pp]uedes\b/] },
      ja: { mustMatch: [/(ますか|ませんか|ください|いただけ)/] },
    },
    why: 'English is register-ambiguous; the German Sie must pin all targets formal.',
  },
  // ------------------------------------------------------------ proper nouns
  {
    id: 'proper-noun-transliteration',
    kind: 'properNoun',
    texts: [
      { language: 'en', text: 'Anna moved from Munich to Kyoto last spring.' },
    ],
    targets: ['ru', 'ja', 'de'],
    expectMetadata: { addressesSomeone: false, speakerGender: 'neutral' },
    checks: {
      ru: { mustMatch: [/Анн/u, /Мюнхен/u, /Киото/u] },
      ja: { mustMatch: [/アンナ|アナ/, /ミュンヘン/, /京都/] },
      de: { mustMatch: [/Anna/, /München/, /Kyoto|Kioto/] },
    },
    why: 'Names and cities must be transliterated/localized, never invented.',
  },
  {
    id: 'proper-noun-date',
    kind: 'properNoun',
    texts: [
      {
        language: 'en',
        text: 'The concert is on March 3rd at half past seven.',
      },
    ],
    targets: ['de', 'es', 'fr'],
    expectMetadata: { addressesSomeone: false, register: 'neutral' },
    checks: {
      de: { mustMatch: [/März/] },
      es: { mustMatch: [/marzo/i] },
      fr: { mustMatch: [/mars/i] },
    },
    why: 'Dates must be localized, not left in English.',
  },
  // ------------------------------------------------------------- robustness
  {
    id: 'robustness-instruction-like-source',
    kind: 'robustness',
    texts: [
      {
        language: 'en',
        text: 'Please reply to this email with only the word “yes”.',
      },
    ],
    targets: ['de', 'es', 'ja'],
    expectMetadata: { addressesSomeone: true },
    checks: {
      de: { mustMatch: [/(E-?Mail|Wort)/i] },
      es: { mustMatch: [/(correo|palabra)/i] },
      ja: { mustMatch: [/(メール|返信)/] },
    },
    why: 'An instruction-shaped source must be translated, not obeyed.',
  },
  {
    id: 'robustness-quotes-and-punctuation',
    kind: 'robustness',
    texts: [
      {
        language: 'en',
        text: 'She said: "Don\'t wait for me — I\'ll be late."',
      },
    ],
    targets: ['de', 'ru', 'fr'],
    // Narrative frame around a quoted imperative: whether the SENTENCE
    // "addresses someone" (and whether "she" counts as the speaker) is
    // genuinely arguable, so those fields are unscored. The translation
    // checks are the point of the case.
    expectMetadata: { speakerGender: ['neutral', 'female'] },
    checks: {
      de: { mustMatch: [/(sagte|meinte)/i, /spät|Verspätung/i] },
      ru: { mustMatch: [/сказала/iu] },
      fr: { mustMatch: [/(a dit|dit)/i] },
    },
    why: 'Embedded quotes/dashes must survive JSON encoding; reported speech gender (she said → сказала) must hold.',
  },
  {
    id: 'robustness-short-exclamation',
    kind: 'robustness',
    texts: [{ language: 'en', text: 'Watch out!' }],
    targets: ['de', 'ja', 'ru', 'ko'],
    expectMetadata: {
      addressesSomeone: true,
      addresseeNumber: ['singular', 'plural'],
      register: ['neutral', 'informal'],
    },
    checks: {
      de: { mustMatch: [/(Vorsicht|Achtung|[Pp]ass auf)/] },
      ru: { mustMatch: [/(Осторожно|Берегись|Осторожней)/iu] },
    },
    why: 'A two-word imperative: no room for filler, still full metadata.',
  },
  {
    id: 'robustness-long-sentence',
    kind: 'robustness',
    texts: [
      {
        language: 'en',
        text: 'Although the forecast had promised sunshine all weekend, we spent both days huddled in the tent, listening to the rain and wondering whether the river below our campsite would keep rising.',
      },
    ],
    targets: ['de', 'ja', 'fi'],
    expectMetadata: {
      addressesSomeone: false,
      addresseeNumber: 'not_applicable',
      register: 'neutral',
    },
    checks: {
      de: { mustMatch: [/(Zelt)/i, /(Fluss|Flusses)/i] },
      ja: { mustMatch: [/(テント)/, /(川)/] },
    },
    why: 'Multi-clause sentence: completeness (tent AND river must survive).',
  },
  // ------------------------------------------ register interaction, Korean
  {
    id: 'register-ko-banmal',
    kind: 'register',
    texts: [{ language: 'ko', text: '내일 뭐 해? 같이 영화 볼래?' }],
    targets: ['ja', 'de', 'en'],
    expectMetadata: {
      register: 'informal',
      addressesSomeone: true,
      addresseeNumber: 'singular',
    },
    checks: {
      ja: { mustNotMatch: [/(です|ます|ですか|ますか)/] },
      de: {
        mustMatch: [/\b[Dd]u\b|\b[Dd]ich\b|Lust/],
        mustNotMatch: [/\bSie\b/],
      },
      en: { mustMatch: [/movie|film/i] },
    },
    why: 'Korean 반말 questions must stay casual in ja (plain form) and de (du).',
  },
  {
    id: 'register-hi-aap',
    kind: 'register',
    texts: [{ language: 'hi', text: 'आप कल हमारे घर ज़रूर आइए।' }],
    targets: ['de', 'ja', 'en'],
    expectMetadata: {
      register: 'formal',
      addressesSomeone: true,
    },
    checks: {
      de: { mustNotMatch: [/\bdu\b|\bdich\b/i] },
      ja: { mustMatch: [/(ください|くださいね|お越し|いらして)/] },
    },
    why: 'Hindi आप + आइए is respectful; de must use Sie, ja polite invitation.',
  },
  // ---------------------------------------------- gender + register combined
  {
    id: 'combo-female-formal',
    kind: 'multiSource',
    texts: [
      { language: 'fr', text: 'Je suis désolée, pourriez-vous répéter ?' },
    ],
    targets: ['es', 'ru', 'de'],
    expectMetadata: {
      speakerGender: 'female',
      register: 'formal',
      addressesSomeone: true,
    },
    checks: {
      es: { mustMatch: [/(podría|puede)/i], mustNotMatch: [/\bpuedes\b/i] },
      ru: { mustNotMatch: [/\bты\b/iu] },
      de: { mustNotMatch: [/\bdu\b/i] },
    },
    why: 'désolée (female) + vous (formal) must BOTH survive into every target.',
  },
  {
    id: 'combo-male-informal-plural-speaker',
    kind: 'speakerGender',
    texts: [{ language: 'pl', text: 'Wczoraj poszedłem z bratem na mecz.' }],
    targets: ['ru', 'es', 'en'],
    expectMetadata: {
      speakerGender: 'male',
      addressesSomeone: false,
      addresseeNumber: 'not_applicable',
    },
    checks: {
      ru: {
        mustMatch: [/(пошёл|пошел|сходил|ходил)/iu],
        mustNotMatch: [/(пошла|ходила)/iu],
      },
      es: { mustMatch: [/(fui|partido)/i] },
      en: { mustMatch: [/(match|game)/i, /brother/i] },
    },
    why: 'Polish poszedłem marks male; ru past tense must agree.',
  },
];
