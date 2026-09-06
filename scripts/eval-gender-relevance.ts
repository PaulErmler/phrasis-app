/**
 * Benchmark: for which (sentence, language) pairs does the speaker's gender
 * change the wording at all, and can a cheap predictor tell in advance?
 *
 *   pnpm eval:gender-relevance --smoke
 *   pnpm eval:gender-relevance
 *   pnpm eval:gender-relevance --langs=ru,fr,ja --limit=10
 *
 * Ground truth by double generation: every sentence is translated through
 * the REAL production prompt and stage (`SOL_MINIMAL`, `buildPrompt` with
 * `requestedGender` male and then female). When the two renderings differ,
 * the judge (Gemini 3.8 Flash) says whether the difference is speaker
 * gender agreement or something else (sampling noise, a synonym). A pair is
 * "relevant" when it differs AND the judge attributes the difference to
 * gender. The noise rate (differs, not gender) is reported too: it is the
 * cost the generate-and-compare rule in production pays for unmarked
 * sentences.
 *
 * Two predictors are scored against that truth: a zero-cost heuristic
 * (language marks first person AND the English source has a first-person
 * subject) and a Gemini 3.1 Flash Lite prompt that sees the source and the
 * language's first-person note. Precision and recall per language decide
 * whether a pre-filter in front of generate-and-compare is worth adding.
 *
 * Cost: real billed USD, budget guard default $2, cache under
 * .scratch/gender-relevance-bench/. Key read from the environment by name.
 */

import { resolve } from 'node:path';
import { generateText } from 'ai';
import {
  buildPrompt,
  normalizeModelOutput,
  type TranslationPromptArgs,
} from '../convex/features/translationLLM';
import {
  getTranslationConfigForLanguage,
  SOL_MINIMAL,
} from '../lib/languages';
import { getFirstPersonConfig, languageMarksFirstPerson } from '../lib/languageForms';
import {
  argValue,
  Bench,
  createOpenRouterFromEnv,
  FLASH_JUDGE_MODEL,
  fmtUsd,
  pool,
  type CallTelemetry,
  type OpenRouterClient,
} from './eval/lib/bench';
import { openrouterCostUsd, openrouterGenerationId } from '../convex/lib/posthogAi';

// ------------------------------------------------------------------- config

const DEFAULT_LANGS = ['ru', 'fr', 'es', 'it', 'pl', 'he', 'ar', 'hi', 'th', 'ja', 'ko', 'pt', 'el', 'cs', 'de', 'zh'];
const PREDICTOR_MODEL = 'google/gemini-3.1-flash-lite';

/**
 * Sentences with a first-person subject (where marked languages should
 * differ), sentences without one (should never differ), and traps: a
 * first person that is not the subject of a gendered predicate, quoted
 * speech, a gendered third person.
 */
const CASES: { id: string; text: string; kind: 'first' | 'none' | 'trap' }[] = [
  { id: 'f1', text: "I'm tired.", kind: 'first' },
  { id: 'f2', text: 'I was at home yesterday.', kind: 'first' },
  { id: 'f3', text: "I'm ready to go.", kind: 'first' },
  { id: 'f4', text: 'I am a student.', kind: 'first' },
  { id: 'f5', text: 'I got lost in the city.', kind: 'first' },
  { id: 'f6', text: "I'm so happy to see you.", kind: 'first' },
  { id: 'f7', text: 'I was born in Berlin.', kind: 'first' },
  { id: 'f8', text: 'I am sure about it.', kind: 'first' },
  { id: 'f9', text: 'I have been sick all week.', kind: 'first' },
  { id: 'f10', text: 'I came home late.', kind: 'first' },
  { id: 'f11', text: 'I would like a coffee, please.', kind: 'first' },
  { id: 'f12', text: 'I am not hungry.', kind: 'first' },
  { id: 'n1', text: 'It is raining again.', kind: 'none' },
  { id: 'n2', text: 'The train leaves at nine.', kind: 'none' },
  { id: 'n3', text: 'Where is the station?', kind: 'none' },
  { id: 'n4', text: 'This soup is too salty.', kind: 'none' },
  { id: 'n5', text: 'Please close the window.', kind: 'none' },
  { id: 'n6', text: 'How much does this cost?', kind: 'none' },
  { id: 'n7', text: 'The museum is closed on Mondays.', kind: 'none' },
  { id: 'n8', text: 'Thank you very much.', kind: 'none' },
  { id: 'n9', text: 'Good morning, everyone.', kind: 'none' },
  { id: 'n10', text: 'They went to the beach.', kind: 'none' },
  { id: 't1', text: 'My sister is a doctor.', kind: 'trap' },
  { id: 't2', text: 'I think he is tired.', kind: 'trap' },
  { id: 't3', text: 'She told me: "I am tired."', kind: 'trap' },
  { id: 't4', text: 'Can you help me with this?', kind: 'trap' },
  { id: 't5', text: 'My name is Alex.', kind: 'trap' },
  { id: 't6', text: 'I like this song.', kind: 'trap' },
  { id: 't7', text: 'We are late.', kind: 'trap' },
  { id: 't8', text: 'I saw her at the market.', kind: 'trap' },
];

