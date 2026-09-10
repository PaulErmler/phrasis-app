/**
 * TEMPORARY prototype — "a story every 30 curriculum sentences", built from
 * the sentences the learner has actually met rather than from sampled words.
 * Not wired into the app; delete when the question is answered.
 *
 *   pnpm tsx --env-file=.env.local scripts/story-curriculum-prototype.ts --dry
 *   pnpm tsx --env-file=.env.local scripts/story-curriculum-prototype.ts
 *   pnpm tsx --env-file=.env.local scripts/story-curriculum-prototype.ts --levels=09,15
 *   pnpm tsx --env-file=.env.local scripts/story-curriculum-prototype.ts --motivations=work
 *
 * Five levels (pre-A1, A1-, B1, C1, C2) × three stated reasons for learning
 * (work / free time and family / travel) = fifteen stories, four calls deep
 * each, run four at a time.
 *
 * Three stages, all on the same cheap model, all at `high` reasoning:
 *   1. WRITE    — every English sentence learned so far goes in; out comes a
 *                 scene-setting line and a 3–6 turn conversation built from
 *                 that vocabulary. Original speech, not the drilled sentences
 *                 pasted back.
 *   2. CRITIQUE — the story ALONE, with no vocabulary list and no idea a
 *                 constraint exists, goes to a second call that only hunts for
 *                 what reads wrong.
 *   3. REVISE   — the vocabulary, the task, the draft and the critique go to a
 *                 third call, which fixes what is real and keeps the rule.
 *
 * Scores every stage mechanically: words the learner has never met, and
 * sentences reproduced verbatim from the curriculum. Prices each call from
 * OpenRouter's usage accounting (real billed USD).
 *
 * Writes .scratch/story-curriculum/pipeline.json.
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import { openrouterCallOptions } from '../convex/features/translationLLM';
import { exampleBlock } from './story-examples';
import { tokenizeText } from '../lib/wordTokenize';

// ------------------------------------------------------------------ config

const MODEL = 'meta/muse-spark-1.3-contributor';
/** Muse Spark rejects a disabled-reasoning request ("Reasoning is mandatory
 *  for this endpoint"), so `minimal` is its floor and `high` its ceiling. */
const REASONING = 'low' as const;
/** Headroom for the answer AFTER thinking. `high` spends thousands of tokens
 *  reasoning about a 30-word dialogue; a 4k cap came back truncated. */
const MAX_OUTPUT_TOKENS = 32_000;

/** One story per this many drilled sentences. */
const STORY_EVERY = 30;

const DATASET = resolve(
  __dirname,
  '../data_preparation/ogte-dataset/data/output/levels_curated/final/ogte_curated_all.jsonl',
);
const OUT_DIR = resolve(__dirname, '../.scratch/story-curriculum');

/** OGTE level → CEFR, from data/output/ogte_cefr_mapping.csv. */
const LEVELS: Record<string, { label: string; cefr: string }> = {
  '01': { label: 'Alphabet', cefr: 'pre-A1' },
  '02': { label: 'Early-beginner', cefr: 'A1-' },
  '09': { label: 'Mid-intermediate', cefr: 'B1' },
  '15': { label: 'Mid-advanced', cefr: 'C1' },
  '18': { label: 'Mid-near-native', cefr: 'C2' },
};
const SLOT_LEVELS = ['01', '02', '09', '15', '18'] as const;

/**
 * What the learner said they are learning the language FOR, in the words the
 * onboarding question collects. Every story is written to one of them, so the
 * same slot can be compared across three different reasons.
 */
const MOTIVATIONS = {
  work: {
    label: 'Work',
    line: 'for their work',
  },
  family: {
    label: 'Free time & family',
    line: 'for their free time and their family',
  },
  travel: {
    label: 'Travel',
    line: 'for travelling',
  },
} as const;
type MotivationKey = keyof typeof MOTIVATIONS;

