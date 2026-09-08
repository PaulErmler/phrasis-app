/**
 * Benchmark: does the production translation prompt render a sentence in
 * the REQUESTED politeness form and speaker gender, and which wording of
 * the request works better?
 *
 *   pnpm eval:adherence --smoke
 *   pnpm eval:adherence                       (ja, ko first, then the rest)
 *   pnpm eval:adherence --langs=ja,ko --arms=baseline,rw-new-new,fresh-new
 *
 * Arms (default: baseline plus the four rewrite arms):
 *   baseline    today's prompt with no request: the text's own metadata
 *               (no register for a sentence without a "you"), which is what
 *               every shared rendering was generated under, and the
 *               canonical wording every rewrite arm starts from.
 *   rw-W-P      the production mechanism for variants: the baseline output
 *               rewritten for the request with the rendering rewrite prompt.
 *               W = wrapper, P = per-form prompts, each `current` (what
 *               production ships: `buildRenderingRewritePrompt` and the
 *               lib/languageForms.ts strings) or `candidate` (the 2026-09-07
 *               8E proposal, snapshotted below: register rule dropped when a
 *               form is requested, requirement after the input, gender line
 *               first, carrier-list prompts with an example). Paul kept the
 *               current wording on 2026-09-07 because the candidate lost
 *               Japanese keigo on this path (78 -> 68) and gained nothing on
 *               the fresh path. `promptWording: 'literature'` on both, which
 *               is what the queue ships.
 *   fresh-current / fresh-candidate
 *               the same two wordings on the fresh-translation path, which
 *               is what a canonical ja/ko job runs. Opt in with --arms.
 *
 * For every language each distinct politeness form is requested once per
 * sentence, and for first-person-marking languages each gender once on the
 * first-person sentences. Signals:
 *   mech    a surface check per form where a regex can tell the forms
 *           apart, counted over CARRIER sentences only (for an address
 *           language: sentences with a "you"; predicate, particle and
 *           pronoun languages mark every sentence).
 *   form    the judge (Gemini 3.8 Flash) answering "is it in the form?"
 *           against a rubric frozen on the form's label, description and
 *           example, so a wrapper change cannot move the rubric.
 *   meaning the judge answering "is the meaning kept?".
 *   same    rewrite output identical to the baseline wording, the rate the
 *           generate-and-compare rule pays for.
 * Real production `buildPrompt` and the `SOL_MINIMAL` stage. Cache keys carry
 * a hash of the exact prompt, so a wording change re-runs only what it
 * touched. Budget guard default $5; cache under .scratch/adherence-bench/.
 * Key read from the environment by name.
 */

import { resolve } from 'node:path';
import { generateText } from 'ai';
import {
  buildPrompt,
  buildRenderingRewritePrompt,
  normalizeModelOutput,
  openrouterCallOptions,
  type TranslationPromptArgs,
} from '../convex/features/translationLLM';
import { getTranslationConfigForLanguage, SOL_MINIMAL } from '../lib/languages';
import {
  distinctPolitenessForms,
  getPolitenessConfig,
  languageMarksFirstPerson,
  type PolitenessForm,
} from '../lib/languageForms';
import {
  argValue,
  Bench,
  createOpenRouterFromEnv,
  FLASH_JUDGE_MODEL,
  fmtUsd,
  JUDGE_MAX_OUTPUT_TOKENS,
  JUDGE_REASONING,
  pool,
  seededShuffle,
  type CallTelemetry,
  type JudgeOutcome,
  type OpenRouterClient,
} from './eval/lib/bench';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';

// ------------------------------------------------------------------- config

const DEFAULT_LANGS = [
  'ja',
  'ko',
  'de',
  'fr',
  'ru',
  'es',
  'hi',
  'th',
  'pl',
  'vi',
];
const ARMS = [
  'baseline',
  'rw-current-current',
  'rw-current-candidate',
  'rw-candidate-current',
  'rw-candidate-candidate',
  'fresh-current',
  'fresh-candidate',
] as const;
type Arm = (typeof ARMS)[number];
const DEFAULT_ARMS: Arm[] = [
  'baseline',
  'rw-current-current',
  'rw-current-candidate',
  'rw-candidate-current',
  'rw-candidate-candidate',
];
type Variant = 'current' | 'candidate';

type Case = { id: string; text: string; addresses: boolean; first: boolean };
const A = (id: string, text: string, first = false): Case => ({
  id,
  text,
  addresses: true,
  first,
});
const D = (id: string, text: string): Case => ({
  id,
  text,
  addresses: false,
  first: false,
});
const F = (id: string, text: string): Case => ({
  id,
  text,
  addresses: false,
  first: true,
});
/** 40 sentences: 27 address someone (the T-V carriers), 6 describe, 7 are
 *  first person without an addressee. 10 are first person in all. */
