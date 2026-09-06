/**
 * Politeness forms and first-person (speaker gender) marking per language.
 *
 * Two per-course settings steer generated renderings:
 *   - `politenessLevels`: a SET of the three global levels below. Each
 *     language maps the levels onto its own forms (`POLITENESS_CONFIG`); a
 *     two-form language points two levels at the same form, so a set like
 *     {casual, polite} on German is a single form (du) and never alternates.
 *   - `firstPersonForms`: masculine / feminine / both. Which languages change
 *     wording with the speaker's gender is `FIRST_PERSON_CONFIG`; every
 *     language follows the choice for the VOICE (one gender per card).
 *
 * The `Language` entries in lib/languages.ts carry only the flags
 * (`politenessMarking`, `firstPersonMarking`); the copy, examples and prompt
 * text live here so the catalogue stays readable. tests/unit/lib/
 * languageForms.test.ts asserts the two agree. Adding a language: see
 * docs/agents/adding-a-language.md.
 *
 * Copy was drafted for learners and fact-checked against reference grammars
 * on 2026-09-06; each entry lists its sources.
 */

import {
  getLanguageByCode,
  type Language,
  type PolitenessMarking,
} from './languages';

export type { PolitenessMarking };

// ------------------------------------------------------------------ types

/** The three global levels. 'polite' is the "always OK" register. */
export const POLITENESS_LEVELS = ['casual', 'polite', 'formal'] as const;
export type PolitenessLevel = (typeof POLITENESS_LEVELS)[number];

export type PolitenessForm = {
  /** Stable per-language id, part of a rendering's `variantKey`. */
  id: string;
  /** Row label, e.g. "Polite · です・ます" or "du-form · everyday". */
  label: string;
  /** Who you use it with, one line. */
  description: string;
  /** The config's `exampleEn` rendered in this form. */
  example: string;
  /** Instruction for the translation model. */
  prompt: string;
};

export type PolitenessConfig = {
  marking: PolitenessMarking;
  /** One line under the step title. */
  intro: string;
  /** The English sentence every form's `example` renders. */
  exampleEn: string;
  /** Level -> form. Levels sharing a form reference the same object. */
  forms: Record<PolitenessLevel, PolitenessForm>;
  /** Summary shown when several distinct forms are selected. */
  mixedSummary: string;
  /**
   * Form used for the shared (no-preference) rendering when the text's own
   * register metadata is empty or neutral. Only predicate and particle
   * languages need one: for address languages a sentence without a "you"
   * renders the same at every level.
   */
  defaultLevel?: PolitenessLevel;
  sources: string[];
};

export type FirstPersonConfig = {
  /** One line under the step title. */
  intro: string;
  exampleEn: string;
  masculine: string;
  feminine: string;
  /** Extra caveat shown under the example. */
  note?: string;
  sources: string[];
};

// -------------------------------------------------------------- builders

/**
 * A two-form language. `split` says where the boundary sits: 'familiar'
 * renders levels 1 and 2 as the low form (German du at "polite"), 'distance'
 * renders levels 2 and 3 as the high form (French vous at "polite").
 */
function twoForm(spec: {
  marking: PolitenessMarking;
  split: 'familiar' | 'distance';
  intro: string;
  exampleEn: string;
  low: PolitenessForm;
  high: PolitenessForm;
  mixedSummary: string;
  defaultLevel?: PolitenessLevel;
  sources: string[];
}): PolitenessConfig {
  const { low, high } = spec;
  return {
    marking: spec.marking,
    intro: spec.intro,
    exampleEn: spec.exampleEn,
    forms:
      spec.split === 'familiar'
        ? { casual: low, polite: low, formal: high }
        : { casual: low, polite: high, formal: high },
    mixedSummary: spec.mixedSummary,
    defaultLevel: spec.defaultLevel,
    sources: spec.sources,
  };
}

function threeForm(spec: {
  marking: PolitenessMarking;
  intro: string;
  exampleEn: string;
  casual: PolitenessForm;
  polite: PolitenessForm;
  formal: PolitenessForm;
  mixedSummary: string;
  defaultLevel?: PolitenessLevel;
  sources: string[];
}): PolitenessConfig {
  return {
    marking: spec.marking,
    intro: spec.intro,
    exampleEn: spec.exampleEn,
    forms: { casual: spec.casual, polite: spec.polite, formal: spec.formal },
    mixedSummary: spec.mixedSummary,
    defaultLevel: spec.defaultLevel,
    sources: spec.sources,
  };
}

/** A T-V language: T at level 1, V from level 2 (the common case). */
function tv(spec: {
  intro: string;
  exampleEn: string;
  t: { name: string; description: string; example: string; prompt: string };
  v: { name: string; description: string; example: string; prompt: string };
  split?: 'familiar' | 'distance';
  sources: string[];
}): PolitenessConfig {
  const familiar = spec.split === 'familiar';
  return twoForm({
    marking: 'address',
    split: spec.split ?? 'distance',
    intro: spec.intro,
    exampleEn: spec.exampleEn,
    low: {
      id: 't',
      label: familiar
        ? `${spec.t.name}-form · everyday`
        : `Casual · ${spec.t.name}`,
      description: spec.t.description,
      example: spec.t.example,
      prompt: spec.t.prompt,
    },
    high: {
      id: 'v',
      label: familiar
        ? `${spec.v.name}-form · formal`
        : `Polite · ${spec.v.name}`,
      description: spec.v.description,
      example: spec.v.example,
      prompt: spec.v.prompt,
    },
    mixedSummary: `Sentences alternate between ${spec.t.name} and ${spec.v.name} where a "you" appears.`,
    sources: spec.sources,
  });
}

const TV_WIKI = 'https://en.wikipedia.org/wiki/T%E2%80%93V_distinction';

// ------------------------------------------------------- politeness config