const DRY = process.argv.includes('--dry');
const ONLY = process.argv
  .find((a) => a.startsWith('--levels='))
  ?.split('=')[1]
  .split(',');
/**
 * Explicit sentence counts, overriding the per-level slots. Used to render one
 * learner's opening run — `--slots=30,60,90,...` is their first ten stories.
 */
const EXPLICIT_SLOTS = process.argv
  .find((a) => a.startsWith('--slots='))
  ?.split('=')[1]
  .split(',')
  .map(Number);
const ONLY_MOTIVATIONS = process.argv
  .find((a) => a.startsWith('--motivations='))
  ?.split('=')[1]
  .split(',') as MotivationKey[] | undefined;
/** Stories run concurrently; the three stages within one story do not. */
const CONCURRENCY = 16;

// ------------------------------------------------------------------ dataset

type Row = { id: string; text: string; ogte_level: string; arc_id: string };

/** Curriculum order, with the unordered "99 / unlisted" tail dropped. */
function loadCurriculum(): Row[] {
  return readFileSync(DATASET, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.ogte_level !== '99');
}

/** First multiple of STORY_EVERY at or after the level's first sentence. */
function firstSlotInLevel(rows: Row[], level: string): number {
  const start = rows.findIndex((r) => r.ogte_level === level) + 1;
  return Math.ceil(start / STORY_EVERY) * STORY_EVERY;
}

// ------------------------------------------------------------------- prompts

type Turn = { speaker: string; line: string };
type Story = { title: string; scene: string; turns: Turn[] };
type Issue = { quote: string; problem: string };
type Critique = { verdict?: string; issues: Issue[]; overall: string };

const SHAPE =
  '{"title": "...", "scene": "one sentence", ' +
  '"turns": [{"speaker": "female"|"male", "line": "..."}]}';

/** The vocabulary block both the writer and the reviser see. */
function vocabularyBlock(learned: string[]): string {
  const recent = learned.slice(-STORY_EVERY);
  const older = learned.slice(0, -STORY_EVERY);
  return [
    'Below are all the sentences this learner has already learned, in the',
    'order they learned them. The sentences that come later are the ones they',
    'learned most recently.',
    '',
    ...(older.length
      ? ['<learned_earlier>', ...older, '</learned_earlier>', '']
      : []),
    '<learned_most_recently>',
    ...recent,
    '</learned_most_recently>',
  ].join('\n');
}

/** The brief both the writer and the reviser work to. */
const brief = (motivation: MotivationKey) => [
  'This learner told us why they are learning the language: ' +
    `${MOTIVATIONS[motivation].line}. Put the conversation somewhere a person`,
  'with that reason would actually find themselves, and let it shape the whole',
  'scene rather than get a passing mention.',
  '',
  'Write a short conversation between two people that this learner could',
  'read without meeting a single new word.',
  '',
  'The rules, in order of importance:',
  '',
  '1. Every word must be one the learner has already met. A word counts as',
  '   met only if it appears, in that exact form, somewhere in the sentences',
  '   above. This rule is absolute — breaking it ruins the exercise.',
  '2. Write natural speech. The learned sentences are your vocabulary, not',
  '   your script: do not reuse them as lines, and do not paste them',
  '   together. Recombine their words into an exchange of your own, the way',
  '   two people actually talk — they interrupt, they answer what was asked,',
  '   they leave things unsaid.',
  '3. Lean on the most recently learned vocabulary, so the learner feels the',
  '   ground they have just covered. Older vocabulary is welcome around it.',
  '4. At least three turns, at most six. One to three sentences per turn.',
  '5. One coherent scene with a single theme: something is at stake when it',
  '   opens and is settled by the time it closes. Not a list of remarks.',
  '6. The speakers are a woman and a man, but nothing in what they say may',
  '   depend on which is which.',
  '',
  'Before the conversation, write ONE sentence that sets the scene — who is',
  'talking and where, or what has just happened. It obeys rule 1 too.',
  '',
  'Here are dialogues of the kind you are aiming at. Do not copy their words —',
  'their vocabulary is far beyond this learner. Copy how they behave: an',
  'ordinary situation, short turns, a question that gets answered, someone',
  'wanting something, a natural way in and a natural way out.',
  '',
  exampleBlock(),
];