const CASES: Case[] = [
  A('a1', 'Are you coming tonight?'),
  A('a2', 'Could you open the window, please?'),
  A('a3', 'Where do you live?'),
  A('a4', 'Thank you for your help.'),
  A('a5', 'Do you want a coffee?'),
  A('a6', 'Please wait here a moment.'),
  A('a7', 'What is your name?'),
  A('a8', 'Have you eaten already?'),
  A('a9', 'Can you help me with this?'),
  A('a10', 'You look tired today.'),
  A('a11', "Don't forget your keys."),
  A('a12', 'How was your trip?'),
  A('a13', 'Sit down, please.'),
  A('a14', 'Are you free tomorrow afternoon?'),
  A('a15', 'Your book is on the table.'),
  A('a16', 'Did you sleep well?'),
  A('a17', 'Call me when you arrive.'),
  A('a18', 'Would you like some more tea?'),
  A('a19', 'What do you think of the film?'),
  A('a20', 'You were right about the weather.'),
  A('a21', 'Take your time.'),
  A('a22', 'Can I ask you a question?'),
  A('a23', 'Are you all right?'),
  A('a24', "I'll wait for you outside.", true),
  A('a25', 'I will call you tomorrow.', true),
  A('a26', "I'm glad you came.", true),
  A('a27', 'Where were you yesterday?'),
  D('d1', 'It is raining again.'),
  D('d2', 'The train leaves at nine.'),
  D('d3', 'This restaurant is very good.'),
  D('d4', 'The meeting was cancelled.'),
  D('d5', 'My sister lives in Berlin.'),
  D('d6', 'The shop opens at ten on Sundays.'),
  F('f1', "I'm tired."),
  F('f2', 'I was at home yesterday.'),
  F('f3', 'I eat breakfast every day.'),
  F('f4', "I'm ready to go."),
  F('f5', 'I got lost in the city.'),
  F('f6', "I'm not sure yet."),
  F('f7', "I've been waiting for an hour."),
];

/** A whole-word alternation that works past ASCII (`\b` treats every
 *  Cyrillic, Devanagari or accented letter as a non-word character, which
 *  is why the first run read Russian as 0% for both forms). */
