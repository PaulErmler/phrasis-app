/**
 * Benchmark: does the production translation prompt render a sentence in
 * the REQUESTED politeness form and speaker gender, and which wording of
 * the request works better?
 *
 *   pnpm eval:adherence --smoke
 *   pnpm eval:adherence                       (ja, ko first, then the rest)
 *   pnpm eval:adherence --langs=ja,ko --arms=baseline,product
 *
 * Arms:
 *   baseline    today's prompt with no request: the text's own metadata
 *               (no register for a sentence without a "you"), which is what
 *               every shared rendering was generated under. Its per-form
 *               numbers are the Japanese/Korean "leans casual" baseline.
 *   product     `requestedForm` / `requestedGender` with the app's wording
 *               (lib/languageForms.ts prompt text, promptWording 'product').
 *   literature  the same request phrased with the linguistics terms (speech
 *               level, T-V distinction, speaker gender agreement).
 *
 * For every language each distinct politeness form is requested once per
 * sentence, and for first-person-marking languages each gender once. Two
 * signals: a mechanical surface check per form (です/ます endings, -요 vs
 * -습니다, Sie/du, vous/tu, вы/ты, usted/tú, आप/तुम, ครับ/ค่ะ) where one
 * exists, and the judge (Gemini 3.8 Flash) scoring 0-10 "in the requested
 * form and gender, natural, meaning kept". Real production `buildPrompt`
 * and the `SOL_MINIMAL` stage. Budget guard default $3; cache under
 * .scratch/adherence-bench/. Key read from the environment by name.
 */

import { resolve } from 'node:path';
import { generateText } from 'ai';
import {
  buildPrompt,
  normalizeModelOutput,
  requestedFormInstruction,
  type TranslationPromptArgs,
} from '../convex/features/translationLLM';
import { getTranslationConfigForLanguage, SOL_MINIMAL } from '../lib/languages';
import {
  distinctPolitenessForms,
  getFirstPersonConfig,
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
  judgeCandidates,
  pool,
  seededShuffle,
  type CallTelemetry,
  type OpenRouterClient,
} from './eval/lib/bench';
import { openrouterCostUsd, openrouterGenerationId } from '../convex/lib/posthogAi';

// ------------------------------------------------------------------- config

const DEFAULT_LANGS = ['ja', 'ko', 'de', 'fr', 'ru', 'es', 'hi', 'th', 'pl', 'vi'];
const ARMS = ['baseline', 'product', 'literature'] as const;
type Arm = (typeof ARMS)[number];

type Case = { id: string; text: string; addresses: boolean; first: boolean };
const CASES: Case[] = [
  { id: 'a1', text: 'Are you coming tonight?', addresses: true, first: false },
  { id: 'a2', text: 'Could you open the window, please?', addresses: true, first: false },
  { id: 'a3', text: 'Where do you live?', addresses: true, first: false },
  { id: 'a4', text: 'Thank you for your help.', addresses: true, first: false },
  { id: 'a5', text: 'Do you want a coffee?', addresses: true, first: false },
  { id: 'a6', text: 'Please wait here a moment.', addresses: true, first: false },
  { id: 'd1', text: 'It is raining again.', addresses: false, first: false },
  { id: 'd2', text: 'The train leaves at nine.', addresses: false, first: false },
  { id: 'd3', text: 'This restaurant is very good.', addresses: false, first: false },
  { id: 'd4', text: 'The meeting was cancelled.', addresses: false, first: false },
  { id: 'f1', text: "I'm tired.", addresses: false, first: true },
  { id: 'f2', text: 'I was at home yesterday.', addresses: false, first: true },
  { id: 'f3', text: 'I eat breakfast every day.', addresses: false, first: true },
  { id: 'f4', text: "I'm ready to go.", addresses: false, first: true },
  { id: 'f5', text: 'I will call you tomorrow.', addresses: true, first: true },
];