function writePrompt(learned: string[], motivation: MotivationKey): string {
  return [
    'You are a professional author and storyteller, and a language teacher.',
    'You are helping a language learner see the progress they have made in',
    'their vocabulary.',
    '',
    vocabularyBlock(learned),
    '',
    ...brief(motivation),
    '',
    `Answer with JSON and nothing else: ${SHAPE}`,
  ].join('\n');
}

/** Stage 2 sees the story and nothing else — no vocabulary, no brief. */
function critiquePrompt(story: Story): string {
  return [
    'You are a sharp editor with a good ear for dialogue.',
    '',
    'This is the standard. Dialogues of this kind are what "good" means here —',
    'an ordinary situation, short turns, a question that gets answered, a',
    'natural way in and a natural way out:',
    '',
    exampleBlock(),
    '',
    'Below is a short scene. First say whether it is a good story by that',
    'standard. Then say everything that is wrong with it: phrasing no',
    'real person would use, a reply that does not answer what was asked, a',
    'non-sequitur, a scene-setting line that does not fit what follows, a',
    'theme that falls apart, an ending that settles nothing. Quote the exact',
    'words and say what is wrong with them. Do not rewrite anything.',
    '',
    'If a passage genuinely works, leave it alone. Finding nothing wrong is a',
    'valid answer; inventing a complaint is not.',
    '',
    `<title>${story.title}</title>`,
    `<scene>${story.scene}</scene>`,
    ...story.turns.map((t) => `<${t.speaker}>${t.line}</${t.speaker}>`),
    '',
    'Answer with JSON and nothing else. `verdict` is "good" if it belongs',
    'beside the examples above, "weak" if it does not, "middling" in between:',
    '{"verdict": "good"|"middling"|"weak", "overall": "...", ' +
      '"issues": [{"quote": "...", "problem": "..."}]}',
  ].join('\n');
}

/** Stage 3 gets everything: vocabulary, brief, draft, and the editor's notes. */
function revisePrompt(
  learned: string[],
  motivation: MotivationKey,
  story: Story,
  critique: Critique,
): string {
  return [
    'You are a professional author and storyteller, and a language teacher.',
    'You are helping a language learner see the progress they have made in',
    'their vocabulary.',
    '',
    vocabularyBlock(learned),
    '',
    ...brief(motivation),
    '',
    'Here is the draft you wrote:',
    `<title>${story.title}</title>`,
    `<scene>${story.scene}</scene>`,
    ...story.turns.map((t) => `<${t.speaker}>${t.line}</${t.speaker}>`),
    '',
    'An editor read it, holding it against published ESL dialogues. The editor',
    'did NOT know about the vocabulary rule and was not told what the piece is',
    'for, so some notes will ask for words this learner has never met. Here is',
    'what they said:',
    `<verdict>${critique.verdict ?? 'unstated'}</verdict>`,
    `<overall>${critique.overall}</overall>`,
    ...critique.issues.map(
      (i) => `<note quote="${i.quote.replace(/"/g, "'")}">${i.problem}</note>`,
    ),
    '',
    'Rewrite the scene. Fix every note that is right. Where a note can only be',
    'answered with a word the learner has not met, solve it a different way —',
    'cut the line, change the situation, let someone say less. Where a note is',
    'simply wrong, ignore it. Rule 1 still binds absolutely.',
    '',
    `Answer with JSON and nothing else: ${SHAPE}`,
  ].join('\n');
}