function word(alts: string[]): RegExp {
  return new RegExp(
    `(?<!\\p{L})(?:${alts.map((a) => a.replace(/'/g, "['’]")).join('|')})(?!\\p{L})`,
    'iu',
  );
}
/** Same, keeping case (German Sie vs sie). */
function wordCs(alts: string[]): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${alts.join('|')})(?!\\p{L})`, 'u');
}
const JA_POLITE_END =
  /(です|ます|ません|ました|でした|ましょう|ください)[。！？!?]*$/;
/** Honorific/humble markers; set phrases every level says are removed
 *  first so ありがとうございます does not read as keigo. */
const JA_SET_PHRASES =
  /(ありがとうございま|おめでとうございま|おはようございま|ごめんなさい)/g;
const JA_KEIGO =
  /(いたし|ござい|おりま|いただ|いらっしゃ|おっしゃ|なさいま|申し|伺|参り|お[^\s、。]+?ください|ご[^\s、。]+?ください)/;
const RU_V = word(['вы', 'вас', 'вам', 'вами', 'ваш', 'ваша', 'ваше', 'ваши']);
const PL_V = word([
  'pan',
  'pani',
  'pana',
  'panu',
  'panią',
  'państwo',
  'państwa',
]);

/** Surface checks per language and form id. `null` = no mechanical signal. */
const CHECKS: Record<string, Record<string, (text: string) => boolean>> = {
  ja: {
    plain: (t) => !JA_POLITE_END.test(t.trim()),
    'desu-masu': (t) =>
      JA_POLITE_END.test(t.trim()) &&
      !JA_KEIGO.test(t.replace(JA_SET_PHRASES, '')),
    keigo: (t) => JA_KEIGO.test(t),
  },
  ko: {
    banmal: (t) => !/(요|니다|니까|십시오)[.!?]*$/.test(t.trim()),
    haeyo: (t) => /요[.!?]*$/.test(t.trim()),
    hapsyo: (t) => /(니다|니까|십시오)[.!?]*$/.test(t.trim()),
  },
  de: {
    t: (t) =>
      word(['du', 'dich', 'dir', 'dein', 'deine', 'deinen', 'deiner']).test(
        t,
      ) && !wordCs(['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren']).test(t),
    v: (t) => wordCs(['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren']).test(t),
  },
  fr: {
    t: (t) =>
      word(['tu', 'toi', 'te', 'ton', 'ta', 'tes', "t'"]).test(t) &&
      !word(['vous', 'votre', 'vos']).test(t),
    v: (t) => word(['vous', 'votre', 'vos']).test(t),
  },
  ru: {
    t: (t) =>
      word([
        'ты',
        'тебя',
        'тебе',
        'тобой',
        'твой',
        'твоя',
        'твои',
        'твоё',
      ]).test(t) && !RU_V.test(t),
    v: (t) => RU_V.test(t) || /(ите|ете|ёте)(?!\p{L})/u.test(t),
  },
  es: {
    t: (t) => !word(['usted', 'ustedes']).test(t),
    v: (t) => word(['usted']).test(t),
  },
  hi: {
    t: (t) => /तुम/.test(t) && !/आप/.test(t),
    v: (t) => /आप/.test(t),
  },
  th: {
    plain: (t) => !/(ครับ|ค่ะ|คะ)/.test(t),
    particle: (t) => /(ครับ|ค่ะ|คะ)/.test(t),
  },
  pl: {
    t: (t) => !PL_V.test(t),
    v: (t) => PL_V.test(t),
  },
  vi: {
    peer: (t) => !word(['ạ']).test(t),
    respectful: (t) =>
      word(['ạ']).test(t) || word(['anh', 'chị', 'em']).test(t),
  },
};

// ------------------------------------------- 2026-09-07 candidate snapshots

/**
 * The 8E per-form prompts (research pass of 2026-09-07) for the bench
 * languages, as benched: carriers stated positively, one contrast where the
 * current prompt already had one, one example. The Korean polite forms carry
 * the "listener with 님" addition that recovered 합쇼체 under the candidate
 * wrapper; the Japanese keigo entry is the first iteration (later ones,
 * without the request clause and with the current wording plus example,
 * scored 55 to 68 on the rewrite path against the current prompt's 78 to
 * 88).
 */
const CANDIDATE_FORM_PROMPTS: Record<string, Record<string, string>> = {
  ja: {
    plain:
      'Every main-clause predicate in plain form (だ / dictionary form / た / ない); no です・ます. Casual but not rough: the name with さん/くん/ちゃん for "you", not あなた, おまえ or 俺. Example: I\'m going. → 行く。',
    'desu-masu':
      'Every main-clause predicate ends in です・ます (ます / ません / ました / でした / ましょう / てください); subordinate clauses stay plain. Ordinary verbs, not 尊敬語・謙譲語 (いらっしゃる, いたす, ございます), except set phrases like ありがとうございます. Example: I eat. → 食べます。',
    keigo:
      "Keigo on a です・ます base: 尊敬語 (いらっしゃる, おっしゃる, お〜になる) for the listener's or a third party's actions, 謙譲語 (参る, 伺う, いたす) for the speaker's own, 丁重語 (ございます, おります) for plain statements; requests as お〜ください or 〜ていただけますか. One honorific per verb, no 二重敬語. Example: I'm going. → 参ります。",
  },
  ko: {
    banmal:
      'End every sentence in 해체 (-아/-어, -야, questions -어?/-니?), not -요 or -습니다, with no honorific -시-; 나/우리 for I/we, 너 for you. Example: I eat. → 먹어.',
    haeyo:
      "End every sentence in 해요체: -아요/-어요 (-예요/-이에요 after nouns), questions -아요?/-어요?, requests -(으)세요; 저/저희 for I/we, the listener by name or title with 님, not 너/네; honorific -시- and 계시다/드리다/말씀 when the subject or listener deserves them. Example: I'm going. → 가요.",
    hapsyo:
      "End every sentence in 합쇼체: statements -습니다/-ㅂ니다, questions -습니까/-ㅂ니까, requests -(으)십시오; 저/저희 for I/we, the listener by name or title with 님, not 너/네; honorific -시- and 계시다/드리다/말씀 when the subject or listener deserves them. Example: I'm going. → 갑니다.",
  },
  de: {
    t: 'Address the listener as du (dich, dir, dein/deine) with second-person-singular verbs and pronoun-less imperatives (Kommst du? / Warte bitte); ihr for several people; informal greetings (Hallo, Tschüss). Example: Are you coming? → Kommst du?',
    v: 'Address the listener as Sie (Ihnen, Ihr/Ihre, capitalised) with third-person-plural verbs and imperatives (Kommen Sie? / Warten Sie bitte); formal greetings (Guten Tag, Auf Wiedersehen). Example: Are you coming? → Kommen Sie?',
  },
  fr: {
    t: 'Address the listener as tu (te, toi, ton/ta/tes) with second-person-singular verbs and pronoun-less singular imperatives (Attends, Ouvre); salut rather than bonjour Monsieur. Example: Are you coming? → Tu viens ?',
    v: 'Address the listener as vous (vous, votre/vos) with second-person-plural verbs and plural imperatives (Attendez, Ouvrez); adjectives and participles stay singular for one listener (vous êtes fatigué); bonjour, au revoir. Example: Are you coming? → Vous venez ?',
  },
  ru: {
    t: 'Address the listener as ты (тебя, тебе, твой) with second-person-singular verbs and singular imperatives (Ты идёшь? / Иди, Подожди); привет, пока. Example: Are you going? → Ты идёшь?',
    v: 'Address the listener as вы (вас, вам, ваш) with second-person-plural verbs and plural imperatives (Вы идёте? / Идите, Подождите), past-tense verbs and short adjectives plural (вы устали, вы правы); name and patronymic where a name appears; здравствуйте, до свидания. Example: Are you going? → Вы идёте?',
  },
  es: {
    t: 'Address the listener as tú (te, ti, tu/tus) with second-person-singular verbs and tú imperatives (¿Vienes? / Espera); vosotros for several people; hola. Example: Are you coming? → ¿Vienes?',
    v: 'Address the listener as usted (le, lo/la, su/sus) with third-person-singular verbs and usted imperatives (¿Viene usted? / Espere); ustedes for several people; buenos días. Example: Are you coming? → ¿Viene usted?',
  },
  hi: {
    t: 'तुम (तुम्हारा, तुम्हें) with its verb forms (हो, करते हो, imperative करो), not तू. Example: What is your name? → तुम्हारा नाम क्या है?',
    v: 'आप (आपका, आपको) with plural agreement (हैं, करते हैं, imperative कीजिए); honorific plural for respected third persons (वे हैं); नमस्ते, धन्यवाद. Example: What is your name? → आपका नाम क्या है?',
  },
  th: {
    plain:
      'No sentence-final politeness particle: ฉัน or เรา for I, เธอ or the name for you, friendly particles (นะ, จ้ะ) where natural. Colloquial but not vulgar: เธอ, not กู/มึง. Example: Thank you. → ขอบคุณ',
    particle:
      "End every sentence with the speaker's polite particle: ครับ for a man; ค่ะ in statements and คะ in questions for a woman. ผม (man) or ดิฉัน/ฉัน (woman) for I, คุณ for you. If the speaker's gender is not stated or is unspecified, use ค่ะ/คะ. Example: Thank you. → ขอบคุณครับ (man) / ขอบคุณค่ะ (woman)",
  },
  pl: {
    t: 'Address the listener as ty (cię, ci, twój) with second-person-singular verbs and singular imperatives (Gdzie mieszkasz? / Poczekaj); cześć. Example: Where do you live? → Gdzie mieszkasz?',
    v: 'Address the listener as pan (to a man) or pani (to a woman) with third-person-singular verbs, requests as proszę + infinitive or niech pan/pani (Gdzie pan mieszka? / Proszę poczekać); państwo for a group, not wy; dzień dobry, do widzenia. Example: Where do you live? → Gdzie pan mieszka?',
  },
  vi: {
    peer: 'Peer pronouns tớ/cậu or mình/bạn for I/you, ừ for yes, no sentence-final ạ. Friendly, not rude: cậu, not mày/tao. Example: Thank you. → Cảm ơn.',
    respectful:
      'Kinship pronouns by relative age: anh/chị for an older listener, em for a younger one, tôi/bạn when unknown; sentence-final ạ on statements, questions and requests toward an older or unfamiliar listener, dạ for yes. Example: Thank you. → Cảm ơn ạ.',
  },
};

/** The candidate `PROMPT_B_INSTRUCTIONS`, split so the register rule can be
 *  left out when a form is requested. */
const CANDIDATE_AGREEMENT = `Use the supplied speaker, referent, and (if present) addressee gender for any grammatical agreement (verb conjugation, adjective inflection, pronoun choice, gendered noun forms) the target language requires. The referent_gender drives third-party noun forms like German Übersetzer/-in, French traducteur/-rice, Spanish profesor/-a.`;
const CANDIDATE_REGISTER = `Use the requested register. Three levels exist: casual (the familiar T-form: du/tú/tu/ты, Japanese plain form with 君 or the name for "you", Korean 반말), polite (the level that is safe with anyone: vous/usted/вы/आप, Japanese です・ます, Korean 해요체) and formal (the distance or honorific level: Sie, keigo 尊敬語・謙譲語, Korean 합쇼체). 'informal' and 'neutral' both mean casual; 'formal' means polite. Never the aggressive おまえ. DO NOT default to the polite form when the register is neutral.`;
const CANDIDATE_OUTPUT = `If the target language does not grammatically encode a given feature, translate naturally and ignore it. Do not output any field as a literal word. Only return one translation. Do not return multiple alternative translations or explanations — when several renderings are possible, silently pick the single most natural one.`;

/** The candidate `requestedFormInstruction`, literature wording: gender line
 *  first, the form line without the override, path-specific tail. */
function candidateRequestedFormInstruction(
  args: Pick<TranslationPromptArgs, 'requestedForm' | 'requestedGender'>,
  path: 'translate' | 'rewrite',
): string[] {
  const lines: string[] = [];
  if (args.requestedGender) {
    const who = args.requestedGender === 'male' ? 'a man' : 'a woman';
    const forms = args.requestedGender === 'male' ? 'masculine' : 'feminine';
    lines.push(
      `Speaker gender agreement: the speaker is ${who}. Every first-person form the language inflects for the speaker's gender (verb, participle, adjective, pronoun, self-reference word, sentence particle) takes the ${forms} form. Nothing else changes.`,
    );
  }
  if (args.requestedForm) {
    const form = args.requestedForm;
    const tail =
      path === 'rewrite'
        ? 'If nothing in the sentence can carry it, return the translation unchanged.'
        : "Keep the source's own register only inside a direct quotation.";
    lines.push(
      `Required speech level / address form (T-V distinction, honorific register): ${form.label}. ${form.prompt} Apply it at every place in the sentence that can carry it, including sentences that address nobody. ${tail}`,
    );
  }
  return lines;
}

