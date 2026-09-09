/**
 * Spike: can the `ar_lev` recipe produce Swiss German?
 *
 *   pnpm eval:swiss                 # 20 sentences, both conditions, judge + audio
 *   pnpm eval:swiss --n=20 --seed=round-1
 *   pnpm eval:swiss --no-audio      # translations + judging only
 *   pnpm eval:swiss --no-judge      # translations + mechanical checks only
 *
 * Levantine Arabic has no locale of its own anywhere in the stack. It runs on
 * the shared/global Arabic Gemini voice (`ar-001`) with the dialect named in
 * the TTS "## Instruction" block via `ttsPromptName`, and it translates
 * through the ordinary prompt with `translationName: 'Levantine Arabic'` plus
 * a region label. Nothing else. This script applies exactly that recipe to
 * Swiss German: the German TTS voice on `de-DE`, "Swiss German" named in the
 * prompt, and a translation config of
 * (`Swiss German`, `Schwiizerdütsch`, `German-speaking Switzerland (Zurich)`).
 *
 * Nothing in lib/languages.ts is touched: the config is inlined here, so this
 * measures the recipe before anyone pays for a language entry.
 *
 * Conditions (both through the real `buildPrompt` / `translateTextWithLLM`):
 *   de     — the production Standard German config. The baseline: what the
 *            pipeline says today, and the control that shows the judge
 *            actually discriminates dialect from standard.
 *   de_ch  — the ar_lev-style Swiss config above.
 *
 * Signals, three of them, because an LLM judging a low-resource dialect is
 * not evidence on its own:
 *   1. Mechanical markers. Swiss German has no ß, no simple past ("war",
 *      "ging"), and shifts Germanic /k/ to /x/ (Kind → Chind). A candidate
 *      carrying Standard-German-only tokens is Standard German with a
 *      costume on, whatever a judge says.
 *   2. Gemini 3.1 Pro scores every candidate 0-10 for both conditions, blind
 *      to which produced it (candidates are shuffled per item).
 *   3. A separate per-sentence critique pass over the Swiss outputs only,
 *      which returns a verdict + a corrected sentence for each, so the
 *      failures are readable rather than a number.
 *
 * Audio: the 20 Swiss sentences through Gemini TTS on `de-DE`, transcoded to
 * MP3 exactly as the app does. Two prompt variants for the first
 * `TTS_VARIANT_B_COUNT` sentences: A is the ar_lev mirror (dialect named,
 * no notes), B adds an explicit `ttsPromptNotes`-style dialect line, so the
 * question "does the voice need a note?" is answered by listening.
 *
 * Cost: real billed USD from OpenRouter usage accounting, with a budget guard
 * (default $1.00). Everything caches to
 * .scratch/swiss-german/cache.json keyed by (condition, item id + content
 * hash), so a re-run never re-buys. Audio caches by file existence.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { generateText } from 'ai';
import { Mp3Encoder } from '@breezystack/lamejs';
import {
  SOL_MINIMAL,
  getTranslationConfigForLanguage,
  type ModelStage,
} from '../lib/languages';
import { ttsDeliveryInstruction } from '../convex/lib/tts/deliveryInstruction';
import {
  normalizeModelOutput,
  openrouterCallOptions,
  type TranslationPromptArgs,
} from '../convex/features/translationLLM';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import {
  argValue,
  Bench,
  contextLines,
  createOpenRouterFromEnv,
  fmtUsd,
  judgeCandidates,
  JUDGE_MODEL,
  JUDGE_REASONING,
  pool,
  seededShuffle,
  type CallTelemetry,
  type OpenRouterClient,
} from './eval/lib/bench';

// ------------------------------------------------------------------- config

const OUT_DIR = resolve(process.cwd(), '.scratch/swiss-german');
const AUDIO_DIR = resolve(OUT_DIR, 'audio');
/** Same clips, named after the sentence, for listening rather than caching. */
const LISTEN_DIR = resolve(OUT_DIR, 'sentences');
const SENTENCES_CSV = resolve(
  process.cwd(),
  'data_preparation/data/output/sentences.csv',
);

const RUN_HINT = 'pnpm eval:swiss';
const DEFAULT_BUDGET_USD = 1.0;
const DEFAULT_N = 20;
const DEFAULT_SEED = 'swiss-1';
const CONCURRENCY = 4;

/** The production stage every language translates on (`sol_minimal`). */
const STAGE: ModelStage = SOL_MINIMAL;

/**
 * The Swiss config, shaped exactly like a `lib/languages.ts` entry so it can
 * be lifted verbatim if the spike pays off. `translationName` is the dialect
 * name (ar_lev: 'Levantine Arabic'), `regionLabel` pins the variety — Swiss
 * German is a bundle of mutually distinct dialects, so leaving the region at
 * "Switzerland" asks the model to pick one at random per sentence and the
 * course would drift between Zurich and Bern mid-lesson.
 */