export const POLITENESS_CONFIG: Record<string, PolitenessConfig> = {
  ja: threeForm({
    marking: 'predicate',
    intro:
      'Japanese uses plain form with friends, です・ます with most people, and keigo with customers and superiors.',
    exampleEn: 'I eat.',
    casual: {
      id: 'plain',
      label: 'Casual · plain form',
      description: 'Close friends, family, people younger than you',
      example: '食べる。',
      prompt:
        'Plain form (だ / dictionary form / た) on every main-clause predicate. Casual but not rough: no おまえ, no 俺; use 君 or the name for "you".',
    },
    polite: {
      id: 'desu-masu',
      label: 'Polite · です・ます',
      description: 'Colleagues, strangers, most everyday situations',
      example: '食べます。',
      prompt:
        'Polite です・ます style on every main-clause predicate; plain form only inside subordinate clauses. No honorific or humble verbs beyond set phrases.',
    },
    formal: {
      id: 'keigo',
      label: 'Formal · keigo',
      description: 'Customers, superiors, formal service and business',
      example: 'いただきます。',
      prompt:
        "Keigo on a です・ます base: 尊敬語 for the listener's or a third party's actions, 謙譲語 for the speaker's own, 丁重語 (ございます, おります, いたします) for neutral statements. Never stack honorifics (no 二重敬語).",
    },
    mixedSummary:
      'Sentences alternate between plain form, です・ます, and keigo.',
    defaultLevel: 'polite',
    sources: [
      'https://en.wikipedia.org/wiki/Honorific_speech_in_Japanese',
      'https://human.libretexts.org/Bookshelves/Languages/Japanese/Japanese_Introductory_1_(Hamada)',
    ],
  }),
  ko: threeForm({
    marking: 'predicate',
    intro:
      'Korean uses 반말 with close friends, 해요체 with most people, and 합쇼체 in formal or professional settings.',
    exampleEn: 'I eat.',
    casual: {
      id: 'banmal',
      label: 'Casual · 반말',
      description: 'Close friends, family, people younger than you',
      example: '먹어.',
      prompt:
        '반말: 해체 endings (-아/-어) in conversation, 해라체 for narration; 나/우리 for the speaker.',
    },
    polite: {
      id: 'haeyo',
      label: 'Polite · 해요체',
      description: 'Colleagues, shops, most everyday conversations',
      example: '먹어요.',
      prompt:
        '해요체: -아요/-어요 endings on every sentence; 저/저희 for the speaker; honorific -시- and honorific vocabulary (계시다, 드리다, 말씀) whenever the subject deserves them.',
    },
    formal: {
      id: 'hapsyo',
      label: 'Formal · 합쇼체',
      description: 'Presentations, customers, news, business settings',
      example: '먹습니다.',
      prompt:
        '합쇼체: -습니다/-ㅂ니다 statements, -습니까 questions, -십시오 requests; 저/저희 for the speaker; honorific -시- and honorific vocabulary whenever the subject deserves them.',
    },
    mixedSummary: 'Sentences alternate between 반말, 해요체, and 합쇼체.',
    defaultLevel: 'polite',
    sources: [
      'https://en.wikipedia.org/wiki/Korean_speech_levels',
      'https://en.wikipedia.org/wiki/Korean_honorifics',
    ],
  }),
  th: twoForm({
    marking: 'particle',
    split: 'distance',
    intro:
      'Thai adds ครับ or ค่ะ to the end of sentences to be polite, and drops it with close friends.',
    exampleEn: 'Thank you.',
    low: {
      id: 'plain',
      label: 'Casual · no particle',
      description: 'Close friends, family, children',
      example: 'ขอบคุณ',
      prompt:
        'No politeness particle. First person ฉัน or เรา, second person เธอ or the name. Colloquial but never vulgar (no กู/มึง).',
    },
    high: {
      id: 'particle',
      label: 'Polite · ครับ / ค่ะ',
      description: 'Everyone else; ครับ if you are male, ค่ะ if female',
      example: 'ขอบคุณครับ / ขอบคุณค่ะ',
      prompt:
        "End every sentence with the polite particle for the speaker's gender: ครับ for a man; ค่ะ for a woman in statements, คะ in questions. First person ผม (man) or ดิฉัน / ฉัน (woman), second person คุณ.",
    },
    mixedSummary: 'Sentences alternate between with and without ครับ/ค่ะ.',
    defaultLevel: 'polite',
    sources: [
      'https://thai-notes.com/notes/particles.html',
      'https://studythai.ai/blog/polite-particles',
    ],
  }),
  fil: twoForm({
    marking: 'particle',
    split: 'distance',
    intro:
      'Filipino adds po and uses kayo instead of ka with elders, strangers, and anyone you show respect to.',
    exampleEn: 'Where are you going?',
    low: {
      id: 'plain',
      label: 'Casual · no po',
      description: 'Friends, siblings, people your age or younger',
      example: 'Saan ka pupunta?',
      prompt: 'No po/opo; ikaw/ka/mo for the listener.',
    },
    high: {
      id: 'po',
      label: 'Polite · po + kayo',
      description: 'Parents, elders, strangers, customers, bosses',
      example: 'Saan po kayo pupunta?',
      prompt:
        'Add po as a second-position enclitic (opo for yes) and address the listener as kayo/ninyo/inyo. In statements with no listener, add po where natural in dialogue.',
    },
    mixedSummary: 'Sentences alternate between plain ka and po with kayo.',
    sources: ['https://en.wikipedia.org/wiki/Tagalog_grammar'],
  }),
  vi: twoForm({
    marking: 'pronoun',
    split: 'distance',
    intro:
      'Vietnamese picks pronouns by age and relationship: tớ/cậu or mình/bạn with friends, anh/chị/em plus ạ with everyone else.',
    exampleEn: 'Thank you.',
    low: {
      id: 'peer',
      label: 'Casual · tớ/cậu, mình/bạn',
      description: 'Friends and peers your own age',
      example: 'Cảm ơn.',
      prompt:
        'Peer pronouns: tớ/cậu or mình/bạn, no sentence-final ạ. Never mày/tao.',
    },
    high: {
      id: 'respectful',
      label: 'Polite · anh/chị/em + ạ',
      description: 'Older people, colleagues, strangers, service staff',
      example: 'Cảm ơn ạ.',
      prompt:
        'Kinship pronouns by relative age (anh/chị for an older listener, em for a younger one; tôi/bạn when the relationship is unknown) and sentence-final ạ (dạ for yes) toward an older or unfamiliar listener.',
    },
    mixedSummary:
      'Sentences alternate between friendly pronouns and anh/chị/em with ạ.',
    sources: [
      'https://en.wikibooks.org/wiki/Vietnamese/Personal_pronouns',
      'https://vietnameselab.com/blog/vietnamese-particles',
    ],
  }),
  id: twoForm({
    marking: 'pronoun',
    split: 'distance',
    intro:
      'Indonesian uses aku and kamu with friends, and saya with Bapak, Ibu, Mas, or Mbak instead of "you" with everyone else.',
    exampleEn: 'Where are you going?',
    low: {
      id: 'aku-kamu',
      label: 'Casual · aku / kamu',
      description: 'Friends, family, people your age',
      example: 'Kamu mau ke mana?',
      prompt:
        'aku for I, kamu for you; relaxed but standard spelling (tidak, not nggak).',
    },
    high: {
      id: 'saya',
      label: 'Polite · saya + Bapak / Ibu',
      description: 'Older people, strangers, colleagues, service staff',
      example: 'Anda mau ke mana?',
      prompt:
        'saya for I; address the listener as Bapak/Ibu (Mas/Mbak for younger adults) or Anda, never kamu or aku.',
    },
    mixedSummary:
      'Sentences alternate between aku/kamu and saya with Bapak/Ibu where a "you" appears.',
    sources: [
      'https://en.wikibooks.org/wiki/Indonesian/Lessons/Formal_speech',
      'https://ielanguages.com/indonesian-address.html',
    ],
  }),
  ms: twoForm({
    marking: 'pronoun',
    split: 'distance',
    intro:
      'Malay uses aku and kau between close friends, and saya with awak, Encik or Puan with everyone else.',
    exampleEn: 'Where are you going?',
    low: {
      id: 'aku-kau',
      label: 'Casual · aku / kau',
      description: 'Close friends, classmates',
      example: 'Kau nak pergi mana?',
      prompt: 'aku for I, kau for you; colloquial but standard spelling.',
    },
    high: {
      id: 'saya',
      label: 'Polite · saya + awak / Encik / Puan',
      description: 'Strangers, elders, officials, customers',
      example: 'Awak nak pergi mana?',
      prompt:
        'saya for I; awak for a peer or the title Encik/Puan (Cik for a young woman) for a stranger or elder; never aku or kau.',
    },
    mixedSummary:
      'Sentences alternate between aku/kau and saya with awak or a title where a "you" appears.',
    sources: [
      'https://ilearnmalay.blogspot.com/2020/02/pronouns-in-malay-language.html',
    ],
  }),
  hi: tv({
    intro:
      'Hindi uses तुम with friends and family and आप with elders, strangers, and anyone you want to show respect.',
    exampleEn: 'What is your name?',
    t: {
      name: 'तुम',
      description: 'Friends, siblings, younger people',
      example: 'तुम्हारा नाम क्या है?',
      prompt: 'तुम with its verb forms (करो, हो); never तू.',
    },
    v: {
      name: 'आप',
      description: 'Elders, strangers, colleagues, shopkeepers',
      example: 'आपका नाम क्या है?',
      prompt:
        'आप with plural agreement (हैं, कीजिए) and honorific plural for respected third persons (वे हैं).',
    },
    sources: [
      'https://en.wikibooks.org/wiki/Hindi/Verbs',
      'https://hello-hindi.com/lesson-3-what-is-your-name-hello-hindi-learning-series/',
    ],
  }),
  bn: tv({
    intro:
      "Bengali uses তুমি with friends and family and আপনি with elders, strangers, and people you don't know well.",
    exampleEn: 'Are you coming?',
    t: {
      name: 'তুমি',
      description: 'Friends, family, people your age or younger',
      example: 'তুমি আসছ?',
      prompt: 'তুমি with its verb forms (করো, আছো); never তুই.',
    },
    v: {
      name: 'আপনি',
      description: 'Elders, strangers, colleagues, shopkeepers',
      example: 'আপনি আসছেন?',
      prompt:
        'আপনি with its verb forms (করেন, আছেন); honorific তিনি/উনি for respected third persons. Stay in চলিত ভাষা.',
    },
    sources: ['https://en.wikipedia.org/wiki/Bengali_grammar'],
  }),
  ta: tv({
    intro:
      'Tamil uses நீ with close friends and younger people and நீங்கள் with everyone else, including most adults you meet.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'நீ',
      description: 'Close friends, children, younger family',
      example: 'நீ வருகிறாயா?',
      prompt: 'நீ with second-person singular verb forms.',
    },
    v: {
      name: 'நீங்கள்',
      description: 'Elders, strangers, colleagues, most adults',
      example: 'நீங்கள் வருகிறீர்களா?',
      prompt:
        'நீங்கள் with plural verb forms; honorific third person (அவர்) for respected people.',
    },
    sources: [
      'https://en.wiktionary.org/wiki/வா',
      'https://tamilcourse.uchicago.edu/node/122',
    ],
  }),
  te: tv({
    intro:
      'Telugu uses నువ్వు with friends and younger people and మీరు with elders, strangers, and anyone you respect.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'నువ్వు',
      description: 'Friends, children, younger family',
      example: 'నువ్వు వస్తున్నావా?',
      prompt: 'నువ్వు with second-person singular verb forms.',
    },
    v: {
      name: 'మీరు',
      description: 'Elders, strangers, colleagues, most adults',
      example: 'మీరు వస్తున్నారా?',
      prompt:
        'మీరు with plural verb forms; -గారు on names and honorific third person (ఆయన/ఆవిడ) for respected people.',
    },
    sources: [TV_WIKI],
  }),
  pt_pt: twoForm({
    marking: 'address',
    split: 'distance',
    intro:
      'European Portuguese uses tu with friends and family; with everyone else it drops the pronoun or says o senhor / a senhora.',
    exampleEn: 'Do you want a coffee?',
    low: {
      id: 't',
      label: 'Casual · tu',
      description: 'Friends, family, colleagues you know well',
      example: 'Queres um café?',
      prompt: 'tu with second-person singular verb forms and te/teu.',
    },
    high: {
      id: 'v',
      label: 'Polite · o senhor / a senhora',
      description: 'Strangers, older people, customers, staff',
      example: 'Quer um café?',
      prompt:
        'Third-person singular verb with the subject dropped ("Quer um café?"); o senhor / a senhora only when the subject must be explicit. Never você.',
    },
    mixedSummary:
      'Sentences alternate between tu and the polite form where a "you" appears.',
    sources: [
      'https://elon.io/grammar/portuguese-portugal/register/tu-voce-o-senhor',
    ],
  }),
  de: tv({
    split: 'familiar',
    intro:
      'German uses du with friends, family, and young people, and Sie with strangers and in formal or professional settings.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'du',
      description: 'Friends, family, children, students, most colleagues',
      example: 'Kommst du?',
      prompt:
        'du (dich, dir, dein) with second-person singular verb forms; ihr for several people; informal greetings (Hallo, Tschüss).',
    },
    v: {
      name: 'Sie',
      description:
        "Strangers, customers, officials, older people you don't know",
      example: 'Kommen Sie?',
      prompt:
        'Sie (Ihnen, Ihr, capitalised) with third-person plural verb forms; formal greetings (Guten Tag, Auf Wiedersehen).',
    },
    sources: [TV_WIKI],
  }),
  es: tv({
    split: 'familiar',
    intro:
      'Spanish in Spain uses tú with almost everyone and usted mainly with elderly people, officials, and in formal service.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'tú',
      description:
        'Almost everyone: friends, colleagues, shop staff, strangers',
      example: '¿Vienes?',
      prompt:
        'tú with second-person singular verb forms; vosotros for several people.',
    },
    v: {
      name: 'usted',
      description: 'Elderly people, officials, formal customer service',
      example: '¿Viene usted?',
      prompt:
        'usted with third-person singular verb forms; ustedes for several people.',
    },
    sources: [TV_WIKI],
  }),
  ca: tv({
    split: 'familiar',
    intro:
      'Catalan uses tu with nearly everyone and vostè with older strangers, officials, and in formal service settings.',
    exampleEn: 'Do you want a coffee?',
    t: {
      name: 'tu',
      description: 'Nearly everyone: friends, colleagues, shop staff',
      example: 'Vols un cafè?',
      prompt: 'tu with second-person singular verb forms.',
    },
    v: {
      name: 'vostè',
      description: 'Older strangers, officials, formal service',
      example: 'Vol un cafè?',
      prompt:
        'vostè with third-person singular verb forms; vostès for several people.',
    },
    sources: [TV_WIKI],
  }),
  nl: tv({
    split: 'familiar',
    intro:
      'Dutch uses je with most people and u with older strangers, customers, and in formal letters and service.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'je',
      description: 'Friends, family, colleagues, most people your age',
      example: 'Kom je?',
      prompt: 'je/jij (jou, jouw) with second-person singular verb forms.',
    },
    v: {
      name: 'u',
      description: 'Older strangers, customers, officials, formal letters',
      example: 'Komt u?',
      prompt: 'u (uw) with its verb forms (u hebt / u heeft).',
    },
    sources: [TV_WIKI],
  }),
  pt: tv({
    split: 'familiar',
    intro:
      'Brazilian Portuguese uses você with almost everyone and o senhor / a senhora with older people and in formal service.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'você',
      description: 'Almost everyone, including colleagues and strangers',
      example: 'Você vem?',
      prompt: 'você with third-person singular verb forms; never tu.',
    },
    v: {
      name: 'o senhor / a senhora',
      description: 'Older people, authorities, formal customer service',
      example: 'O senhor vem?',
      prompt:
        'o senhor / a senhora as the address noun with third-person singular verb forms.',
    },
    sources: [TV_WIKI],
  }),
  zh: tv({
    split: 'familiar',
    intro:
      'Mandarin uses 你 with almost everyone and 您 with elders, customers, and in formal or business settings.',
    exampleEn: 'Are you coming?',
    t: {
      name: '你',
      description: 'Almost everyone: friends, colleagues, shop staff',
      example: '你来吗？',
      prompt: '你 for the listener.',
    },
    v: {
      name: '您',
      description: 'Elders, customers, officials, business contacts',
      example: '您来吗？',
      prompt:
        '您 for the listener with polite lexis (请问, 麻烦您); 各位 or 您二位 for several people, never 您们.',
    },
    sources: [TV_WIKI],
  }),
  zh_traditional: tv({
    split: 'familiar',
    intro:
      'Taiwanese Mandarin uses 你 with almost everyone; 您 appears mainly in customer service, business, and formal writing.',
    exampleEn: 'Are you coming?',
    t: {
      name: '你',
      description: 'Almost everyone: friends, colleagues, shop staff',
      example: '你來嗎？',
      prompt: '你 for the listener.',
    },
    v: {
      name: '您',
      description: 'Customers, elders, business and formal writing',
      example: '您來嗎？',
      prompt:
        '您 for the listener with polite lexis (請問, 麻煩您); never 您們.',
    },
    sources: [TV_WIKI],
  }),
  it: tv({
    intro:
      'Italian uses tu with friends, family, and young people, and Lei with strangers, shop staff, and older people.',
    exampleEn: 'Do you want a coffee?',
    t: {
      name: 'tu',
      description: 'Friends, family, young people, close colleagues',
      example: 'Vuoi un caffè?',
      prompt:
        'tu with second-person singular verb forms; voi for several people.',
    },
    v: {
      name: 'Lei',
      description: 'Strangers, shop staff, older people, officials',
      example: 'Vuole un caffè?',
      prompt:
        'Lei (La, Le, capitalised) with third-person singular verb forms; voi for several people.',
    },
    sources: [TV_WIKI],
  }),
  el: tv({
    intro:
      'Greek uses εσύ with friends and people your age, and εσείς with older strangers, officials, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'εσύ',
      description: 'Friends, family, people your age',
      example: 'Έρχεσαι;',
      prompt: 'εσύ with second-person singular verb forms.',
    },
    v: {
      name: 'εσείς',
      description: 'Older strangers, officials, shops, offices',
      example: 'Έρχεστε;',
      prompt:
        'εσείς with second-person plural verb forms; adjectives and participles stay singular for one listener (Είστε κουρασμένος;).',
    },
    sources: [TV_WIKI],
  }),
  tr: tv({
    intro:
      'Turkish uses sen with friends and family and siz with strangers, elders, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'sen',
      description: 'Friends, family, people your age',
      example: 'Geliyor musun?',
      prompt:
        'sen with second-person singular suffixes (-sin, imperative gel).',
    },
    v: {
      name: 'siz',
      description: 'Strangers, elders, colleagues, shops, offices',
      example: 'Geliyor musunuz?',
      prompt:
        'siz with second-person plural suffixes (-siniz, imperative gelin); Bey/Hanım after names.',
    },
    sources: [TV_WIKI],
  }),
  hr: tv({
    intro:
      'Croatian uses ti with friends, family, and peers, and Vi with strangers, elders, and in professional settings.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'ti',
      description: 'Friends, family, peers, younger people',
      example: 'Dolaziš?',
      prompt: 'ti with second-person singular verb forms.',
    },
    v: {
      name: 'Vi',
      description: 'Strangers, elders, officials, work contacts',
      example: 'Dolazite?',
      prompt:
        'Vi (capitalised) with second-person plural verb forms; participles and adjectives stay singular for one listener.',
    },
    sources: [TV_WIKI],
  }),
  sr: tv({
    intro:
      'Serbian uses ти with friends, family, and peers, and Ви with strangers, elders, and in professional settings.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'ти',
      description: 'Friends, family, peers, younger people',
      example: 'Долазиш?',
      prompt: 'ти with second-person singular verb forms.',
    },
    v: {
      name: 'Ви',
      description: 'Strangers, elders, officials, work contacts',
      example: 'Долазите?',
      prompt:
        'Ви (capitalised) with second-person plural verb forms; participles and adjectives stay singular for one listener.',
    },
    sources: [TV_WIKI],
  }),
  sl: tv({
    intro:
      'Slovene uses ti with friends and family and vi with strangers, older people, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'ti',
      description: 'Friends, family, peers, younger people',
      example: 'Prideš?',
      prompt: 'ti with second-person singular verb forms.',
    },
    v: {
      name: 'vi',
      description: 'Strangers, older people, officials, shops',
      example: 'Pridete?',
      prompt:
        'vi with second-person plural verb forms and plural participle (ste prišli), never the colloquial polvikanje.',
    },
    sources: [TV_WIKI],
  }),
  fr: tv({
    intro:
      "French uses tu with friends, family, and children, and vous with strangers, colleagues you don't know well, and in shops.",
    exampleEn: 'Are you coming?',
    t: {
      name: 'tu',
      description: 'Friends, family, children, close colleagues',
      example: 'Tu viens ?',
      prompt: 'tu with second-person singular verb forms.',
    },
    v: {
      name: 'vous',
      description: 'Strangers, shop staff, officials, new colleagues',
      example: 'Vous venez ?',
      prompt:
        'vous with second-person plural verb forms; adjectives and participles stay singular for one listener (vous êtes fatigué).',
    },
    sources: [TV_WIKI],
  }),
  es_latam: tv({
    intro:
      'Latin American Spanish uses tú with friends and family and usted with strangers, elders, and in most service and work settings.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'tú',
      description: 'Friends, family, people your age',
      example: '¿Vienes?',
      prompt:
        'tú with second-person singular verb forms; ustedes for several people.',
    },
    v: {
      name: 'usted',
      description: 'Strangers, elders, customers, officials, colleagues',
      example: '¿Viene usted?',
      prompt:
        'usted with third-person singular verb forms; ustedes for several people.',
    },
    sources: [TV_WIKI],
  }),
  ru: tv({
    intro:
      "Russian uses ты with friends and family and вы with everyone else, including colleagues you don't know well.",
    exampleEn: 'Are you going?',
    t: {
      name: 'ты',
      description: 'Friends, family, children, close colleagues',
      example: 'Ты идёшь?',
      prompt: 'ты with second-person singular verb forms (imperative иди).',
    },
    v: {
      name: 'вы',
      description: 'Strangers, colleagues, officials, older people',
      example: 'Вы идёте?',
      prompt:
        'вы with second-person plural verb forms (вы устали, imperative идите); name and patronymic where a name appears.',
    },
    sources: [TV_WIKI],
  }),
  uk: tv({
    intro:
      "Ukrainian uses ти with friends and family and ви with strangers, elders, and colleagues you don't know well.",
    exampleEn: 'Are you going?',
    t: {
      name: 'ти',
      description: 'Friends, family, children, close colleagues',
      example: 'Ти йдеш?',
      prompt: 'ти with second-person singular verb forms.',
    },
    v: {
      name: 'ви',
      description: 'Strangers, elders, officials, new colleagues',
      example: 'Ви йдете?',
      prompt: 'ви with second-person plural verb forms.',
    },
    sources: [TV_WIKI],
  }),
  pl: tv({
    intro:
      'Polish uses ty with friends and family and pan or pani, with third-person verbs, with everyone else.',
    exampleEn: 'Where do you live?',
    t: {
      name: 'ty',
      description: 'Friends, family, colleagues on first-name terms',
      example: 'Gdzie mieszkasz?',
      prompt: 'ty with second-person singular verb forms.',
    },
    v: {
      name: 'pan / pani',
      description: 'Strangers, older people, officials, shop staff',
      example: 'Gdzie pan mieszka?',
      prompt:
        'pan (to a man) or pani (to a woman) with third-person singular verb forms; państwo for a group. Never wy as a polite form.',
    },
    sources: ['https://go-polish.com/forms-address-polish/'],
  }),
  cs: tv({
    intro:
      "Czech uses ty with friends and family and vy with strangers, colleagues, and anyone you're not on first-name terms with.",
    exampleEn: 'Are you going?',
    t: {
      name: 'ty',
      description: 'Friends, family, children, close colleagues',
      example: 'Jdeš?',
      prompt: 'ty with second-person singular verb forms.',
    },
    v: {
      name: 'vy',
      description: 'Strangers, colleagues, officials, older people',
      example: 'Jdete?',
      prompt:
        'vy with second-person plural auxiliary but singular gendered participle for one listener (vy jste byl / byla).',
    },
    sources: [TV_WIKI],
  }),
  sk: tv({
    intro:
      "Slovak uses ty with friends and family and vy with strangers, colleagues, and anyone you're not on first-name terms with.",
    exampleEn: 'Are you going?',
    t: {
      name: 'ty',
      description: 'Friends, family, children, close colleagues',
      example: 'Ideš?',
      prompt: 'ty with second-person singular verb forms.',
    },
    v: {
      name: 'vy',
      description: 'Strangers, colleagues, officials, older people',
      example: 'Idete?',
      prompt:
        'vy with second-person plural auxiliary but singular gendered participle for one listener (vy ste bol / bola).',
    },
    sources: [TV_WIKI],
  }),
  bg: tv({
    intro:
      'Bulgarian uses ти with friends and family and Вие with strangers, older people, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'ти',
      description: 'Friends, family, children, peers',
      example: 'Идваш ли?',
      prompt: 'ти with second-person singular verb forms.',
    },
    v: {
      name: 'Вие',
      description: 'Strangers, older people, officials, shops',
      example: 'Идвате ли?',
      prompt:
        'Вие (capitalised) with second-person plural verb forms; adjectives stay singular for one listener (Вие сте любезен).',
    },
    sources: [TV_WIKI],
  }),
  ro: tv({
    intro:
      'Romanian uses tu with friends and family and dumneavoastră with strangers, elders, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'tu',
      description: 'Friends, family, children, peers',
      example: 'Vii?',
      prompt: 'tu with second-person singular verb forms.',
    },
    v: {
      name: 'dumneavoastră',
      description: 'Strangers, elders, officials, shops, offices',
      example: 'Veniți?',
      prompt:
        'dumneavoastră with second-person plural verb forms; adjectives stay singular for one listener; polite third person dânsul/dânsa. Never dumneata.',
    },
    sources: [TV_WIKI],
  }),
  hu: tv({
    intro:
      'Hungarian uses te with friends, family, and young people, and ön with strangers, older people, and in shops and offices.',
    exampleEn: 'Where do you live?',
    t: {
      name: 'te',
      description: 'Friends, family, young people, close colleagues',
      example: 'Hol laksz?',
      prompt: 'te with second-person singular verb forms.',
    },
    v: {
      name: 'ön',
      description: 'Strangers, older people, officials, shops',
      example: 'Ön hol lakik?',
      prompt:
        'ön (önök for several) with third-person verb forms and tessék for offers. Never maga.',
    },
    sources: [TV_WIKI],
  }),
  lt: tv({
    intro:
      'Lithuanian uses tu with friends and family and jūs with strangers, older people, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'tu',
      description: 'Friends, family, children, peers',
      example: 'Ar ateini?',
      prompt: 'tu with second-person singular verb forms.',
    },
    v: {
      name: 'jūs',
      description: 'Strangers, older people, officials, shops',
      example: 'Ar ateinate?',
      prompt:
        'jūs with second-person plural verb forms; adjectives and participles stay singular and gendered for one listener (Jūs esate pavargęs / pavargusi).',
    },
    sources: [TV_WIKI],
  }),
  lv: tv({
    intro:
      'Latvian uses tu with friends and family and jūs with strangers, older people, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'tu',
      description: 'Friends, family, children, peers',
      example: 'Vai tu nāc?',
      prompt: 'tu with second-person singular verb forms.',
    },
    v: {
      name: 'jūs',
      description: 'Strangers, older people, officials, shops',
      example: 'Vai jūs nākat?',
      prompt:
        'jūs with second-person plural verb forms; adjectives and participles stay singular and gendered for one listener (Jūs esat noguris / nogurusi).',
    },
    sources: [TV_WIKI],
  }),
  et: tv({
    intro:
      'Estonian uses sina with friends and family and teie with strangers, older people, and in shops and offices.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'sina',
      description: 'Friends, family, children, peers',
      example: 'Kas sa tuled?',
      prompt: 'sina/sa with second-person singular verb forms.',
    },
    v: {
      name: 'teie',
      description: 'Strangers, older people, officials, shops',
      example: 'Kas te tulete?',
      prompt: 'teie/te with second-person plural verb forms.',
    },
    sources: [TV_WIKI],
  }),
  fa: tv({
    intro:
      'Persian uses تو with friends and family and شما with everyone else; many people also use شما with parents.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'تو',
      description: 'Close friends, siblings, children',
      example: 'تو می‌آیی؟',
      prompt: 'تو with second-person singular verb forms.',
    },
    v: {
      name: 'شما',
      description: 'Strangers, elders, colleagues, often parents too',
      example: 'شما می‌آیید؟',
      prompt:
        'شما with second-person plural verb forms; ایشان with plural verb for respected third persons; taarof verbs (بفرمایید) where natural.',
    },
    sources: ['https://en.wikipedia.org/wiki/Persian_grammar'],
  }),
  uz: tv({
    intro:
      'Uzbek uses sen with close friends and younger people and siz with almost everyone else, including parents.',
    exampleEn: 'Are you coming?',
    t: {
      name: 'sen',
      description: 'Close friends, children, younger siblings',
      example: 'Kelasanmi?',
      prompt: 'sen with second-person singular suffixes (imperative kel).',
    },
    v: {
      name: 'siz',
      description: 'Almost everyone else, including parents and elders',
      example: 'Kelasizmi?',
      prompt:
        'siz with second-person plural suffixes (imperative keling); honorific -lar on respected third persons.',
    },
    sources: [TV_WIKI],
  }),
  ar_eg: tv({
    intro:
      'Egyptian Arabic uses إنت / إنتي with friends and family and حضرتك with elders, strangers, and officials.',
    exampleEn: 'Where are you from?',
    t: {
      name: 'إنت',
      description: 'Friends, family, people your age',
      example: 'إنت منين؟',
      prompt:
        'إنت (to a man) / إنتي (to a woman) with second-person verb forms.',
    },
    v: {
      name: 'حضرتك',
      description: 'Elders, strangers, officials, customers',
      example: 'حضرتك منين؟',
      prompt:
        'حضرتك (ḥaḍritak to a man, ḥaḍritik to a woman) as the address word with second-person verb and adjective agreement.',
    },
    sources: [
      'https://en.wiktionary.org/wiki/حضرتك',
      'https://en.wikivoyage.org/wiki/Egyptian_Arabic_phrasebook',
    ],
  }),
};