/** The candidate `buildRenderingRewritePrompt`: requirement after the
 *  translation. */
function candidateRewritePrompt(args: {
  targetLangName: string;
  sourceText: string;
  canonicalText: string;
  requestedGender?: 'male' | 'female';
  requestedForm?: { id: string; label: string; prompt: string };
}): string {
  return [
    `You are a professional ${args.targetLangName} editor. Below is an English sentence and its ${args.targetLangName} translation. Rewrite the translation so that it satisfies the requirement, and change NOTHING else: keep every word, the word order, the punctuation and the meaning exactly as they are wherever the requirement does not force a change. If the translation already satisfies the requirement, output it unchanged, character for character.`,
    ``,
    `<source>${args.sourceText}</source>`,
    `<translation>${args.canonicalText}</translation>`,
    ``,
    `<requirement>`,
    ...candidateRequestedFormInstruction(args, 'rewrite').map(
      (line) => `  ${line}`,
    ),
    `</requirement>`,
    ``,
    `Output only the rewritten ${args.targetLangName} sentence. No commentary, no tags, no quotation marks, no alternatives.`,
  ].join('\n');
}

/** The candidate `buildPrompt` for a request (no arc or flag context): the
 *  register rule left out, the requirement after the source. */
function candidateFreshPrompt(args: TranslationPromptArgs): string {
  const fullName =
    args.targetLangNativeName !== args.targetLangName
      ? `${args.targetLangName} (${args.targetLangNativeName})`
      : args.targetLangName;
  const ctx = [
    `  <speaker_gender>${args.requestedGender ?? args.speakerGender ?? 'unspecified'}</speaker_gender>`,
    `  <referent_gender>${args.referentGender}</referent_gender>`,
  ];
  if (args.addressesSomeone)
    ctx.push(
      `  <addressee_gender>${args.addresseeGender ?? 'unspecified'}</addressee_gender>`,
    );
  if (args.requestedForm)
    ctx.push(`  <register>${args.requestedForm.id}</register>`);
  else if (args.addressesSomeone)
    ctx.push(`  <register>${args.formality ?? 'neutral'}</register>`);
  const requirements = candidateRequestedFormInstruction(args, 'translate');
  return [
    `You are a professional English-to-${fullName} translator. Translate the text inside <source> tags into ${fullName} (${args.targetLang}), suitable for ${args.targetRegion}.`,
    ``,
    `<context>`,
    ...ctx,
    `</context>`,
    ``,
    `<instructions>`,
    [
      CANDIDATE_AGREEMENT,
      ...(args.requestedForm ? [] : [CANDIDATE_REGISTER]),
      CANDIDATE_OUTPUT,
    ].join(' '),
    `</instructions>`,
    ``,
    `<source>${args.text}</source>`,
    ...(requirements.length > 0
      ? [
          ``,
          `<requirement>`,
          ...requirements.map((line) => `  ${line}`),
          `</requirement>`,
        ]
      : []),
    ``,
    `Output only the ${fullName} translation of the text inside <source>, as exactly ONE translation. No commentary, no explanations, no tags, no quotation marks, no alternative renderings.`,
  ].join('\n');
}