/** Models fence their JSON as often as not. */
function parseJson<T>(raw: string): T {
  const body = raw.trim().replace(/^```(?:json)?/i, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return JSON.parse(body.slice(start, end + 1)) as T;
}

// -------------------------------------------------------------------- score

const words = (text: string) =>
  tokenizeText(text, 'en').map((t) => t.normalized);

const bareSentence = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const sentences = (text: string) =>
  text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

type Score = {
  storyWords: number;
  unknownInDialogue: string[];
  unknownInScene: string[];
  verbatimSentences: number;
  totalSentences: number;
  recentWordsUsed: number;
  recentVocabSize: number;
  turns: number;
};

function score(story: Story, learned: string[]): Score {
  const known = new Set(learned.flatMap(words));
  const recent = new Set(learned.slice(-STORY_EVERY).flatMap(words));
  const knownSentences = new Set(learned.map(bareSentence));
  const dialogue = story.turns.flatMap((t) => words(t.line));
  const unique = [...new Set(dialogue)];
  const all = [story.scene, ...story.turns.map((t) => t.line)].flatMap(
    sentences,
  );
  return {
    storyWords: dialogue.length,
    unknownInDialogue: unique.filter((w) => !known.has(w)),
    unknownInScene: [...new Set(words(story.scene))].filter(
      (w) => !known.has(w),
    ),
    verbatimSentences: all.filter((s) => knownSentences.has(bareSentence(s)))
      .length,
    totalSentences: all.length,
    recentWordsUsed: unique.filter((w) => recent.has(w)).length,
    recentVocabSize: recent.size,
    turns: story.turns.length,
  };
}

// --------------------------------------------------------------------- main

type Call = {
  costUsd?: number;
  generationId?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

type Result = {
  level: string;
  levelLabel: string;
  cefr: string;
  motivation: MotivationKey;
  motivationLabel: string;
  slot: number;
  contextSentences: number;
  knownVocab: number;
  recent30: string[];
  draft: Story;
  draftScore: Score;
  critique: Critique;
  final: Story;
  finalScore: Score;
  calls: { write: Call; critique: Call; revise: Call };
};

/** Runs `jobs` with at most `limit` in flight, preserving input order. */
async function pool<T>(
  jobs: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, () =>
    (async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        out[i] = await jobs[i]();
      }
    })(),
  );
  await Promise.all(workers);
  return out;
}

async function main() {
  const rows = loadCurriculum();
  const levels = EXPLICIT_SLOTS
    ? EXPLICIT_SLOTS.map((slot) => ({
        level: rows[Math.min(slot, rows.length) - 1].ogte_level,
        slot,
      }))
    : SLOT_LEVELS.filter((l) => !ONLY || ONLY.includes(l)).map((level) => ({
        level,
        slot: firstSlotInLevel(rows, level),
      }));
  const motivations = (
    Object.keys(MOTIVATIONS) as MotivationKey[]
  ).filter((m) => !ONLY_MOTIVATIONS || ONLY_MOTIVATIONS.includes(m));

  console.log(`curriculum: ${rows.length} English sentences`);
  for (const { level, slot } of levels) {
    const learned = rows.slice(0, slot);
    const chars = learned.reduce((n, r) => n + r.text.length, 0);
    console.log(
      `  L${level} ${(LEVELS[level]?.cefr ?? level).padEnd(6)} slot ${String(slot).padStart(5)} — ` +
        `${chars} context chars, ` +
        `${new Set(learned.flatMap((r) => words(r.text))).size} known words`,
    );
  }
  console.log(
    `${levels.length} levels × ${motivations.length} reasons = ` +
      `${levels.length * motivations.length} stories, ${CONCURRENCY} at a time`,
  );
  if (DRY) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const openrouter = createOpenRouter({
    apiKey,
    extraBody: { usage: { include: true } },
  });
  const providerOptions = openrouterCallOptions(REASONING);

  let spendUsd = 0;
  const callOnce = async (prompt: string): Promise<[string, Call]> => {
    const res = await generateText({
      model: openrouter(MODEL),
      prompt,
      temperature: 0.7,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const cost = openrouterCostUsd(res.providerMetadata);
    spendUsd += cost ?? 0;
    return [
      res.text,
      {
        costUsd: cost,
        generationId: openrouterGenerationId(res.providerMetadata),
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
        reasoningTokens: res.usage?.reasoningTokens,
      },
    ];
  };

  /**
   * One retry, because the only failure seen so far is a model that thinks
   * past its output cap and returns JSON cut off mid-object. A second draw at
   * temperature 0.7 is a different sample, not the same one again.
   */
  const call = async <T>(prompt: string): Promise<[T, Call]> => {
    const [raw, meta] = await callOnce(prompt);
    try {
      return [parseJson<T>(raw), meta];
    } catch {
      const [raw2, meta2] = await callOnce(prompt);
      return [
        parseJson<T>(raw2),
        { ...meta2, costUsd: (meta.costUsd ?? 0) + (meta2.costUsd ?? 0) },
      ];
    }
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const OUT_FILE = resolve(
    OUT_DIR,
    EXPLICIT_SLOTS ? 'pipeline-first10.json' : `pipeline-${REASONING}.json`,
  );
  /**
   * Rewritten after every finished story, not once at the end: a run of this
   * length is worth watching, and a kill halfway through should not throw
   * away the stories that already came back.
   */
  const done: Result[] = [];
  const flush = (rs: Result[] = done) =>
    writeFileSync(
      OUT_FILE,
      JSON.stringify(
        { model: MODEL, reasoning: REASONING, spendUsd, results: rs },
        null,
        2,
      ),
    );

  const jobs = levels.flatMap(({ level, slot }) =>
    motivations.map((motivation) => async (): Promise<Result | undefined> => {
      const tag = `L${level}/${motivation}`;
      const learned = rows.slice(0, slot).map((r) => r.text);
      try {
        const [draft, writeCall] = await call<Story>(
          writePrompt(learned, motivation),
        );
        const draftScore = score(draft, learned);

        const [critique, critCall] = await call<Critique>(
          critiquePrompt(draft),
        );

        const [final, revCall] = await call<Story>(
          revisePrompt(learned, motivation, draft, critique),
        );
        const finalScore = score(final, learned);

        const cost =
          (writeCall.costUsd ?? 0) +
          (critCall.costUsd ?? 0) +
          (revCall.costUsd ?? 0);
        console.log(
          `${tag.padEnd(12)} draft ${draftScore.turns}t/${draftScore.unknownInDialogue.length} unseen → ` +
            `${critique.verdict ?? '?'}/${critique.issues.length} issues → final ${finalScore.turns}t/` +
            `${finalScore.unknownInDialogue.length} unseen  $${cost.toFixed(5)}`,
        );

        const result: Result = {
          level,
          levelLabel: LEVELS[level]?.label ?? level,
          cefr: LEVELS[level]?.cefr ?? level,
          motivation,
          motivationLabel: MOTIVATIONS[motivation].label,
          slot,
          contextSentences: learned.length,
          knownVocab: new Set(learned.flatMap(words)).size,
          recent30: learned.slice(-STORY_EVERY),
          draft,
          draftScore,
          critique,
          final,
          finalScore,
          calls: { write: writeCall, critique: critCall, revise: revCall },
        };
        done.push(result);
        flush();
        return result;
      } catch (err) {
        console.log(
          `${tag.padEnd(12)} FAILED — ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`,
        );
        return undefined;
      }
    }),
  );

  const settled = await pool(jobs, CONCURRENCY);
  const results = settled.filter((r): r is Result => r !== undefined);
  flush(results);
  console.log(
    `\n${results.length}/${jobs.length} stories · total billed: $${spendUsd.toFixed(5)}`,
  );
  console.log('wrote', OUT_FILE);
}

void main();