/** Surface checks per language and form id. `null` = no mechanical signal. */
const CHECKS: Record<string, Record<string, (text: string) => boolean>> = {
  ja: {
    plain: (t) => !/(です|ます|ません|ました|でした|ましょう|ください)[。！？!?]*$/.test(t.trim()),
    'desu-masu': (t) => /(です|ます|ません|ました|でした|ましょう|ください)[。！？!?]*$/.test(t.trim()) && !/(いたし|ござい|おり|いただ|くださ|なさ)/.test(t),
    keigo: (t) => /(いたし|ござい|おり|いただ|くださ|なさ|ご.+?ください|お.+?ください)/.test(t),
  },
  ko: {
    banmal: (t) => !/(요|습니다|ㅂ니다|습니까|십시오)[.!?]*$/.test(t.trim()),
    haeyo: (t) => /요[.!?]*$/.test(t.trim()),
    hapsyo: (t) => /(습니다|ㅂ니다|습니까|십시오|세요)[.!?]*$/.test(t.trim()) && !/요[.!?]*$/.test(t.trim()),
  },
  de: {
    t: (t) => /\b(du|dich|dir|dein|deine|deinen|deiner|kommst|willst|kannst|wohnst)\b/i.test(t) && !/\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/.test(t),
    v: (t) => /\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/.test(t),
  },
  fr: {
    t: (t) => /\b(tu|toi|te|ton|ta|tes|t')\b/i.test(t) && !/\bvous\b/i.test(t),
    v: (t) => /\bvous\b/i.test(t),
  },
  ru: {
    t: (t) => /\b(ты|тебя|тебе|тобой|твой|твоя|твои)\b/i.test(t) && !/\b(вы|вас|вам|вами|ваш|ваша|ваши)\b/i.test(t),
    v: (t) => /\b(вы|вас|вам|вами|ваш|ваша|ваши)\b/i.test(t) || /(ите|ете|ёте)\b/.test(t),
  },
  es: {
    t: (t) => !/\busted\b/i.test(t),
    v: (t) => /\busted\b/i.test(t),
  },
  hi: {
    t: (t) => /तुम/.test(t) && !/आप/.test(t),
    v: (t) => /आप/.test(t),
  },
  th: {
    plain: (t) => !/(ครับ|ค่ะ|คะ)/.test(t),
    particle: (t) => /(ครับ|ค่ะ|คะ)/.test(t),
  },
  vi: {
    peer: (t) => !/\bạ\b/i.test(t),
    respectful: (t) => /\bạ\b/i.test(t) || /\b(anh|chị|em)\b/i.test(t),
  },
};

const OUT_DIR = resolve(__dirname, '../.scratch/adherence-bench');
const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: Number(argValue(process.argv, 'budget') ?? 3),
  budgetHint: 're-run with fewer --langs/--arms or raise --budget',
});

// ------------------------------------------------------------------- calls

type Request = { form?: PolitenessForm; gender?: 'male' | 'female' };

function promptArgs(lang: string, c: Case, arm: Arm, req: Request): TranslationPromptArgs {
  const config = getTranslationConfigForLanguage(lang);
  const base: TranslationPromptArgs = {
    text: c.text,
    sourceLang: 'en',
    targetLang: lang,
    targetLangName: config.targetLangName,
    targetLangNativeName: config.targetLangNativeName,
    targetRegion: config.targetRegion,
    addressesSomeone: c.addresses,
    referentGender: 'male',
  };
  if (arm === 'baseline') return base;
  return {
    ...base,
    requestedForm: req.form ? { id: req.form.id, label: req.form.label, prompt: req.form.prompt } : undefined,
    requestedGender: req.gender,
    promptWording: arm,
  };
}