const SWISS = {
  code: 'de_ch',
  translationName: 'Swiss German',
  nativeName: 'Schwiizerdütsch',
  regionLabel: 'German-speaking Switzerland (Zurich)',
  /** `ttsPromptName`: the only dialect signal the voice gets in variant A. */
  ttsPromptName: 'Swiss German',
  /** `ttsPromptNotes` for variant B only. */
  ttsPromptNotes:
    'Zurich Swiss German (Züridütsch) pronunciation, not Standard German.',
  geminiBcp47: 'de-DE',
  /** One of the four production Gemini voices (lib/voices.ts, `de` pool). */
  voiceName: 'Gacrux',
} as const;

const TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';
const TTS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const PCM_SAMPLE_RATE = 24000;
const MP3_KBPS = 48;
const TTS_SPEED = 1;
/** How many sentences also get the "with dialect note" audio variant. */
const TTS_VARIANT_B_COUNT = 6;

/**
 * How many times the self-revision pass feeds a sentence back to the model.
 * Two, because one round only says whether it changes its mind; the second
 * says whether it ever stops.
 */
const REVISE_ROUNDS = 2;

// --------------------------------------------------------- mechanical checks

/**
 * Tokens that exist in Standard German and have no place in written Swiss
 * German. Each is the standard form of something the dialect renders
 * differently; a hit is a leak, not a style preference.
 */
const STANDARD_LEAKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/u, 'ß (Switzerland does not use ß at all)'],
  [/\bnicht\b/iu, '"nicht" (dialect: nöd / ned)'],
  [/\bnichts\b/iu, '"nichts" (dialect: nüt)'],
  [/\bist\b/iu, '"ist" (dialect: isch)'],
  [/\bhat\b/iu, '"hat" (dialect: hät)'],
  [/\bhaben\b/iu, '"haben" (dialect: händ / ha)'],
  [/\bwir\b/iu, '"wir" (dialect: mir)'],
  [/\bkein(e|en|er|em)?\b/iu, '"kein" (dialect: kei / käs)'],
  [/\bklein(e|en|er|es|em)?\b/iu, '"klein" (dialect: chli / chlii)'],
  [/\bkomm(e|en|t|st)?\b/iu, '"kommen" (dialect: cho / chunt / chömed)'],
  [/\bkind(er|es)?\b/iu, '"Kind" (dialect: Chind)'],
  [/\bkann(st)?\b/iu, '"kann" (dialect: cha / chasch)'],
  [/\bkaufen?\b/iu, '"kaufen" (dialect: chaufe)'],
  [/\bküche\b/iu, '"Küche" (dialect: Chuchi)'],
  [/\bauch\b/iu, '"auch" (dialect: au)'],
  [/\bein(e|en|er|es|em)\b/iu, '"eine/einen/…" (dialect: e / en / es)'],
  [/\bund\b/iu, '"und" (dialect: und is fine in Bern, Zurich writes und too)'],
];

/**
 * The Standard leaks above that are genuinely disqualifying. "und" and a bare
 * "ein" show up in real dialect writing, so they are listed for the report but
 * never counted against a candidate.
 */
const SOFT_LEAKS = new Set(['"und"', '"eine/einen/…"']);

/**
 * Simple past. Swiss German has lost the preterite entirely — every past is a
 * perfect ("Er isch gsi", never "Er war") — so a preterite is the single most
 * reliable sign the model wrote Standard German.
 */
const PRETERITE =
  /\b(war|waren|warst|hatte|hatten|hattest|ging|gingen|kam|kamen|sah|sahen|machte|machten|sagte|sagten|wollte|wollten|konnte|konnten|musste|mussten|gab|gaben|fuhr|fuhren|nahm|nahmen|blieb|blieben|dachte|fand|fanden|wurde|wurden)\b/iu;

/**
 * Positive dialect markers. Not a whitelist — a correct sentence can miss all
 * of them ("Guete Morge") — but across 20 sentences the hit rate says whether
 * the model is really writing dialect.
 */
const DIALECT_MARKERS: ReadonlyArray<RegExp> = [
  /\bisch\b/iu,
  /\bnö?d\b/iu,
  /\bned\b/iu,
  /\bnüt\b/iu,
  /\bhät\b/iu,
  /\bhänd\b/iu,
  /\bmir\b/iu,
  /\bihr\b/iu,
  /\bgsi\b/iu,
  /\bgs[ec]h\w*\b/iu,
  /\bch[oöuia]\w*\b/iu, // chunt, chöme, chli, chuchi, chind
  /\böpp[ie]\w*\b/iu, // öppis, öpper
  /\bgäll\b/iu,
  /\w{2,}li\b/iu, // -li diminutive
  /\buf\b/iu,
  /\bvo(m|n(e|em))?\b/iu,
  /\bgo\b/iu, // the "go" of "gang go luege"
  /\bmoll\b/iu,
  /\bd'\w+/iu, // the elided article
];

type MechanicalResult = {
  leaks: string[];
  softLeaks: string[];
  preterite: string | null;
  markerCount: number;
};

function mechanicalCheck(text: string): MechanicalResult {
  const leaks: string[] = [];
  const softLeaks: string[] = [];
  for (const [re, label] of STANDARD_LEAKS) {
    if (!re.test(text)) continue;
    const soft = [...SOFT_LEAKS].some((s) => label.startsWith(s));
    (soft ? softLeaks : leaks).push(label);
  }
  const pret = text.match(PRETERITE);
  const markerCount = DIALECT_MARKERS.filter((re) => re.test(text)).length;
  return {
    leaks,
    softLeaks,
    preterite: pret ? pret[0] : null,
    markerCount,
  };
}

