import { ConvexError, v, type Infer } from 'convex/values';
import { MAX_MESSAGE_LENGTH } from './constants';
import {
  joinLanguageNames,
  languageName,
  quoteSentences,
  targetSentenceLines,
} from './promptSections';

/**
 * Quick actions: the client sends a compact action key (plus a small payload)
 * instead of a long prompt. The server expands it into a detailed steering
 * prompt that is persisted as a hidden system message right before the short
 * visible user label — so the model gets precise instructions while the chat
 * shows a clean bubble, and follow-up turns still see what was asked.
 */

export const vQuickAction = v.union(
  v.object({ kind: v.literal('grammar') }),
  v.object({ kind: v.literal('conjugation') }),
  v.object({ kind: v.literal('tenses') }),
  v.object({ kind: v.literal('paraphrase') }),
  v.object({ kind: v.literal('formal') }),
  v.object({ kind: v.literal('simpler') }),
  v.object({ kind: v.literal('explainWord'), word: v.string(), language: v.string() }),
  v.object({ kind: v.literal('synonyms'), word: v.string(), language: v.string() }),
  v.object({ kind: v.literal('antonyms'), word: v.string(), language: v.string() }),
  v.object({
    kind: v.literal('discussAnswer'),
    userAnswer: v.string(),
    expected: v.string(),
    language: v.string(),
  }),
);

export type QuickAction = Infer<typeof vQuickAction>;
export type QuickActionKind = QuickAction['kind'];

export const SENTENCE_QUICK_ACTION_KINDS = [
  'grammar',
  'conjugation',
  'tenses',
  'paraphrase',
  'formal',
  'simpler',
] as const;
export type SentenceQuickActionKind = (typeof SENTENCE_QUICK_ACTION_KINDS)[number];

export const MAX_QUICK_ACTION_WORD_LENGTH = 100;
// Generous — real BCP-47 codes are ≤ ~11 chars; this only stops the field
// being used to smuggle arbitrary-length text into the steering prompt.
export const MAX_QUICK_ACTION_LANGUAGE_LENGTH = 50;

/**
 * Length guards for the free-text quick-action payload fields (the validator
 * only checks shape). Throws the same MESSAGE_TOO_LONG code as an over-long
 * plain prompt so the client's error handling is identical for both.
 */
export function assertQuickActionWithinLimits(action: QuickAction): void {
  const tooLong =
    ('word' in action && action.word.length > MAX_QUICK_ACTION_WORD_LENGTH) ||
    ('language' in action &&
      action.language.length > MAX_QUICK_ACTION_LANGUAGE_LENGTH) ||
    ('userAnswer' in action &&
      (action.userAnswer.length > MAX_MESSAGE_LENGTH ||
        action.expected.length > MAX_MESSAGE_LENGTH));
  if (tooLong) {
    throw new ConvexError({
      code: 'MESSAGE_TOO_LONG',
      message: 'Quick action payload exceeds the length limit',
    });
  }
}

export interface QuickActionContext {
  card: {
    sourceText: string;
    sourceLanguage: string;
    translations: { language: string; text: string }[];
  } | null;
  baseLanguages: string[];
  targetLanguages: string[];
}

function targetSentencesFallback(ctx: QuickActionContext): string {
  const names = joinLanguageNames(ctx.targetLanguages);
  if (!names) {
    return 'the target-language sentence currently being reviewed (see the card context) — never its base-language translation';
  }
  return ctx.targetLanguages.length > 1
    ? `the ${names} sentences currently being reviewed (see the card context) — the target-language texts, never their base-language translation`
    : `the ${names} sentence currently being reviewed (see the card context) — the target-language text, never its base-language translation`;
}

/** The reviewed sentence in the target language(s), quoted for the prompt. */
function targetSentences(ctx: QuickActionContext): string {
  if (!ctx.card) return targetSentencesFallback(ctx);
  const sentences = targetSentenceLines(ctx.card, ctx.targetLanguages);
  if (sentences.length === 0) {
    return targetSentencesFallback(ctx);
  }
  return quoteSentences(sentences);
}

const CARD_EVERY_EXAMPLE =
  'create a flashcard (createCard) for every example sentence you present';