// Dialects that share their sibling's forms. Northern and Southern
// Vietnamese differ in accent and a few words (dạ, tui), not in the
// pronoun system this setting controls.
POLITENESS_CONFIG.vi_south = POLITENESS_CONFIG.vi;

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
    note: 'With many words (fatigué / fatiguée) the difference is only visible in writing; with others (prêt / prête) you can hear it.',
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
      'Hebrew changes present-tense verbs and adjectives depending on who is speaking.',
    masculine: 'אני עייף.',
    feminine: 'אני עייפה.',
    sources: ['https://en.wikipedia.org/wiki/Modern_Hebrew_grammar'],
  },
  ar: {
    ...TIRED,
    intro: 'Arabic changes verbs and adjectives depending on who is speaking.',
    masculine: 'أنا متعب.',
    feminine: 'أنا متعبة.',
    sources: ['https://en.wikipedia.org/wiki/Arabic_grammar'],
  },
  ar_eg: {
    ...TIRED,
    intro:
      'Egyptian Arabic changes verbs and adjectives depending on who is speaking.',
    masculine: 'أنا تعبان.',
    feminine: 'أنا تعبانة.',
    sources: ['https://en.wikipedia.org/wiki/Egyptian_Arabic'],
  },
  ar_sa: {
    ...TIRED,
    intro:
      'Saudi Arabic changes verbs and adjectives depending on who is speaking.',
    masculine: 'أنا تعبان.',
    feminine: 'أنا تعبانة.',
    sources: ['https://en.wikipedia.org/wiki/Hejazi_Arabic'],
  },
  ar_iq: {
    ...TIRED,
    intro:
      'Iraqi Arabic changes verbs and adjectives depending on who is speaking.',
    masculine: 'آني تعبان.',
    feminine: 'آني تعبانة.',
    sources: ['https://en.wikipedia.org/wiki/Mesopotamian_Arabic'],
  },
  ar_lev: {
    ...TIRED,
    intro:
      'Levantine Arabic changes verbs and adjectives depending on who is speaking.',
    masculine: 'أنا تعبان.',
    feminine: 'أنا تعبانة.',
    sources: ['https://en.wikipedia.org/wiki/Levantine_Arabic'],
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
    note: 'Men often say 僕; 私 is neutral and safe for anyone. Speaker gender shows mostly in casual speech.',
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
    note: 'Both said to someone younger than the speaker. Your gender shows in a few relationship words, not in grammar.',
    sources: ['https://en.wikibooks.org/wiki/Vietnamese/Personal_pronouns'],
  },
  ko: {
    exampleEn: 'This is my older brother.',
    intro:
      'Korean changes a few family and self-reference words depending on who is speaking, such as 형 versus 오빠.',
    masculine: '제 형이에요.',
    feminine: '제 오빠예요.',
    note: 'Your gender shows in a few relationship words, not in grammar.',
    sources: ['https://www.90daykorean.com/oppa-hyung-noona-unnie/'],
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

export function getPolitenessConfig(
  code: string,
): PolitenessConfig | undefined {
  return POLITENESS_CONFIG[code];
}

/** Whether a sentence without a "you" can differ between levels. */
export function marksWithoutAddressee(marking: PolitenessMarking): boolean {
  return marking !== 'address';
}

/** The distinct forms of one language, in level order, with their levels. */
export function distinctPolitenessForms(
  code: string,
): { form: PolitenessForm; levels: PolitenessLevel[] }[] {
  const config = POLITENESS_CONFIG[code];
  if (!config) return [];
  const out: { form: PolitenessForm; levels: PolitenessLevel[] }[] = [];
  for (const level of POLITENESS_LEVELS) {
    const form = config.forms[level];
    const existing = out.find((entry) => entry.form.id === form.id);
    if (existing) existing.levels.push(level);
    else out.push({ form, levels: [level] });
  }
  return out;
}

/** The form a language renders a global level as, or undefined if unmarked. */
export function politenessFormForLevel(
  code: string,
  level: PolitenessLevel,
): PolitenessForm | undefined {
  return POLITENESS_CONFIG[code]?.forms[level];
}

/**
 * The distinct forms a selected set of levels resolves to for one language,
 * in level order. {casual, polite} on German is [du]; on Japanese it is
 * [plain, desu-masu]. Empty when the language is unmarked.
 */
export function selectedPolitenessForms(
  code: string,
  levels: readonly PolitenessLevel[],
): PolitenessForm[] {
  const config = POLITENESS_CONFIG[code];
  if (!config) return [];
  const out: PolitenessForm[] = [];
  for (const level of POLITENESS_LEVELS) {
    if (!levels.includes(level)) continue;
    const form = config.forms[level];
    if (!out.some((f) => f.id === form.id)) out.push(form);
  }
  return out;
}

/** Whether a course with these TARGET languages asks the politeness question. */
export function courseAsksPoliteness(
  targetLanguages: readonly string[],
): boolean {
  return targetLanguages.some((code) =>
    concreteLanguageCodes(code).some((c) => POLITENESS_CONFIG[c] !== undefined),
  );
}

export type PolitenessRow = {
  level: PolitenessLevel;
  /** The global word, or the single language's own label. */
  label: string;
  /** One entry per marked course language, in course order. */
  perLanguage: { code: string; form: PolitenessForm }[];
};

const LEVEL_WORD: Record<PolitenessLevel, string> = {
  casual: 'Casual',
  polite: 'Polite',
  formal: 'Formal',
};

/**
 * The rows a course shows for its politeness setting: the union of its
 * languages' distinct forms. A row is shown for a global level when at least
 * one language renders that level differently from the level below it. A
 * single marked language names the rows by its own forms; with several, the
 * rows carry the global word and a per-language sublabel.
 */
export function coursePolitenessRows(
  courseLanguages: readonly string[],
): PolitenessRow[] {
  const codes = [
    ...new Set(courseLanguages.flatMap((code) => concreteLanguageCodes(code))),
  ].filter((code) => POLITENESS_CONFIG[code] !== undefined);
  if (codes.length === 0) return [];
  const rows: PolitenessRow[] = [];
  for (let i = 0; i < POLITENESS_LEVELS.length; i++) {
    const level = POLITENESS_LEVELS[i];
    const previous = i > 0 ? POLITENESS_LEVELS[i - 1] : undefined;
    const differs =
      previous === undefined ||
      codes.some(
        (code) =>
          POLITENESS_CONFIG[code].forms[level].id !==
          POLITENESS_CONFIG[code].forms[previous].id,
      );
    if (!differs) continue;
    const perLanguage = codes.map((code) => ({
      code,
      form: POLITENESS_CONFIG[code].forms[level],
    }));
    rows.push({
      level,
      label: codes.length === 1 ? perLanguage[0].form.label : LEVEL_WORD[level],
      perLanguage,
    });
  }
  return rows;
}

/**
 * The levels a set of ticked rows stands for. A ticked row means its level;
 * a hidden level (one no course language distinguishes from the level
 * below) follows the visible level below it, so a German-only course with
 * both rows ticked stores {casual, polite, formal}: the polite row is hidden
 * there and inherits casual (du). Adding Japanese later shows the polite row
 * as ticked, which is what the learner had (levels 1 and 2 were one form).
 */
export function levelsFromTickedRows(
  rows: readonly PolitenessRow[],
  ticked: readonly PolitenessLevel[],
): PolitenessLevel[] {
  const visible = new Set(rows.map((row) => row.level));
  const out: PolitenessLevel[] = [];
  let inherited = false;
  for (const level of POLITENESS_LEVELS) {
    if (visible.has(level)) inherited = ticked.includes(level);
    if (inherited) out.push(level);
  }
  return out;
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
 * The first marked course language's config, for the example block. The
 * targets are searched first so the example is in the language being
 * learned. Undefined when no course language marks first-person forms; the
 * step then explains that the choice sets the voice.
 */
export function courseFirstPersonExample(
  targetLanguages: readonly string[],
  baseLanguages: readonly string[] = [],
): { code: string; config: FirstPersonConfig } | undefined {
  for (const code of [...targetLanguages, ...baseLanguages]) {
    for (const c of concreteLanguageCodes(code)) {
      const config = FIRST_PERSON_CONFIG[c];
      if (config) return { code: c, config };
    }
  }
  return undefined;
}

/**
 * Every language the flags in lib/languages.ts say is marked must have a
 * config here and vice versa. Exposed for the unit test.
 */
export function politenessFlagMismatches(
  languages: readonly Language[],
): string[] {
  const out: string[] = [];
  for (const lang of languages) {
    const config = POLITENESS_CONFIG[lang.code];
    if (lang.politenessMarking && !config)
      out.push(`${lang.code}: flagged ${lang.politenessMarking}, no config`);
    if (!lang.politenessMarking && config)
      out.push(`${lang.code}: config present, no flag`);
    if (
      lang.politenessMarking &&
      config &&
      config.marking !== lang.politenessMarking
    )
      out.push(
        `${lang.code}: flag ${lang.politenessMarking} vs config ${config.marking}`,
      );
    const first = FIRST_PERSON_CONFIG[lang.code];
    if (lang.firstPersonMarking && !first)
      out.push(`${lang.code}: firstPersonMarking flagged, no config`);
    if (!lang.firstPersonMarking && first)
      out.push(`${lang.code}: first-person config present, no flag`);
  }
  return out;
}