const OUT_DIR = resolve(__dirname, '../.scratch/gender-relevance-bench');
const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: Number(argValue(process.argv, 'budget') ?? 2),
  budgetHint: 're-run with fewer --langs or raise --budget',
});

// ------------------------------------------------------------------- calls

function promptArgs(lang: string, text: string, gender: 'male' | 'female'): TranslationPromptArgs {
  const config = getTranslationConfigForLanguage(lang);
  return {
    text,
    sourceLang: 'en',
    targetLang: lang,
    targetLangName: config.targetLangName,
    targetLangNativeName: config.targetLangNativeName,
    targetRegion: config.targetRegion,
    addressesSomeone: /\byou\b|\byour\b|\bplease\b|\?$/i.test(text),
    referentGender: 'male',
    requestedGender: gender,
  };
}

async function rawCall(
  openrouter: OpenRouterClient,
  key: string,
  model: string,
  prompt: string,
  role: string,
  providerOptions?: Record<string, Record<string, unknown>>,
): Promise<string | null> {
  const hit = bench.cache[key];
  if (hit) return hit.text;
  const startedAt = Date.now();
  let text: string | null = null;
  const telemetry: CallTelemetry[] = [];
  try {
    const res = await generateText({
      model: openrouter(model),
      prompt,
      temperature: 0,
      maxOutputTokens: 1_500,
      ...(providerOptions ? { providerOptions } : {}),
    });
    text = res.text;
    telemetry.push({
      model,
      inputTokens: res.usage.inputTokens ?? 0,
      outputTokens: res.usage.outputTokens ?? 0,
      costUsd: openrouterCostUsd(res.providerMetadata),
      latencyMs: Date.now() - startedAt,
      role,
      generationId: openrouterGenerationId(res.providerMetadata),
    });
  } catch (err) {
    console.warn(`  ${role} failed (${key}): ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
  bench.cache[key] = { text, telemetry };
  bench.recordSpend(telemetry);
  bench.save();
  return text;
}

async function translate(openrouter: OpenRouterClient, lang: string, id: string, text: string, gender: 'male' | 'female') {
  const args = promptArgs(lang, text, gender);
  const raw = await rawCall(
    openrouter,
    `tr|${lang}|${id}|${gender}`,
    SOL_MINIMAL.model,
    buildPrompt(args),
    'translate',
    { openrouter: { reasoning: { effort: SOL_MINIMAL.reasoning ?? 'minimal' } } },
  );
  return raw ? normalizeModelOutput(lang, raw) : null;
}

async function judgeDifference(openrouter: OpenRouterClient, lang: string, id: string, source: string, male: string, female: string): Promise<'gender' | 'other' | null> {
  const prompt = `Two translations of the same English sentence into ${getTranslationConfigForLanguage(lang).targetLangName} were produced, one for a male speaker and one for a female speaker.

English: ${source}
Male speaker: ${male}
Female speaker: ${female}

Do the two translations differ ONLY because the speaker's gender changes a first-person form (verb, adjective, participle, pronoun, self-reference word, or gender-dependent particle)? Answer with exactly one word: GENDER if every difference is speaker-gender agreement, OTHER if any difference is unrelated to the speaker's gender (a synonym, word order, a different reading).`;
  const raw = await rawCall(openrouter, `judge|${lang}|${id}`, FLASH_JUDGE_MODEL, prompt, 'judge');
  if (!raw) return null;
  return /\bGENDER\b/i.test(raw) && !/\bOTHER\b/i.test(raw) ? 'gender' : 'other';
}

async function predict(openrouter: OpenRouterClient, lang: string, id: string, text: string): Promise<boolean | null> {
  const config = getFirstPersonConfig(lang);
  const note = config
    ? `${config.intro} Example: "${config.exampleEn}" -> "${config.masculine}" (man) / "${config.feminine}" (woman).`
    : `${getTranslationConfigForLanguage(lang).targetLangName} does not change its wording with the speaker's gender.`;
  const prompt = `Will the ${getTranslationConfigForLanguage(lang).targetLangName} translation of this English sentence be worded differently depending on whether the SPEAKER is a man or a woman?

${note}

Sentence: ${text}

Consider only forms that refer to the speaker (first person). Gender of other people mentioned does not count. Answer with exactly one word: YES or NO.`;
  const raw = await rawCall(openrouter, `pred|${lang}|${id}`, PREDICTOR_MODEL, prompt, 'predictor');
  if (!raw) return null;
  return /\bYES\b/i.test(raw);
}

function heuristic(lang: string, text: string): boolean {
  return languageMarksFirstPerson(lang) && /\bI\b|\bI'm\b|\bI've\b|\bI'd\b|\bwe\b|\bwe're\b/i.test(text);
}

// -------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const smoke = argv.includes('--smoke');
  const langs = (argValue(argv, 'langs') ?? DEFAULT_LANGS.join(',')).split(',').filter(Boolean);
  const limit = argValue(argv, 'limit') ? Number(argValue(argv, 'limit')) : undefined;
  let cases = CASES;
  if (smoke) cases = cases.slice(0, 6);
  if (limit) cases = cases.slice(0, limit);
  const openrouter = createOpenRouterFromEnv('pnpm eval:gender-relevance');

  type Row = {
    lang: string;
    id: string;
    kind: string;
    relevant: boolean | null;
    differs: boolean;
    verdict: 'gender' | 'other' | null;
    heuristic: boolean;
    predictor: boolean | null;
    male: string | null;
    female: string | null;
  };
  const rows: Row[] = [];
  const jobs = langs.flatMap((lang) => cases.map((c) => ({ lang, c })));
  await pool(jobs, 4, async ({ lang, c }) => {
    const male = await translate(openrouter, lang, c.id, c.text, 'male');
    const female = await translate(openrouter, lang, c.id, c.text, 'female');
    const differs = male !== null && female !== null && male !== female;
    let verdict: 'gender' | 'other' | null = null;
    if (differs) verdict = await judgeDifference(openrouter, lang, c.id, c.text, male!, female!);
    const relevant = male === null || female === null ? null : differs && verdict === 'gender';
    const predictor = await predict(openrouter, lang, c.id, c.text);
    rows.push({ lang, id: c.id, kind: c.kind, relevant, differs, verdict, heuristic: heuristic(lang, c.text), predictor, male, female });
  });

  const lines: string[] = [];
  const out = (line = '') => {
    lines.push(line);
    console.log(line);
  };
  out(`\nGender relevance, ${rows.length} pairs, truth = double generation on ${SOL_MINIMAL.model} judged by ${FLASH_JUDGE_MODEL}`);
  out(`${'lang'.padEnd(8)} ${'relevant'.padEnd(9)} ${'noise'.padEnd(7)} ${'heur P/R'.padEnd(12)} ${'pred P/R'.padEnd(12)} first-person relevant`);
  const prf = (list: Row[], pick: (r: Row) => boolean | null) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const r of list) {
      if (r.relevant === null) continue;
      const p = pick(r);
      if (p === null) continue;
      if (p && r.relevant) tp++;
      else if (p && !r.relevant) fp++;
      else if (!p && r.relevant) fn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : 1;
    const recall = tp + fn ? tp / (tp + fn) : 1;
    return `${(100 * precision).toFixed(0)}/${(100 * recall).toFixed(0)}`;
  };
  for (const lang of langs) {
    const list = rows.filter((r) => r.lang === lang);
    const relevant = list.filter((r) => r.relevant).length;
    const noise = list.filter((r) => r.differs && r.verdict === 'other').length;
    const first = list.filter((r) => r.kind === 'first');
    const firstRelevant = first.filter((r) => r.relevant).length;
    out(
      `${lang.padEnd(8)} ${String(relevant).padEnd(9)} ${String(noise).padEnd(7)} ${prf(list, (r) => r.heuristic).padEnd(12)} ${prf(list, (r) => r.predictor).padEnd(12)} ${firstRelevant}/${first.length}`,
    );
  }
  out('\n== unexpected: "none" sentences that came out relevant, and first-person sentences that did not (marked languages) ==');
  for (const r of rows) {
    if (r.kind === 'none' && r.relevant) out(`  ${r.lang} ${r.id}: ${r.male} | ${r.female}`);
    if (r.kind === 'first' && r.relevant === false && languageMarksFirstPerson(r.lang)) out(`  ${r.lang} ${r.id} unmarked: ${r.male}`);
  }
  out(`\nSpent ${fmtUsd(bench.spentUsd)} this run.`);
  bench.writeReport(lines, { rows });
}

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