/** A candidate passes mechanically when it leaks nothing and has no preterite. */
function mechanicallyClean(m: MechanicalResult): boolean {
  return m.leaks.length === 0 && m.preterite === null;
}

// ------------------------------------------------------------------ dataset

type Item = {
  id: string;
  text: string;
  difficulty: string;
  /** Which diagnostic features the sentence exercises, for the report. */
  features: string[];
};

/**
 * Dialect-diagnostic features. A random draw from the catalogue is mostly
 * short present-tense statements, which every model can fake; the picks are
 * biased so negation, past tense, questions and modals are all represented,
 * because those are where Standard German leaks through.
 */
const FEATURES: ReadonlyArray<readonly [string, RegExp]> = [
  ['negation', /\b(not|n't|no one|nobody|nothing|never)\b/iu],
  ['past', /\b(was|were|had|did|went|saw|came|told|said|made|gave)\b/iu],
  ['question', /\?\s*$/u],
  ['modal', /\b(can|could|would|should|must|may|please|have to)\b/iu],
  ['we', /\b(we|us|our)\b/iu],
  ['future', /\b(will|going to|tomorrow|next)\b/iu],
  ['diminutive-bait', /\b(house|child|children|little|small|dog|cat|girl|boy)\b/iu],
  ['k-shift', /\b(come|comes|coming|child|children|kitchen|buy|can|cold)\b/iu],
];

function featuresOf(text: string): string[] {
  return FEATURES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** FNV-1a over the text, so an edited dataset never reuses a stale result. */
function contentHash(text: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Cache key for one item under one condition. The hash covers the whole
 * prompt-args object, not just the text, so editing the inferred context
 * (gender, register) invalidates the affected rows instead of serving a
 * translation the current prompt would never produce.
 */
function itemKey(item: Item, condition?: 'de' | 'de_ch'): string {
  const payload = condition
    ? JSON.stringify(promptArgsFor(item, condition))
    : item.text;
  return `${item.id}#${contentHash(payload)}`;
}

/**
 * Pick `n` catalogue sentences, seeded, covering every diagnostic feature at
 * least twice before filling the rest at random. Deterministic for a seed, so
 * a re-run hits the cache.
 */
function pickItems(n: number, seed: string): Item[] {
  const rows = parse(readFileSync(SENTENCES_CSV, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as { id: string; text: string; difficulty: string }[];

  const shuffled = seededShuffle(rows, seed);
  const picked: Item[] = [];
  const seen = new Set<string>();
  const covered = new Map<string, number>();
  const TARGET_PER_FEATURE = 2;

  const take = (row: { id: string; text: string; difficulty: string }) => {
    if (seen.has(row.text)) return;
    seen.add(row.text);
    const features = featuresOf(row.text);
    picked.push({
      id: row.id,
      text: row.text,
      difficulty: row.difficulty,
      features,
    });
    for (const f of features) covered.set(f, (covered.get(f) ?? 0) + 1);
  };

  // Pass 1: satisfy the feature quotas.
  for (const [name] of FEATURES) {
    for (const row of shuffled) {
      if ((covered.get(name) ?? 0) >= TARGET_PER_FEATURE) break;
      if (picked.length >= n) break;
      if (seen.has(row.text)) continue;
      if (!featuresOf(row.text).includes(name)) continue;
      // Keep the clips short enough to listen to in one pass.
      if (row.text.length > 70) continue;
      take(row);
    }
  }
  // Pass 2: fill to n.
  for (const row of shuffled) {
    if (picked.length >= n) break;
    if (row.text.length > 70) continue;
    take(row);
  }
  return picked.slice(0, n);
}

// -------------------------------------------------------------- translation

/**
 * The catalogue CSV carries no gender/register metadata (the production
 * pipeline gets it from the sentence rows), so infer the two fields the
 * prompt insists on from the English itself. Without this the forced
 * masculine default turned "She pretended..." into "Er tat so...".
 */
function inferredContext(text: string): {
  addressesSomeone: boolean;
  referentGender: 'male' | 'female';
} {
  return {
    addressesSomeone: /\byou(r|rs|rself)?\b/iu.test(text),
    // `s?he` would match "he" as well and made every masculine sentence
    // feminine, which both conditions then faithfully mistranslated.
    referentGender: /\b(she|her|hers|herself)\b/iu.test(text)
      ? 'female'
      : 'male',
  };
}

function promptArgsFor(item: Item, condition: 'de' | 'de_ch'): TranslationPromptArgs {
  const ctx = inferredContext(item.text);
  if (condition === 'de') {
    const cfg = getTranslationConfigForLanguage('de');
    return {
      text: item.text,
      sourceLang: 'en',
      targetLang: 'de',
      targetLangName: cfg.targetLangName,
      targetLangNativeName: cfg.targetLangNativeName,
      targetRegion: cfg.targetRegion,
      addressesSomeone: ctx.addressesSomeone,
      formality: 'informal',
      referentGender: ctx.referentGender,
    };
  }
  // The ar_lev recipe: dialect name, native name, region label. Nothing else
  // in the prompt knows this is a dialect.
  return {
    text: item.text,
    sourceLang: 'en',
    targetLang: SWISS.code,
    targetLangName: SWISS.translationName,
    targetLangNativeName: SWISS.nativeName,
    targetRegion: SWISS.regionLabel,
    addressesSomeone: ctx.addressesSomeone,
    formality: 'informal',
    referentGender: ctx.referentGender,
  };
}

// -------------------------------------------------------------------- judge

function buildScoringPrompt(
  item: Item,
  candidates: string[],
): string {
  const args = promptArgsFor(item, 'de_ch');
  return [
    `You are a native speaker of Zurich Swiss German (Züridütsch) and a professional translation evaluator. Score each candidate translation of the English source on a 0-10 scale for how well it works as spoken Zurich Swiss German a learner would be taught.`,
    ``,
    `<context>`,
    ...contextLines(args),
    `</context>`,
    ``,
    `<source>${item.text}</source>`,
    ``,
    `<candidates>`,
    ...candidates.map((t, i) => `  <candidate id="${i + 1}">${t}</candidate>`),
    `</candidates>`,
    ``,
    `<instructions>`,
    `Judge three things, in this order of weight: (1) IS IT ACTUALLY SWISS GERMAN? Zurich dialect as spoken, written in ordinary Swiss dialect spelling (Dieth-style, as used in SMS and Swiss dialect writing). Standard German is not Swiss German no matter how correct it is: a candidate written in Standard German scores at most 2, and one that is Standard German with a couple of dialect words swapped in scores at most 4. Watch for the giveaways: ß (never used in Switzerland), the simple past (Swiss German has NO preterite — "er isch gsi", never "er war"), unshifted k where the dialect has ch (Chind, chli, chunt, chan), "nicht" for "nöd", "ist" for "isch", "wir" for "mir". (2) Is it Zurich, not Bern/Basel/Wallis? A different Swiss dialect scores at most 7. (3) Does it preserve the meaning and the speech act of the English, at the everyday spoken register a learner needs?`,
    `10 = exactly what a Zurich native would say and write; 8-9 = natural dialect with minor spelling or word-choice quibbles; 6-7 = understandable dialect but awkward, or mixed with another Swiss dialect; 4-5 = half-dialect, or a meaning slip; 0-3 = Standard German, or wrong meaning.`,
    `</instructions>`,
    ``,
    `Output ONLY a JSON array, one integer score per candidate in id order, e.g. [7,9]. No commentary.`,
  ].join('\n');
}

/**
 * One critique call over every Swiss candidate at once. The scores say how
 * good; this says what is wrong, in words, with a corrected sentence, which
 * is what a human reviewing the spike actually needs.
 */
function buildCritiquePrompt(rows: { id: string; source: string; swiss: string }[]): string {
  return [
    `You are a native speaker of Zurich Swiss German (Züridütsch). Below are English sentences and their proposed Zurich Swiss German translations, produced by a language-learning app.`,
    ``,
    `<pairs>`,
    ...rows.map(
      (r) =>
        `  <pair id="${r.id}"><source>${r.source}</source><candidate>${r.swiss}</candidate></pair>`,
    ),
    `</pairs>`,
    ``,
    `<instructions>`,
    `For each pair, decide what is wrong with the candidate as Zurich Swiss German, if anything. Verdicts:`,
    `  "ok" — a Zurich native would say and write exactly this.`,
    `  "minor" — dialect is right, but the spelling or a word choice is off.`,
    `  "standard-leak" — Standard German forms remain (ß, simple past, unshifted k, nicht/ist/wir/kein...).`,
    `  "wrong-dialect" — Swiss, but a different canton's dialect, or a mix.`,
    `  "meaning" — the meaning or the speech act of the English is not preserved.`,
    `  "standard-german" — it is simply Standard German.`,
    `A pair can have only one verdict: pick the most serious that applies.`,
    `</instructions>`,
    ``,
    `Output ONLY a JSON array, one object per pair in the order given:`,
    `[{"id":"...","verdict":"ok","issue":"","fix":""}]`,
    `"issue" is one short sentence naming the problem (empty when the verdict is "ok"). "fix" is the sentence as you would write it in Zurich dialect (repeat the candidate when the verdict is "ok"). No commentary outside the JSON.`,
  ].join('\n');
}

type Critique = { id: string; verdict: string; issue: string; fix: string };

async function runCritique(
  bench: Bench,
  openrouter: OpenRouterClient,
  rows: { id: string; source: string; swiss: string }[],
): Promise<Critique[]> {
  const cacheKey = `critique|${contentHash(JSON.stringify(rows))}`;
  const hit = bench.cache[cacheKey];
  if (hit?.text) return JSON.parse(hit.text) as Critique[];

  const providerOptions = openrouterCallOptions(JUDGE_REASONING);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await generateText({
        model: openrouter(JUDGE_MODEL),
        prompt: buildCritiquePrompt(rows),
        temperature: 0,
        maxOutputTokens: 16_000,
        ...(providerOptions ? { providerOptions } : {}),
      });
      const telemetry: CallTelemetry[] = [
        {
          model: JUDGE_MODEL,
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
          costUsd: openrouterCostUsd(res.providerMetadata),
          latencyMs: Date.now() - startedAt,
          role: 'dialect-critique',
          generationId: openrouterGenerationId(res.providerMetadata),
        },
      ];
      bench.recordSpend(telemetry);
      const match = res.text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error(`unparseable: ${res.text.slice(0, 120)}`);
      const parsed = JSON.parse(match[0]) as Critique[];
      bench.cache[cacheKey] = { text: JSON.stringify(parsed), telemetry };
      bench.save();
      return parsed;
    } catch (err) {
      console.warn(
        `  critique attempt ${attempt} failed: ${err instanceof Error ? err.message.slice(0, 140) : err}`,
      );
    }
  }
  return [];
}

// ------------------------------------------------------------------ revise

/**
 * Hand Sol its own translation back and ask for either the same sentence or a
 * better one. Same model and thinking as the stage that wrote it, so this is
 * the model reviewing itself, not a second opinion. The prompt names identity
 * as the expected answer, the way `buildAccentRewritePrompt` and
 * `buildRenderingRewritePrompt` do: without that, a rewrite prompt rewrites
 * everything it is handed whether or not anything is wrong.
 */
function buildRevisePrompt(source: string, candidate: string): string {
  return [
    `You are a native speaker of Zurich Swiss German (Züridütsch) checking a translation for a language-learning app. A learner will see the ${SWISS.translationName} sentence next to the English and learn it as the way to say the English.`,
    ``,
    `<source>${source}</source>`,
    `<translation>${candidate}</translation>`,
    ``,
    `<instructions>`,
    `If the translation is already what a Zurich native would say and write, output it back UNCHANGED, character for character. That is the expected answer for most sentences.`,
    `Otherwise output a corrected version, changing ONLY what is actually wrong: a word that is not Zurich dialect or does not mean what it is being used to mean, a Standard German form left unshifted (ß, the simple past, unshifted k, nicht/ist/wir/kein), another canton's form, a spelling no Zürcher would write, or a meaning or speech act that does not match the English. Leave every part that is already right exactly as it is.`,
    `</instructions>`,
    ``,
    `Output only the ${SWISS.translationName} sentence. No commentary, no quotation marks, no alternatives.`,
  ].join('\n');
}

/**
 * A second, looser pass: not "fix what is wrong" but "make it sound as
 * natural as possible". The identity anchor is deliberately weaker here —
 * this prompt is allowed to reach for a different phrasing — so the
 * interesting number is how much it moves and whether the meaning survives.
 */
function buildNaturalPrompt(source: string, candidate: string): string {
  return [
    `You are a native speaker of Zurich Swiss German (Züridütsch). Below is an English sentence and its ${SWISS.translationName} translation, which a learner will see next to the English and learn as the way to say it.`,
    ``,
    `<source>${source}</source>`,
    `<translation>${candidate}</translation>`,
    ``,
    `<instructions>`,
    `Return the translation as it is, or, if you can improve it, make it sound as natural as possible — the phrasing a Zürcher would actually use in everyday speech, not a dialect-coloured rendering of the English. It must still mean the same as the English and stay usable in the same range of situations.`,
    `</instructions>`,
    ``,
    `Output only the ${SWISS.translationName} sentence. No commentary, no quotation marks, no alternatives.`,
  ].join('\n');
}

/** One revise/naturalize call on the production Sol stage, cached and budgeted. */
async function reviseCached(
  bench: Bench,
  openrouter: OpenRouterClient,
  key: string,
  prompt: string,
  role: string,
): Promise<string | null> {
  const hit = bench.cache[key];
  if (hit) return hit.text;
  const startedAt = Date.now();
  const providerOptions = openrouterCallOptions(STAGE.reasoning, STAGE.provider);
  try {
    const res = await generateText({
      model: openrouter(STAGE.model),
      prompt,
      temperature: 0,
      maxOutputTokens: STAGE.maxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const telemetry: CallTelemetry[] = [
      {
        model: STAGE.model,
        inputTokens: res.usage.inputTokens ?? 0,
        outputTokens: res.usage.outputTokens ?? 0,
        costUsd: openrouterCostUsd(res.providerMetadata),
        latencyMs: Date.now() - startedAt,
        role,
        generationId: openrouterGenerationId(res.providerMetadata),
      },
    ];
    bench.recordSpend(telemetry);
    const text = normalizeModelOutput(SWISS.code, res.text);
    bench.cache[key] = { text, telemetry };
    return text;
  } catch (err) {
    console.warn(
      `  revise failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------- tts

/**
 * The in-app Gemini prompt shape (convex/lib/tts/gemini.ts `buildStyledInput`).
 * Variant A passes no notes, which is exactly what ar_lev does.
 */
function buildStyledInput(text: string, notes?: string): string {
  const instruction = notes
    ? `${ttsDeliveryInstruction(SWISS.ttsPromptName)} ${notes}`
    : ttsDeliveryInstruction(SWISS.ttsPromptName);
  return `## Instruction: ${instruction}\n\n## Transcript: ${text}`;
}

/**
 * Transcode Gemini's headerless little-endian PCM to MP3, same encoder and
 * bitrate as the app, so what is reviewed here is what a user would hear.
 * Copied rather than imported: convex/lib/tts/gemini.ts does not export it,
 * and a spike has no business widening that module's surface.
 */
function pcmToMp3(pcm: Uint8Array): Uint8Array {
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.byteLength / 2),
  );
  const encoder = new Mp3Encoder(1, PCM_SAMPLE_RATE, MP3_KBPS);
  const chunks: Uint8Array[] = [];
  const BLOCK = 1152;
  for (let i = 0; i < samples.length; i += BLOCK) {
    const enc = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
    if (enc.length > 0) chunks.push(enc);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function synthesize(text: string, notes: string | undefined): Promise<Uint8Array> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: buildStyledInput(attempt === 0 ? text : ` ${text} `, notes),
        voice: SWISS.voiceName,
        response_format: 'pcm',
        speed: TTS_SPEED,
        provider: {
          options: { google: { language_code: SWISS.geminiBcp47 } },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const pcm = new Uint8Array(await res.arrayBuffer());
    if (pcm.byteLength > 0) return pcmToMp3(pcm);
    console.warn(`  empty audio for "${text.slice(0, 30)}" (attempt ${attempt + 1}/3)`);
  }
  throw new Error(`No audio returned for "${text.slice(0, 40)}"`);
}

function audioFileName(text: string, variant: 'a' | 'b'): string {
  const hash = createHash('sha256')
    .update(`${text}\n${SWISS.voiceName}\n${variant}\n${TTS_MODEL}`)
    .digest('hex')
    .slice(0, 10);
  return `swiss__${variant}__${hash}.mp3`;
}

/**
 * The listening copy of a clip: the sentence itself as the filename, so the
 * folder can be played straight through and every file says what it says.
 * The hashed originals stay put — they are the synthesis cache, and a
 * sentence is not a safe cache key once the model rewords it.
 */
function listenFileName(index: number, text: string, variant: 'a' | 'b'): string {
  const slug = text
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/gu, '') // illegal on at least one of macOS/Windows
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[.\s]+$/u, ''); // no "sentence..mp3"
  // Only the `b` clips need disambiguating: `a` is the ar_lev mirror.
  const suffix = variant === 'b' ? ' (with dialect note)' : '';
  return `${String(index).padStart(2, '0')} ${slug}${suffix}.mp3`;
}

// --------------------------------------------------------------------- main

type Row = {
  item: Item;
  de: string | null;
  swiss: string | null;
  mech: MechanicalResult | null;
  scoreDe?: number;
  scoreSwiss?: number;
  critique?: Critique;
  /** One entry per self-revision round; `[0]` is the revision of `swiss`. */
  revisions?: (string | null)[];
  /** The naturalness pass, run on whatever the revision loop settled on. */
  natural?: string | null;
  audioA?: string;
  audioB?: string;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const n = Number(argValue(argv, 'n') ?? DEFAULT_N);
  const seed = argValue(argv, 'seed') ?? DEFAULT_SEED;
  const withJudge = !argv.includes('--no-judge');
  const withAudio = !argv.includes('--no-audio');
  const withRevise = !argv.includes('--no-revise');

  // `--print-prompts` dumps the two quality-pass prompts exactly as they are
  // sent, filled in with one real sentence, and exits. The prompts are the
  // experiment, so they need to be readable without running it.
  if (argv.includes('--print-prompts')) {
    const source = 'Touch it with your bare hands.';
    const candidate = "Lang's mit de blutte Händ aa.";
    console.log('=== PASS 2 — fix what is wrong ===\n');
    console.log(buildRevisePrompt(source, candidate));
    console.log('\n\n=== PASS 3 — make it natural ===\n');
    console.log(buildNaturalPrompt(source, candidate));
    console.log(
      `\n\n(model ${STAGE.model}, reasoning ${STAGE.reasoning}, temperature 0, ` +
        `max ${STAGE.maxOutputTokens} tokens)`,
    );
    return;
  }
  const budgetUsd = Number(argValue(argv, 'budget') ?? DEFAULT_BUDGET_USD);

  const bench = new Bench({
    outDir: OUT_DIR,
    budgetUsd,
    budgetHint: `re-run ${RUN_HINT} to continue from the cache, or raise --budget`,
  });
  const openrouter = createOpenRouterFromEnv(RUN_HINT);

  const items = pickItems(n, seed);
  console.log(`${items.length} sentences, seed "${seed}", budget ${fmtUsd(budgetUsd)}\n`);

  // ---- translate both conditions
  const rows: Row[] = items.map((item) => ({
    item,
    de: null,
    swiss: null,
    mech: null,
  }));
  await pool(rows, CONCURRENCY, async (row) => {
    const [de, swiss] = await Promise.all([
      bench.translateCached(
        `de|${itemKey(row.item, 'de')}`,
        STAGE,
        promptArgsFor(row.item, 'de'),
      ),
      bench.translateCached(
        `de_ch|${itemKey(row.item, 'de_ch')}`,
        STAGE,
        promptArgsFor(row.item, 'de_ch'),
      ),
    ]);
    row.de = de.text;
    row.swiss = swiss.text;
    row.mech = swiss.text ? mechanicalCheck(swiss.text) : null;
    console.log(`  ${row.item.text}\n    de:  ${de.text}\n    ch:  ${swiss.text}`);
  });
  bench.save();

  // ---- self-revision: hand each sentence back to the same model
  if (withRevise) {
    console.log('\nRevising...');
    await pool(rows, CONCURRENCY, async (row) => {
      if (!row.swiss) return;
      const revisions: (string | null)[] = [];
      let candidate: string = row.swiss;
      for (let round = 1; round <= REVISE_ROUNDS; round++) {
        // Keyed on the text going in, so a round that changed nothing reuses
        // the previous round's cached call instead of buying it twice.
        const next = await reviseCached(
          bench,
          openrouter,
          `revise|${contentHash(candidate)}`,
          buildRevisePrompt(row.item.text, candidate),
          'self-revise',
        );
        revisions.push(next);
        if (next === null) break;
        candidate = next;
      }
      row.revisions = revisions;
      // Third pass, on whatever the revision loop settled on.
      row.natural = await reviseCached(
        bench,
        openrouter,
        `natural|${contentHash(candidate)}`,
        buildNaturalPrompt(row.item.text, candidate),
        'naturalize',
      );
    });
    bench.save();
  }

  // ---- judge
  if (withJudge) {
    console.log('\nJudging...');
    await pool(rows, CONCURRENCY, async (row) => {
      if (!row.de || !row.swiss) return;
      const key = `judge|${itemKey(row.item, 'de_ch')}`;
      const candidates = [row.de, row.swiss];
      if (!bench.hasJudgedAll(key, candidates)) {
        const shuffled = seededShuffle(candidates, `${seed}|${row.item.id}`);
        const outcome = await judgeCandidates(
          bench,
          openrouter,
          buildScoringPrompt(row.item, shuffled),
          shuffled,
          row.item.id,
        );
        if (outcome) bench.storeJudge(key, outcome);
      }
      const scores = bench.judgeScores(key);
      row.scoreDe = scores[row.de];
      row.scoreSwiss = scores[row.swiss];
    });
    bench.save();

    const critiqueRows = rows
      .filter((r): r is Row & { swiss: string } => r.swiss !== null)
      .map((r) => ({ id: r.item.id, source: r.item.text, swiss: r.swiss }));
    const critiques = await runCritique(bench, openrouter, critiqueRows);
    for (const c of critiques) {
      const row = rows.find((r) => r.item.id === c.id);
      if (row) row.critique = c;
    }
  }

  // ---- audio
  if (withAudio) {
    console.log('\nSynthesizing...');
    mkdirSync(AUDIO_DIR, { recursive: true });
    // Rebuilt from scratch each run: the names come from the translations, so
    // a reworded sentence would otherwise leave its old name behind.
    rmSync(LISTEN_DIR, { recursive: true, force: true });
    mkdirSync(LISTEN_DIR, { recursive: true });
    const jobs: { row: Row; index: number; variant: 'a' | 'b' }[] = [];
    rows.forEach((row, i) => {
      if (!row.swiss) return;
      jobs.push({ row, index: i + 1, variant: 'a' });
      if (i < TTS_VARIANT_B_COUNT) jobs.push({ row, index: i + 1, variant: 'b' });
    });
    await pool(jobs, 3, async ({ row, index, variant }) => {
      const text = row.swiss as string;
      const file = audioFileName(text, variant);
      const path = resolve(AUDIO_DIR, file);
      if (!existsSync(path)) {
        const mp3 = await synthesize(
          text,
          variant === 'b' ? SWISS.ttsPromptNotes : undefined,
        );
        writeFileSync(path, mp3);
        console.log(`  [${variant}] ${file}  ${text.slice(0, 48)}`);
      }
      const listenFile = listenFileName(index, text, variant);
      copyFileSync(path, resolve(LISTEN_DIR, listenFile));
      if (variant === 'a') row.audioA = file;
      else row.audioB = file;
    });
    console.log(`  named copies in ${LISTEN_DIR}`);
  }

  // ---- report
  const scored = rows.filter((r) => r.scoreSwiss !== undefined);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const meanSwiss = mean(scored.map((r) => r.scoreSwiss as number));
  const meanDe = mean(scored.map((r) => r.scoreDe as number));
  const clean = rows.filter((r) => r.mech && mechanicallyClean(r.mech));
  const verdictCounts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.critique) continue;
    verdictCounts[r.critique.verdict] = (verdictCounts[r.critique.verdict] ?? 0) + 1;
  }

  const lines: string[] = [];
  lines.push(`Swiss German via the ar_lev recipe — ${items.length} sentences, seed "${seed}"`);
  lines.push(`Translation stage: ${STAGE.model} (${STAGE.reasoning})`);
  lines.push(
    `Config: name="${SWISS.translationName}" native="${SWISS.nativeName}" region="${SWISS.regionLabel}"`,
  );
  lines.push(`TTS: ${TTS_MODEL} voice=${SWISS.voiceName} language_code=${SWISS.geminiBcp47}`);
  lines.push('');
  lines.push('--- mechanical ---');
  lines.push(
    `clean (no Standard leak, no preterite): ${clean.length}/${rows.length}`,
  );
  const leakCounts: Record<string, number> = {};
  for (const r of rows) {
    for (const l of r.mech?.leaks ?? []) leakCounts[l] = (leakCounts[l] ?? 0) + 1;
    if (r.mech?.preterite) {
      const k = `preterite "${r.mech.preterite}"`;
      leakCounts[k] = (leakCounts[k] ?? 0) + 1;
    }
  }
  for (const [label, count] of Object.entries(leakCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${count}x  ${label}`);
  }
  lines.push(
    `mean dialect markers per sentence: ${mean(rows.map((r) => r.mech?.markerCount ?? 0)).toFixed(1)}`,
  );
  if (withJudge) {
    lines.push('');
    lines.push('--- judge (0-10, Zurich Swiss German) ---');
    lines.push(`  de_ch prompt: ${meanSwiss.toFixed(2)}`);
    lines.push(`  de baseline:  ${meanDe.toFixed(2)}  (the control: should be low)`);
    lines.push('');
    lines.push('--- critique verdicts ---');
    for (const [v, c] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${c}x  ${v}`);
    }
  }
  if (withRevise) {
    lines.push('');
    lines.push('--- self-revision (same model, same thinking, own output) ---');
    for (let round = 0; round < REVISE_ROUNDS; round++) {
      const seen = rows.filter((r) => r.revisions?.[round] != null);
      const before = (r: Row) =>
        round === 0 ? (r.swiss as string) : (r.revisions?.[round - 1] as string);
      const changed = seen.filter((r) => r.revisions?.[round] !== before(r));
      lines.push(
        `  round ${round + 1}: ${changed.length}/${seen.length} sentences changed`,
      );
    }
    const finalRev = (r: Row) =>
      r.revisions?.filter((t): t is string => t !== null).at(-1) ?? null;
    const stillClean = rows.filter((r) => {
      const t = finalRev(r);
      return t !== null && mechanicallyClean(mechanicalCheck(t));
    });
    lines.push(
      `  mechanically clean after revision: ${stillClean.length}/${rows.length}`,
    );
    const natChanged = rows.filter(
      (r) => r.natural != null && r.natural !== (finalRev(r) ?? r.swiss),
    );
    const natClean = rows.filter(
      (r) => r.natural != null && mechanicallyClean(mechanicalCheck(r.natural)),
    );
    lines.push(
      `  naturalness pass: ${natChanged.length}/${rows.length} changed, ` +
        `${natClean.length}/${rows.length} mechanically clean`,
    );
    lines.push('');
    for (const r of rows) {
      if (!r.revisions) continue;
      const chain = [r.swiss as string, ...r.revisions.filter((t) => t !== null)];
      const moved =
        !chain.every((t) => t === chain[0]) ||
        (r.natural != null && r.natural !== chain.at(-1));
      if (!moved) continue;
      lines.push(`  ${r.item.text}`);
      chain.forEach((t, i) => {
        const tag = i === 0 ? 'orig' : `r${i}  `;
        const same = i > 0 && t === chain[i - 1] ? '  (unchanged)' : '';
        lines.push(`    ${tag} ${t}${same}`);
      });
      if (r.natural != null) {
        const same = r.natural === chain.at(-1) ? '  (unchanged)' : '';
        lines.push(`    nat  ${r.natural}${same}`);
      }
      lines.push('');
    }
  }
  lines.push('');
  lines.push('--- sentences ---');
  for (const r of rows) {
    lines.push(`[${r.item.difficulty}] ${r.item.text}   (${r.item.features.join(', ')})`);
    lines.push(`  de     ${r.de ?? '<failed>'}${r.scoreDe !== undefined ? `   [${r.scoreDe}]` : ''}`);
    lines.push(`  de_ch  ${r.swiss ?? '<failed>'}${r.scoreSwiss !== undefined ? `   [${r.scoreSwiss}]` : ''}`);
    if (r.mech && !mechanicallyClean(r.mech)) {
      const bits = [...r.mech.leaks];
      if (r.mech.preterite) bits.push(`preterite "${r.mech.preterite}"`);
      lines.push(`         ! ${bits.join('; ')}`);
    }
    if (r.critique && r.critique.verdict !== 'ok') {
      lines.push(`         ${r.critique.verdict}: ${r.critique.issue}`);
      lines.push(`         fix: ${r.critique.fix}`);
    }
    if (r.audioA) lines.push(`         audio a: audio/${r.audioA}`);
    if (r.audioB) lines.push(`         audio b: audio/${r.audioB}`);
    lines.push('');
  }
  lines.push(`Spent: ${fmtUsd(bench.spentUsd)}`);

  console.log('\n' + lines.join('\n'));
  bench.writeReport(lines, {
    seed,
    n: items.length,
    stage: STAGE.model,
    config: SWISS,
    meanSwiss,
    meanDe,
    mechanicallyClean: clean.length,
    verdictCounts,
    leakCounts,
    rows: rows.map((r) => ({
      id: r.item.id,
      source: r.item.text,
      difficulty: r.item.difficulty,
      features: r.item.features,
      de: r.de,
      swiss: r.swiss,
      scoreDe: r.scoreDe,
      scoreSwiss: r.scoreSwiss,
      mech: r.mech,
      critique: r.critique,
      revisions: r.revisions,
      natural: r.natural,
      audioA: r.audioA,
      audioB: r.audioB,
    })),
    spentUsd: bench.spentUsd,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