async function translate(openrouter: OpenRouterClient, key: string, args: TranslationPromptArgs): Promise<string | null> {
  const hit = bench.cache[key];
  if (hit) return hit.text;
  const startedAt = Date.now();
  let text: string | null = null;
  const telemetry: CallTelemetry[] = [];
  try {
    const res = await generateText({
      model: openrouter(SOL_MINIMAL.model),
      prompt: buildPrompt(args),
      temperature: 0,
      maxOutputTokens: 1_500,
      providerOptions: { openrouter: { reasoning: { effort: SOL_MINIMAL.reasoning ?? 'minimal' } } },
    });
    text = normalizeModelOutput(args.targetLang, res.text);
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
    console.warn(`  translate failed (${key}): ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
  bench.cache[key] = { text, telemetry };
  bench.recordSpend(telemetry);
  bench.save();
  return text;
}

function judgePrompt(lang: string, c: Case, req: Request, candidates: string[]): string {
  const name = getTranslationConfigForLanguage(lang).targetLangName;
  const want = requestedFormInstruction({
    requestedForm: req.form ? { id: req.form.id, label: req.form.label, prompt: req.form.prompt } : undefined,
    requestedGender: req.gender,
  }).join(' ');
  return `You are a strict ${name} language examiner. An English sentence was translated into ${name} under this requirement:

${want}

English: ${c.text}

Score each candidate from 0 to 10: 10 = fully in the required form (and gender, when one is required), natural, meaning kept; 5 = form partly right or unnatural; 0 = wrong form, wrong gender, or wrong meaning. A sentence that cannot show the required form in ${name} (no addressee, no first person) scores 10 when it is natural and correct.

Candidates:
${candidates.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Output only a JSON array of ${candidates.length} integers, one per candidate, in order.`;
}

// -------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const smoke = argv.includes('--smoke');
  const langs = (argValue(argv, 'langs') ?? DEFAULT_LANGS.join(',')).split(',').filter(Boolean);
  const arms = ((argValue(argv, 'arms') ?? ARMS.join(',')).split(',').filter(Boolean)) as Arm[];
  let cases = smoke ? CASES.filter((c) => ['a1', 'd1', 'f1'].includes(c.id)) : CASES;
  const limit = argValue(argv, 'limit') ? Number(argValue(argv, 'limit')) : undefined;
  if (limit) cases = cases.slice(0, limit);
  const openrouter = createOpenRouterFromEnv('pnpm eval:adherence');

  type Job = { lang: string; c: Case; req: Request; reqKey: string };
  const jobs: Job[] = [];
  for (const lang of langs) {
    const forms = distinctPolitenessForms(lang).map((d) => d.form);
    for (const c of cases) {
      for (const form of forms) jobs.push({ lang, c, req: { form }, reqKey: `form:${form.id}` });
      if (languageMarksFirstPerson(lang) && c.first) {
        for (const gender of ['male', 'female'] as const) jobs.push({ lang, c, req: { gender }, reqKey: `gender:${gender}` });
      }
    }
  }

  type Result = { lang: string; c: Case; reqKey: string; arm: Arm; text: string | null; mech: boolean | null; score: number | null };
  const results: Result[] = [];
  await pool(jobs, 4, async (job) => {
    const outputs = new Map<Arm, string | null>();
    for (const arm of arms) {
      const key = `tr|${arm}|${job.lang}|${job.c.id}|${job.reqKey}`;
      outputs.set(arm, await translate(openrouter, key, promptArgs(job.lang, job.c, arm, job.req)));
    }
    const candidates = [...new Set([...outputs.values()].filter((t): t is string => t !== null))];
    const judgeKey = `judge|${job.lang}|${job.c.id}|${job.reqKey}`;
    let scores: Record<string, number> = {};
    if (candidates.length > 0) {
      if (bench.hasJudgedAll(judgeKey, candidates)) {
        scores = bench.judgeScores(judgeKey);
      } else {
        const shuffled = seededShuffle(candidates, judgeKey);
        const outcome = await judgeCandidates(bench, openrouter, judgePrompt(job.lang, job.c, job.req, shuffled), shuffled, judgeKey, FLASH_JUDGE_MODEL);
        if (outcome) {
          bench.storeJudge(judgeKey, outcome);
          scores = outcome.scores;
        }
      }
    }
    for (const arm of arms) {
      const text = outputs.get(arm) ?? null;
      const check = job.req.form ? CHECKS[job.lang]?.[job.req.form.id] : undefined;
      const mech = text !== null && check ? check(text) : null;
      results.push({ lang: job.lang, c: job.c, reqKey: job.reqKey, arm, text, mech, score: text !== null ? (scores[text] ?? null) : null });
    }
  });

  const lines: string[] = [];
  const out = (line = '') => {
    lines.push(line);
    console.log(line);
  };
  out(`\nAdherence, ${jobs.length} requests x ${arms.length} arms, stage ${SOL_MINIMAL.model}, judge ${FLASH_JUDGE_MODEL}`);
  out(`${'lang'.padEnd(6)} ${'request'.padEnd(18)} ${'arm'.padEnd(11)} ${'mech pass'.padEnd(11)} ${'judge mean'.padEnd(11)} n`);
  for (const lang of langs) {
    const reqKeys = [...new Set(results.filter((r) => r.lang === lang).map((r) => r.reqKey))];
    for (const reqKey of reqKeys) {
      for (const arm of arms) {
        const list = results.filter((r) => r.lang === lang && r.reqKey === reqKey && r.arm === arm);
        const mech = list.filter((r) => r.mech !== null);
        const mechPass = mech.length ? `${((100 * mech.filter((r) => r.mech).length) / mech.length).toFixed(0)}%` : '-';
        const scored = list.filter((r) => r.score !== null);
        const mean = scored.length ? (scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length).toFixed(1) : '-';
        out(`${lang.padEnd(6)} ${reqKey.padEnd(18)} ${arm.padEnd(11)} ${mechPass.padEnd(11)} ${mean.padEnd(11)} ${list.length}`);
      }
    }
  }
  out('\n== worst cases (judge <= 4, non-baseline) ==');
  for (const r of results) {
    if (r.arm !== 'baseline' && r.score !== null && r.score <= 4) out(`  ${r.lang} ${r.c.id} ${r.reqKey} ${r.arm}: ${r.text}`);
  }
  out(`\nSpent ${fmtUsd(bench.spentUsd)} this run.`);
  bench.writeReport(lines, { results });
}

// Keep the config imports honest for languages without a politeness config
// (the loop above simply requests nothing for them).
void getPolitenessConfig;
void getFirstPersonConfig;

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