/**
 * Every steering prompt ends with an explicit reply-language instruction:
 * quick actions have no real typed user message, so without this the model
 * tends to answer in the language of the word/sentence being discussed
 * (i.e. the target language) instead of the user's base language.
 */
function replyLanguageNote(ctx: QuickActionContext): string {
  const base = ctx.baseLanguages[0];
  if (!base) return '';
  const role =
    ctx.baseLanguages.length > 1
      ? "the user's primary base language"
      : "the user's base language";
  return ` Write your entire reply in ${languageName(base)} (${role}); only quoted examples, vocabulary, and target-language card entries are in the target language.`;
}

/**
 * Names the target language(s) again at the end of sentence actions. The
 * card context carries both renderings, and without this the model
 * sometimes analyzes the base-language translation instead of the sentence
 * the user is actually learning. Multi-target courses are answered for
 * every target language in one reply — sentence actions are deliberately
 * not scoped to a single language.
 */
function targetSubjectNote(ctx: QuickActionContext): string {
  const names = joinLanguageNames(ctx.targetLanguages);
  if (!names) return '';
  return ctx.targetLanguages.length > 1
    ? ` Everything you analyze and every example you produce is in the target languages ${names}. Cover EACH of them in this reply, in its own right — do not answer for only one, and do not contrast them with each other unless the user asks. Do not analyze or explain the base-language translation of this card.`
    : ` Everything you analyze and every example you produce is ${names} — the target language. Do not analyze or explain the base-language translation of this card.`;
}

function sentenceSteering(kind: SentenceQuickActionKind, sentence: string): string {
  switch (kind) {
    case 'grammar':
      return `The user wants a detailed grammar explanation of the sentence they are reviewing: ${sentence}. Never create a card for the reviewed sentence itself.`;
    case 'conjugation':
      return `The user wants to practice the verbs in the sentence they are reviewing: ${sentence}. Identify every verb and name the tense the sentence is actually in. Stay in THAT tense — do not walk through other tenses (a separate action covers past and future). Keep the prose SHORT: for each verb give its dictionary form, say whether it is regular or irregular and what its pattern is, and point out only the irregularities or traps a learner would get wrong. Do NOT recite conjugation tables or list the forms person by person in your text — teach the forms through cards instead: create flashcards (createCard) with natural everyday sentences that use the verb in the sentence's tense across the DIFFERENT persons (I, you informal, he/she, we, you plural, they/formal), one card per person form, plus a couple of extra sentences for variety. Vary the content of each sentence; never repeat a sentence and never create a card for the reviewed sentence itself.`;
    case 'tenses':
      return `The user wants to know how to express the reviewed sentence in other tenses: ${sentence}. Transform it at minimum into the past and the future, using the tense forms actually preferred in everyday spoken language (mention when the language favors one past form in conversation). For each version: give the transformed sentence, name the tense, and explain briefly what changed grammatically. Create a flashcard (createCard) for every transformed sentence, plus 1-2 additional example cards in those tenses with different vocabulary.`;
    case 'paraphrase':
      return `The user wants different ways to say the same thing as the reviewed sentence: ${sentence}. Give 3-5 natural paraphrases that native speakers actually use, and for each explain briefly how it differs in nuance, register, or emphasis. Create a flashcard (createCard) for every paraphrase.`;
    case 'formal':
      return `The user wants more formal and polite versions of the reviewed sentence: ${sentence}. Give 2-4 versions of increasing formality. Explain what makes each one formal (pronouns and address forms, verb forms, vocabulary choice, honorifics where the language has them) and in which situations to use it. Create a flashcard (createCard) for every formal version.`;
    case 'simpler':
      return `The user wants simpler ways to express the reviewed sentence: ${sentence}. Give 2-4 simpler versions — shorter, higher-frequency words, beginner-friendly structures that native speakers still genuinely use. Explain what was simplified in each. Create a flashcard (createCard) for every simpler version.`;
  }
}