// ------------------------------------------------------------------- bench

const OUT_DIR = resolve(__dirname, '../.scratch/adherence-bench');
const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: Number(argValue(process.argv, 'budget') ?? 5),
  budgetHint: 're-run with fewer --langs/--arms or raise --budget',
});

/** FNV-1a, 8 hex chars: the prompt's identity in the cache key. */
function hash(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

type Request = { form?: PolitenessForm; gender?: 'male' | 'female' };

const warnedCandidate = new Set<string>();
function formArg(
  lang: string,
  form: PolitenessForm,
  prompts: Variant,
): NonNullable<TranslationPromptArgs['requestedForm']> {
  const candidate = CANDIDATE_FORM_PROMPTS[lang]?.[form.id];
  if (prompts === 'candidate' && !candidate && !warnedCandidate.has(lang)) {
    warnedCandidate.add(lang);
    console.warn(
      `  no candidate prompt snapshot for ${lang}; the candidate-prompt arms use the current prompt there`,
    );
  }
  return {
    id: form.id,
    label: form.promptLabel,
    prompt: prompts === 'candidate' && candidate ? candidate : form.prompt,
  };
}

function baseArgs(lang: string, c: Case): TranslationPromptArgs {
  const config = getTranslationConfigForLanguage(lang);
  return {
    text: c.text,
    sourceLang: 'en',
    targetLang: lang,
    targetLangName: config.targetLangName,
    targetLangNativeName: config.targetLangNativeName,
    targetRegion: config.targetRegion,
    addressesSomeone: c.addresses,
    referentGender: 'male',
  };
}

function requestArgs(
  lang: string,
  c: Case,
  req: Request,
  prompts: Variant,
): TranslationPromptArgs {
  return {
    ...baseArgs(lang, c),
    requestedForm: req.form ? formArg(lang, req.form, prompts) : undefined,
    requestedGender: req.gender,
    promptWording: 'literature',
  };
}

/** The prompt an arm sends, given the canonical wording for rewrite arms. */
function armPrompt(
  arm: Arm,
  lang: string,
  c: Case,
  req: Request,
  canonical: string | null,
): string | null {
  if (arm === 'baseline') return buildPrompt(baseArgs(lang, c));
  if (arm === 'fresh-current')
    return buildPrompt(requestArgs(lang, c, req, 'current'));
  if (arm === 'fresh-candidate')
    return candidateFreshPrompt(requestArgs(lang, c, req, 'candidate'));
  if (canonical === null) return null;
  const [, wrapper, prompts] = arm.split('-') as [string, Variant, Variant];
  const args = requestArgs(lang, c, req, prompts);
  const rewriteArgs = {
    targetLang: lang,
    targetLangName: args.targetLangName,
    sourceText: c.text,
    canonicalText: canonical,
    requestedGender: args.requestedGender,
    requestedForm: args.requestedForm,
    promptWording: 'literature' as const,
  };
  return wrapper === 'candidate'
    ? candidateRewritePrompt(rewriteArgs)
    : buildRenderingRewritePrompt(rewriteArgs);
}

async function translate(
  openrouter: OpenRouterClient,
  lang: string,
  prompt: string,
): Promise<string | null> {
  const key = `tr|${lang}|${hash(prompt)}`;
  const hit = bench.cache[key];
  if (hit) return hit.text;
  const startedAt = Date.now();
  let text: string | null = null;
  const telemetry: CallTelemetry[] = [];
  try {
    const res = await generateText({
      model: openrouter(SOL_MINIMAL.model),
      prompt,
      temperature: 0,
      maxOutputTokens: 1_500,
      providerOptions: {
        openrouter: {
          reasoning: { effort: SOL_MINIMAL.reasoning ?? 'minimal' },
        },
      },
    });
    text = normalizeModelOutput(lang, res.text);
    telemetry.push({
      model: SOL_MINIMAL.model,
      inputTokens: res.usage.inputTokens ?? 0,
      outputTokens: res.usage.outputTokens ?? 0,
      costUsd: openrouterCostUsd(res.providerMetadata),
      latencyMs: Date.now() - startedAt,
      role: 'translate',
      generationId: openrouterGenerationId(res.providerMetadata),
    });
  } catch (err) {
    console.warn(
      `  translate failed (${key}): ${err instanceof Error ? err.message.slice(0, 120) : err}`,
    );
  }
  bench.cache[key] = { text, telemetry };
  bench.recordSpend(telemetry);
  bench.save();
  return text;
}

// ------------------------------------------------------------------- judge

/**
 * The rubric is frozen on the form's label, description and example (the
 * learner-facing copy), never on the wrapper under test, and asks two
 * yes/no questions per candidate. Verdicts are cached as one integer per
 * candidate: form * 2 + meaning.
 */
function judgePrompt(
  lang: string,
  c: Case,
  req: Request,
  candidates: string[],
): string {
  const name = getTranslationConfigForLanguage(lang).targetLangName;
  const config = getPolitenessConfig(lang);
  const rules: string[] = [];
  if (req.form) {
    rules.push(
      `Politeness form: ${req.form.promptLabel}. Used with: ${req.form.description}. Example: "${config?.exampleEn ?? ''}" → "${req.form.example}"`,
    );
  }
  if (req.gender) {
    const who = req.gender === 'male' ? 'a man' : 'a woman';
    rules.push(
      `Speaker: ${who}. Every first-person form ${name} inflects for the speaker's gender must agree with that.`,
    );
  }
  return `You are a strict ${name} language examiner. An English sentence was translated into ${name} under this requirement:

${rules.map((r) => `- ${r}`).join('\n')}

English: ${c.text}

For each candidate answer two yes/no questions.
form: Is the candidate in the required form (and, if a speaker is given, agreeing with that speaker) at every place ${name} can show it? A sentence with no place to show it (no addressee, no first person, no inflected word) counts as yes when it is natural ${name}.
meaning: Does the candidate say what the English sentence says, nothing added or lost?

Candidates:
${candidates.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Output only a JSON array of ${candidates.length} objects {"form": 0 or 1, "meaning": 0 or 1}, one per candidate, in order.`;
}

async function judgeBinary(
  openrouter: OpenRouterClient,
  prompt: string,
  candidates: string[],
  label: string,
): Promise<JudgeOutcome | null> {
  const providerOptions = openrouterCallOptions(JUDGE_REASONING);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await generateText({
        model: openrouter(FLASH_JUDGE_MODEL),
        prompt,
        temperature: 0,
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
        ...(providerOptions ? { providerOptions } : {}),
      });
      const telemetry: CallTelemetry[] = [
        {
          model: FLASH_JUDGE_MODEL,
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
          costUsd: openrouterCostUsd(res.providerMetadata),
          latencyMs: Date.now() - startedAt,
          role: 'quality-judge',
          generationId: openrouterGenerationId(res.providerMetadata),
        },
      ];
      bench.recordSpend(telemetry);
      const match = res.text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error(`unparseable: ${res.text.slice(0, 80)}`);
      const parsed = JSON.parse(match[0]) as {
        form: number;
        meaning: number;
      }[];
      if (parsed.length !== candidates.length)
        throw new Error(
          `expected ${candidates.length} verdicts, got ${parsed.length}`,
        );
      const scores: Record<string, number> = {};
      candidates.forEach((text, i) => {
        scores[text] = (parsed[i].form ? 2 : 0) + (parsed[i].meaning ? 1 : 0);
      });
      return { scores, telemetry };
    } catch (err) {
      console.warn(
        `  judge attempt ${attempt} failed (${label}): ${err instanceof Error ? err.message.slice(0, 120) : err}`,
      );
    }
  }
  return null;
}