function wordSteering(
  kind: 'explainWord' | 'synonyms' | 'antonyms',
  word: string,
  language: string,
  isTarget: boolean,
  targetLanguages: string[],
): string {
  const name = languageName(language);
  // A base-language word has no single target language attached, so the
  // prompt must name them: with several targets the model otherwise answers
  // for just one of them.
  const targets = joinLanguageNames(targetLanguages);
  const multiTarget = targetLanguages.length > 1;
  const forEachTarget = multiTarget
    ? `covering EVERY target language (${targets}) separately — one section per language, never only the first`
    : `in ${targets || 'the target language'}`;

  if (kind === 'explainWord') {
    return isTarget
      ? `The user clicked the ${name} word "${word}" (a TARGET language). Explain this word: meaning(s), part of speech, essential grammar (e.g. gender, plural, conjugation class, governed prepositions — as relevant), register, common collocations, and typical pitfalls for learners. Create 2-4 flashcards (createCard) with varied example sentences. Each card MUST use a DIFFERENT grammatical form of "${word}" (other persons, tenses, number, case, comparison — whichever the part of speech allows). Do not put the same surface form on every card.`
      : `The user clicked the word "${word}" in a BASE-language (${name}) rendering. Do NOT explain this base-language word itself. Instead give its translation(s)/equivalent(s) ${forEachTarget}: explain the differences between those equivalents (nuance, register, when to use which) and the essential grammar of each, and create 2-4 flashcards (createCard) with example sentences. Spread the cards across DIFFERENT grammatical forms of those equivalents — not the same form repeated.`;
  }

  const relation = kind === 'synonyms' ? 'synonyms' : 'antonyms (opposites)';
  const unit = kind === 'synonyms' ? 'synonym' : 'antonym';
  const nuance =
    kind === 'synonyms'
      ? 'the nuance differences between them (connotation, register, typical contexts, collocations)'
      : 'the nuance differences between them (including near-antonyms whose register or strength differs)';
  return isTarget
    ? `The user wants ${relation} of the ${name} word "${word}". Give 3-6 ${relation} in ${name} — the same language as the word, not any other course language — explain ${nuance}, and give one natural ${name} example sentence per ${unit}. ${capitalize(CARD_EVERY_EXAMPLE)}.`
    : `"${word}" is a BASE-language (${name}) word. Do NOT discuss the base language itself: give its equivalent(s) ${forEachTarget}, then the ${relation} of those equivalents in that same target language, explain ${nuance}, and give one natural example sentence each. ${capitalize(CARD_EVERY_EXAMPLE)}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function expandQuickAction(action: QuickAction, ctx: QuickActionContext): string {
  const header = `[Quick action pressed by the user: ${action.kind}]`;
  const replyNote = replyLanguageNote(ctx);
  switch (action.kind) {
    case 'grammar':
    case 'conjugation':
    case 'tenses':
    case 'paraphrase':
    case 'formal':
    case 'simpler':
      return `${header} ${sentenceSteering(action.kind, targetSentences(ctx))}${targetSubjectNote(ctx)}${replyNote}`;
    case 'explainWord':
    case 'synonyms':
    case 'antonyms':
      return `${header} ${wordSteering(
        action.kind,
        action.word,
        action.language,
        ctx.targetLanguages.includes(action.language),
        ctx.targetLanguages,
      )}${replyNote}`;
    case 'discussAnswer':
      return `${header} The user is practicing writing. The expected ${languageName(action.language)} sentence was: "${action.expected}". The user wrote: "${action.userAnswer}". Judge whether the user's version is ALSO a correct, natural way to express the same thing. If fully correct: say so clearly, point out any nuance or register differences from the expected sentence, and call the markAlsoCorrect tool exactly once — pass the full corrected sentence for every language whose text changes (keep the user's wording; fix only punctuation/capitalization/diacritics) plus any card-metadata fields the version changes (speaker gender, register, addressee); the app then offers to save it, so do not ask. If partially correct: identify exactly which parts are right and which are off, and why — do NOT call markAlsoCorrect. If incorrect: explain every error (grammar, vocabulary, word order, spelling/diacritics) concretely, quoting the exact words, and give the corrected form. If you spot a recurring error pattern, create 1-2 flashcards (createCard) with fresh example sentences that train exactly that pattern — otherwise create no cards for this reply, and never createCard the user's variant itself.${replyNote}`;
  }
}