// -------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const smoke = argv.includes('--smoke');
  const langs = (argValue(argv, 'langs') ?? DEFAULT_LANGS.join(','))
    .split(',')
    .filter(Boolean);
  const arms = (argValue(argv, 'arms')?.split(',').filter(Boolean) ??
    DEFAULT_ARMS) as Arm[];
  for (const arm of arms)
    if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`);
  let cases = smoke
    ? CASES.filter((c) => ['a1', 'd1', 'f1'].includes(c.id))
    : CASES;
  const limit = argValue(argv, 'limit')
    ? Number(argValue(argv, 'limit'))
    : undefined;
  if (limit) cases = cases.slice(0, limit);
  const openrouter = createOpenRouterFromEnv('pnpm eval:adherence');

  type Job = { lang: string; c: Case; req: Request; reqKey: string };
  const jobs: Job[] = [];
  for (const lang of langs) {
    const forms = distinctPolitenessForms(lang).map((d) => d.form);
    for (const c of cases) {
      for (const form of forms)
        jobs.push({ lang, c, req: { form }, reqKey: `form:${form.id}` });
      if (languageMarksFirstPerson(lang) && c.first) {
        for (const gender of ['male', 'female'] as const)
          jobs.push({ lang, c, req: { gender }, reqKey: `gender:${gender}` });
      }
    }
  }

  /** Whether the sentence can carry the request at all (the denominator of
   *  the mechanical check). */
  const carries = (job: Job): boolean => {
    if (job.req.gender) return job.c.first;
    const marking = getPolitenessConfig(job.lang)?.marking;
    return marking === 'address' ? job.c.addresses : true;
  };

  type Result = {
    lang: string;
    c: Case;
    reqKey: string;
    arm: Arm;
    text: string | null;
    carrier: boolean;
    mech: boolean | null;
    form: boolean | null;
    meaning: boolean | null;
    same: boolean | null;
  };
  const results: Result[] = [];
  const needsCanonical = arms.some((a) => a.startsWith('rw-'));
  await pool(jobs, 10, async (job) => {
    const outputs = new Map<Arm, string | null>();
    const canonicalPrompt = buildPrompt(baseArgs(job.lang, job.c));
    const canonical =
      arms.includes('baseline') || needsCanonical
        ? await translate(openrouter, job.lang, canonicalPrompt)
        : null;
    if (arms.includes('baseline')) outputs.set('baseline', canonical);
    await Promise.all(
      arms
        .filter((arm) => arm !== 'baseline')
        .map(async (arm) => {
          const prompt = armPrompt(arm, job.lang, job.c, job.req, canonical);
          outputs.set(
            arm,
            prompt === null
              ? null
              : await translate(openrouter, job.lang, prompt),
          );
        }),
    );
    const candidates = [
      ...new Set([...outputs.values()].filter((t): t is string => t !== null)),
    ];
    const rubric = judgePrompt(job.lang, job.c, job.req, []);
    const judgeKey = `judge2|${job.lang}|${job.c.id}|${job.reqKey}|${hash(rubric)}`;
    let scores: Record<string, number> = {};
    if (candidates.length > 0) {
      if (bench.hasJudgedAll(judgeKey, candidates)) {
        scores = bench.judgeScores(judgeKey);
      } else {
        const shuffled = seededShuffle(candidates, judgeKey);
        const outcome = await judgeBinary(
          openrouter,
          judgePrompt(job.lang, job.c, job.req, shuffled),
          shuffled,
          judgeKey,
        );
        if (outcome) {
          bench.storeJudge(judgeKey, outcome);
          scores = outcome.scores;
        }
      }
    }
    const carrier = carries(job);
    for (const arm of arms) {
      const text = outputs.get(arm) ?? null;
      const check = job.req.form
        ? CHECKS[job.lang]?.[job.req.form.id]
        : undefined;
      const verdict = text !== null ? scores[text] : undefined;
      results.push({
        lang: job.lang,
        c: job.c,
        reqKey: job.reqKey,
        arm,
        text,
        carrier,
        mech: text !== null && check && carrier ? check(text) : null,
        form: verdict === undefined ? null : verdict >= 2,
        meaning: verdict === undefined ? null : verdict % 2 === 1,
        same:
          arm.startsWith('rw-') && text !== null && canonical !== null
            ? text === canonical
            : null,
      });
    }
  });

  const lines: string[] = [];
  const out = (line = '') => {
    lines.push(line);
    console.log(line);
  };
  const pct = (list: Result[], pick: (r: Result) => boolean | null) => {
    const scored = list.filter((r) => pick(r) !== null);
    return scored.length
      ? `${((100 * scored.filter((r) => pick(r)).length) / scored.length).toFixed(0)}%`
      : '-';
  };
  const row = (label: string, list: Result[]) =>
    out(
      `${label} ${pct(list, (r) => r.mech).padEnd(8)} ${pct(list, (r) => r.form).padEnd(8)} ${pct(list, (r) => r.meaning).padEnd(8)} ${pct(list, (r) => r.same).padEnd(8)} ${list.length}`,
    );
  const header = (first: string) =>
    out(
      `${first.padEnd(38)} ${'mech'.padEnd(8)} ${'form'.padEnd(8)} ${'meaning'.padEnd(8)} ${'same'.padEnd(8)} n`,
    );

  out(
    `\nAdherence, ${jobs.length} requests x ${arms.length} arms, stage ${SOL_MINIMAL.model}, judge ${FLASH_JUDGE_MODEL}`,
  );
  out(
    'mech = surface check over carrier sentences; form / meaning = judge yes-rate; same = rewrite equals the baseline wording',
  );
  out('\n== pooled over languages, politeness requests ==');
  header('arm');
  const formResults = results.filter((r) => r.reqKey.startsWith('form:'));
  for (const arm of arms)
    row(
      arm.padEnd(38),
      formResults.filter((r) => r.arm === arm),
    );
  out('\n== pooled over languages, gender requests ==');
  header('arm');
  const genderResults = results.filter((r) => r.reqKey.startsWith('gender:'));
  for (const arm of arms)
    row(
      arm.padEnd(38),
      genderResults.filter((r) => r.arm === arm),
    );

  out('\n== per language, all politeness forms pooled ==');
  header('lang   arm');
  for (const lang of langs)
    for (const arm of arms)
      row(
        `${lang.padEnd(6)} ${arm.padEnd(31)}`,
        formResults.filter((r) => r.lang === lang && r.arm === arm),
      );

  out('\n== per language and request ==');
  header('lang   request            arm');
  for (const lang of langs) {
    const reqKeys = [
      ...new Set(results.filter((r) => r.lang === lang).map((r) => r.reqKey)),
    ];
    for (const reqKey of reqKeys)
      for (const arm of arms)
        row(
          `${lang.padEnd(6)} ${reqKey.padEnd(18)} ${arm.padEnd(12)}`,
          results.filter(
            (r) => r.lang === lang && r.reqKey === reqKey && r.arm === arm,
          ),
        );
  }

  out('\n== judged not in form (non-baseline, carriers) ==');
  let shown = 0;
  for (const r of results) {
    if (r.arm !== 'baseline' && r.carrier && r.form === false && shown < 80) {
      shown++;
      out(`  ${r.lang} ${r.c.id} ${r.reqKey} ${r.arm}: ${r.text}`);
    }
  }
  out(`\nSpent ${fmtUsd(bench.spentUsd)} this run.`);
  bench.writeReport(lines, { results });
}

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
