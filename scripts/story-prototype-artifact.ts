/**
 * TEMPORARY — renders .scratch/story-prototype/results.json into a review page
 * (.scratch/story-prototype/review.html) that gets published as an Artifact.
 * Companion to scripts/story-prototype.ts; delete both together.
 *
 *   pnpm tsx scripts/story-prototype-artifact.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { languageName } from '../lib/languages';
import { normalizeForComparison } from '../lib/textCompare/normalize';

const OUT_DIR = resolve(__dirname, '../.scratch/story-prototype');

type StoryLine = { speaker: string; text: string; en: string };
type Metrics = {
  storyWords: number;
  verbatim: number;
  nearVerbatim: number;
  wordCoverage: number;
  newWordShare: number;
  newWords: string[];
};
type Result = {
  index: number;
  lang: string;
  mode: 'sentences' | 'words';
  difficulty: string;
  sources: { target: string; en: string }[];
  knownWords: string[];
  story: {
    title: string;
    titleEn: string;
    lines: StoryLine[];
    used: number[];
  } | null;
  error?: string;
  metrics?: Metrics;
  telemetry: {
    costUsd?: number;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
};
type TtsRun = {
  index: number;
  lang: string;
  mode: string;
  condition: 'one-voice-whole' | 'two-voice-stitched';
  calls: number;
  pricedCalls: number;
  chars: number;
  seconds: number;
  costUsd?: number;
  costKnown: boolean;
};
type Payload = {
  generatedAt: string;
  langs: string[];
  model: string;
  ttsModel: string;
  seed: number;
  perStory: number;
  results: Result[];
  ttsRuns: TtsRun[];
  llmSpendUsd: number;
};

const data = JSON.parse(
  readFileSync(resolve(OUT_DIR, 'results.json'), 'utf8'),
) as Payload;

// --------------------------------------------------------------- utilities

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Mirrors the prompt bodies in scripts/story-prototype.ts (minus the shared
 *  JSON contract), so the page shows what was actually asked. */
const PROMPT_SENTENCES = `A learner of German has just drilled these 10 flashcards:

1. …  —  …

Write a short dialogue between two named speakers that puts these sentences
into one coherent situation.

Rules:
- Re-use as many of the 10 sentences as you can WORD FOR WORD, unchanged, as
  lines of the dialogue. Do not paraphrase them, do not re-conjugate them, do
  not merge two of them into one line. Aim for at least 7.
- Glue them together with your own short lines so the conversation makes
  sense. Those connective lines must stay simpler than the drilled sentences:
  everyday, high-frequency words only, no new idioms.
- 150-220 words of German in total.
- It has to read like something two people would actually say, not like a
  list. If two drilled sentences cannot sit next to each other, put a line of
  your own in between or let the scene move on.
- Every line gets a natural English translation.`;

const PROMPT_WORDS = `Here are some words a learner of German knows:

<the words of those 10 cards, shuffled>

Write a short conversation between two people. Use some of these words. Do not use any word that is harder than the words in this list.`;

const usd = (n: number, digits = 4) => `$${n.toFixed(digits)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Normalize like the scorer does, but keep an index back into the original
 * string so a matched drilled sentence can be highlighted in place rather than
 * washing the whole line.
 */
function normalizedWithMap(text: string): { norm: string; map: number[] } {
  const src = text.normalize('NFC');
  let norm = '';
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (/[\p{P}\p{S}]/u.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      norm += ' ';
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    const lower = ch.toLowerCase();
    norm += lower[0];
    map.push(i);
    lastWasSpace = false;
  }
  while (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

/** The 1-based drilled index this line reproduces, plus where in the line. */
function findDrilled(
  line: string,
  sources: { target: string }[],
): { index: number; start: number; end: number } | null {
  const { norm, map } = normalizedWithMap(line);
  for (let i = 0; i < sources.length; i++) {
    const needle = normalizeForComparison(sources[i].target);
    if (!needle) continue;
    const at = norm.indexOf(needle);
    if (at === -1) continue;
    const start = map[at] ?? 0;
    const end = (map[at + needle.length - 1] ?? line.length - 1) + 1;
    return { index: i + 1, start, end };
  }
  return null;
}

function renderLine(
  line: StoryLine,
  sources: { target: string }[],
  /** False for the English lane, where the gloss just repeats the line. */
  showGloss: boolean,
): string {
  const hit = findDrilled(line.text, sources);
  const body = hit
    ? `${esc(line.text.slice(0, hit.start))}<mark>${esc(
        line.text.slice(hit.start, hit.end),
      )}</mark>${esc(line.text.slice(hit.end))}`
    : esc(line.text);
  return `<div class="turn${hit ? ' turn--reuse' : ''}">
  <div class="turn__who">${esc(line.speaker)}</div>
  <div class="turn__body">
    <p class="turn__target">${body}</p>${
      showGloss ? `\n    <p class="turn__gloss">${esc(line.en)}</p>` : ''
    }
  </div>
  <div class="turn__tag">${hit ? `<span class="drilled-no">${hit.index}</span>` : ''}</div>
</div>`;
}

// ------------------------------------------------------------------ figures

const byMode = (mode: string) => data.results.filter((r) => r.mode === mode);
const ok = data.results.filter((r) => r.story && r.metrics);

const llmPerStory = mean(data.results.map((r) => r.telemetry.costUsd ?? 0));
const latency = mean(data.results.map((r) => r.telemetry.latencyMs)) / 1000;

const stitched = data.ttsRuns.filter(
  (r) => r.condition === 'two-voice-stitched',
);
const whole = data.ttsRuns.filter((r) => r.condition === 'one-voice-whole');
const ttsStitchedPerStory = mean(
  stitched.filter((r) => r.costUsd != null).map((r) => r.costUsd as number),
);
const ttsWholePerStory = mean(
  whole.filter((r) => r.costUsd != null).map((r) => r.costUsd as number),
);
const audioSeconds = mean(stitched.map((r) => r.seconds));
const usdPerAudioSecond =
  audioSeconds > 0 ? ttsStitchedPerStory / audioSeconds : 0;
const perStoryTotal = llmPerStory + ttsStitchedPerStory;

const verbatimRate = (mode: string, lang?: string) =>
  mean(
    ok
      .filter((r) => r.mode === mode && (!lang || r.lang === lang))
      .map((r) => (r.metrics as Metrics).verbatim / data.perStory),
  );
const newShare = (mode: string, lang?: string) =>
  mean(
    ok
      .filter((r) => r.mode === mode && (!lang || r.lang === lang))
      .map((r) => (r.metrics as Metrics).newWordShare),
  );
const words = (mode: string, lang?: string) =>
  mean(
    ok
      .filter((r) => r.mode === mode && (!lang || r.lang === lang))
      .map((r) => (r.metrics as Metrics).storyWords),
  );

/** What a subscriber costs at a given story cadence, audio included. */
const monthly = (storiesPerMonth: number) => perStoryTotal * storiesPerMonth;

// ------------------------------------------------------------------ render

const sets = [...new Set(data.results.map((r) => r.index))].sort(
  (a, b) => a - b,
);
const langs = data.langs;

function storyBlock(r: Result | undefined): string {
  if (!r) return '<div class="story story--empty">not generated</div>';
  if (!r.story) {
    return `<div class="story story--empty">generation failed: ${esc(r.error ?? 'unknown')}</div>`;
  }
  const m = r.metrics as Metrics;
  const gloss = r.lang !== 'en';
  return `<div class="story">
  <div class="story__head">
    <h4 class="story__title">${esc(r.story.title)}</h4>${
      gloss
        ? `\n    <p class="story__title-en">${esc(r.story.titleEn)}</p>`
        : ''
    }
  </div>
  <div class="dialogue">${r.story.lines.map((l) => renderLine(l, r.sources, gloss)).join('\n')}</div>
  <dl class="chips">
    <div class="chip"><dt>re-used</dt><dd>${m.verbatim}<span>/${data.perStory}</span></dd></div>
    <div class="chip"><dt>length</dt><dd>${m.storyWords}<span> words</span></dd></div>
    <div class="chip chip--new"><dt>off-card words</dt><dd>${pct(m.newWordShare)}</dd></div>
    <div class="chip"><dt>cost</dt><dd>${usd(r.telemetry.costUsd ?? 0, 5)}</dd></div>
  </dl>
</div>`;
}

function sourcesBlock(r: Result | undefined, lang: string): string {
  if (!r) return '';
  const used = new Set(
    r.story
      ? r.story.lines
          .map((l) => findDrilled(l.text, r.sources)?.index)
          .filter((n): n is number => n != null)
      : [],
  );
  return `<ol class="drilled" data-lang="${lang}">
${r.sources
  .map(
    (s, i) =>
      `    <li class="${used.has(i + 1) ? 'is-used' : 'is-missed'}"><span class="drilled__no">${i + 1}</span><span class="drilled__text">${esc(s.target)}</span></li>`,
  )
  .join('\n')}
  </ol>`;
}

function setSection(index: number, mode: 'sentences' | 'words'): string {
  const perLang = langs.map((lang) =>
    data.results.find(
      (r) => r.index === index && r.lang === lang && r.mode === mode,
    ),
  );
  const band = perLang.find((r) => r)?.difficulty ?? '?';
  return `<article class="set" data-mode="${mode}"${mode === 'words' ? ' hidden' : ''}>
  <header class="set__head">
    <span class="set__no">Set ${index}</span>
    <span class="band">${esc(band)}</span>
    <span class="set__note">${data.perStory} cards drilled, one difficulty band</span>
  </header>
  <div class="split">
${perLang
  .map(
    (r, i) => `    <section class="lane">
      <h3 class="lane__lang">${esc(languageName(langs[i]))}</h3>
      ${storyBlock(r)}
      <details class="drilled-wrap">
        <summary>The ten drilled cards${
          mode === 'words'
            ? ' (the model saw only their words, shuffled — never these sentences)'
            : ''
        }</summary>
        ${sourcesBlock(r, langs[i])}
      </details>
    </section>`,
  )
  .join('\n')}
  </div>
</article>`;
}

const summaryRows = langs
  .flatMap((lang) =>
    (['sentences', 'words'] as const).map(
      (mode) => `<tr>
      <th scope="row">${esc(languageName(lang))}</th>
      <td>${mode}</td>
      <td class="num">${pct(verbatimRate(mode, lang))}</td>
      <td class="num">${Math.round(words(mode, lang))}</td>
      <td class="num">${pct(newShare(mode, lang))}</td>
      <td class="num">${usd(
        mean(
          data.results
            .filter((r) => r.lang === lang && r.mode === mode)
            .map((r) => r.telemetry.costUsd ?? 0),
        ),
        5,
      )}</td>
    </tr>`,
    ),
  )
  .join('\n');

const ttsRows = data.ttsRuns
  .map(
    (r) => `<tr>
      <th scope="row">Set ${r.index} · ${esc(languageName(r.lang))} · ${r.mode === 'words' ? 'words' : 'sentences'}</th>
      <td>${r.condition === 'one-voice-whole' ? 'one voice, whole text' : 'two voices, per line'}</td>
      <td class="num">${r.calls}</td>
      <td class="num">${r.seconds.toFixed(1)}s</td>
      <td class="num">${r.costUsd != null ? usd(r.costUsd, 5) : '—'}${
        r.costUsd != null && !r.costKnown
          ? `<span class="footnote-ref" title="billed cost returned for ${r.pricedCalls} of ${r.calls} calls; scaled">*</span>`
          : ''
      }</td>
    </tr>`,
  )
  .join('\n');

const cadences: [string, number][] = [
  ['A story every 30 new cards, 30 cards a day', 30],
  ['One a day', 30],
  ['Three a week', 13],
  ['Heavy user, three a day', 90],
];
const cadenceRows = [...new Map(cadences.map((c) => [c[1], c])).values()]
  .sort((a, b) => a[1] - b[1])
  .map(
    ([label, n]) => `<tr>
      <th scope="row">${esc(label)}</th>
      <td class="num">${n}</td>
      <td class="num">${usd(monthly(n), 2)}</td>
    </tr>`,
  )
  .join('\n');

const html = `<title>Ten Cards, One Story</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Petrona:ital,wght@0,400;0,600;0,700;1,400&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {
  --paper: #f4f4f1;
  --surface: #fbfbf9;
  --surface-2: #ececeA;
  --ink: #191b1a;
  --ink-soft: #4a4f4c;
  --muted: #6b706d;
  --rule: #d8d9d3;
  --rule-strong: #bcbeb6;
  --accent: #12574b;
  --accent-soft: #e0ece8;
  --mark: #f4e6a6;
  --mark-edge: #8a6d1f;
  --plum: #7a3b5c;
  --miss: #b0b3ac;
  --shadow: 0 1px 2px rgba(25, 27, 26, .06);

  --serif: 'Petrona', Georgia, 'Times New Roman', serif;
  --sans: 'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #131614;
    --surface: #1b1f1d;
    --surface-2: #232725;
    --ink: #e9eae5;
    --ink-soft: #c2c6c1;
    --muted: #8d938e;
    --rule: #2e332f;
    --rule-strong: #414741;
    --accent: #6cc0ab;
    --accent-soft: #1e2f2b;
    --mark: #4a3f1c;
    --mark-edge: #e2c877;
    --plum: #d195b1;
    --miss: #5a605a;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4);
  }
}
:root[data-theme="dark"] {
  --paper: #131614;
  --surface: #1b1f1d;
  --surface-2: #232725;
  --ink: #e9eae5;
  --ink-soft: #c2c6c1;
  --muted: #8d938e;
  --rule: #2e332f;
  --rule-strong: #414741;
  --accent: #6cc0ab;
  --accent-soft: #1e2f2b;
  --mark: #4a3f1c;
  --mark-edge: #e2c877;
  --plum: #d195b1;
  --miss: #5a605a;
  --shadow: 0 1px 2px rgba(0, 0, 0, .4);
}

* { box-sizing: border-box; }
/* .set sets display:flex, which outranks the UA's [hidden] rule, so the
   mode toggle needs this to actually hide anything. */
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.wrap {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(28px, 5vw, 64px) clamp(18px, 4vw, 40px) 96px;
  display: flex;
  flex-direction: column;
  gap: clamp(44px, 6vw, 72px);
}
h1, h2, h3, h4 { text-wrap: balance; margin: 0; }
p { margin: 0; }
a { color: var(--accent); }

/* ---------------------------------------------------------------- header */
.masthead { display: flex; flex-direction: column; gap: 18px; }
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--muted);
}
.masthead h1 {
  font-family: var(--serif);
  font-weight: 700;
  font-size: clamp(38px, 6.5vw, 62px);
  line-height: 1.02;
  letter-spacing: -.015em;
}
.standfirst {
  font-family: var(--serif);
  font-size: clamp(17px, 2.1vw, 20px);
  line-height: 1.5;
  color: var(--ink-soft);
  max-width: 62ch;
}
.standfirst em { color: var(--ink); font-style: italic; }
.provenance {
  display: flex;
  flex-wrap: wrap;
  gap: 0 28px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
.provenance b { color: var(--ink-soft); font-weight: 500; }

/* ----------------------------------------------------------------- money */
.section__head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
.section__head h2 {
  font-family: var(--serif);
  font-size: clamp(26px, 3.4vw, 34px);
  font-weight: 600;
  letter-spacing: -.01em;
}
.section__head p { color: var(--ink-soft); max-width: 66ch; }

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
  border-radius: 3px;
  overflow: hidden;
}
.tile { background: var(--surface); padding: 20px 22px 18px; display: flex; flex-direction: column; gap: 6px; }
.tile__label {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: .11em;
  text-transform: uppercase;
  color: var(--muted);
}
.tile__value {
  font-family: var(--mono);
  font-size: 27px;
  font-weight: 500;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.tile__value small { font-size: 14px; color: var(--muted); letter-spacing: 0; }
.tile__note { font-size: 12.5px; color: var(--muted); line-height: 1.4; }
.tile--accent .tile__value { color: var(--accent); }

.tables { display: grid; gap: 28px; margin-top: 30px; }
@media (min-width: 860px) { .tables { grid-template-columns: 1.35fr 1fr; } }
.table-block { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.table-block h3 {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
caption { text-align: left; color: var(--muted); font-size: 12.5px; padding-bottom: 8px; }
th, td { text-align: left; padding: 9px 14px 9px 0; border-bottom: 1px solid var(--rule); white-space: nowrap; }
thead th {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: .09em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 400;
  border-bottom: 1px solid var(--rule-strong);
}
tbody th { font-weight: 500; }
td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: none; }
.footnote-ref { color: var(--plum); font-family: var(--sans); }
.footnote { font-size: 12.5px; color: var(--muted); max-width: 60ch; }

.prompts { margin-bottom: 26px; border: 1px solid var(--rule); border-radius: 3px; background: var(--surface); }
.prompts > summary { padding: 11px 16px; font-size: 13.5px; color: var(--ink-soft); cursor: pointer; }
.prompts > summary:focus-visible { outline: 2px solid var(--mark-edge); outline-offset: -2px; }
.prompts > .footnote { padding: 0 16px 14px; }
.prompts__grid { display: grid; gap: 20px; padding: 4px 16px 14px; }
@media (min-width: 820px) { .prompts__grid { grid-template-columns: 1.5fr 1fr; } }
.prompt { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.prompt h3 {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: .11em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 400;
}
.prompt pre {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-soft);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 12px 14px;
  background: var(--paper);
  border-left: 2px solid var(--accent);
  border-radius: 0 2px 2px 0;
}

/* --------------------------------------------------------------- reader */
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 3px;
  position: sticky;
  top: 0;
  z-index: 5;
}
.controls__label {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: .11em;
  text-transform: uppercase;
  color: var(--muted);
}
.segmented { display: flex; border: 1px solid var(--rule-strong); border-radius: 2px; overflow: hidden; }
.segmented button {
  font-family: var(--sans);
  font-size: 13.5px;
  padding: 7px 15px;
  border: none;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}
.segmented button + button { border-left: 1px solid var(--rule-strong); }
.segmented button[aria-pressed="true"] { background: var(--accent); color: var(--surface); }
.segmented button:focus-visible { outline: 2px solid var(--mark-edge); outline-offset: -2px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: var(--muted); margin-left: auto; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 22px; height: 11px; border-radius: 1px; }
.swatch--mark { background: var(--mark); box-shadow: inset 0 -2px 0 var(--mark-edge); }
.swatch--miss { background: var(--miss); }

.sets { display: flex; flex-direction: column; gap: 40px; margin-top: 26px; }
.set { display: flex; flex-direction: column; gap: 16px; }
.set__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid var(--rule-strong); padding-bottom: 8px; }
.set__no { font-family: var(--serif); font-size: 21px; font-weight: 600; }
.band {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: .08em;
  padding: 2px 7px;
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 2px;
}
.set__note { font-size: 12.5px; color: var(--muted); }

.split { display: grid; gap: 26px; }
@media (min-width: 900px) { .split { grid-template-columns: 1fr 1fr; } }
.lane { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.lane__lang {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 400;
}
.story { display: flex; flex-direction: column; gap: 14px; }
.story--empty { color: var(--plum); font-size: 14px; font-style: italic; }
.story__title { font-family: var(--serif); font-size: 21px; font-weight: 600; line-height: 1.2; }
.story__title-en { font-size: 13.5px; color: var(--muted); font-style: italic; }

.dialogue { display: flex; flex-direction: column; }
.turn {
  display: grid;
  grid-template-columns: 74px 1fr 22px;
  gap: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--rule);
  align-items: baseline;
}
.turn:last-child { border-bottom: 1px solid var(--rule); }
.turn__who {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.turn__body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.turn__target { font-family: var(--serif); font-size: 17px; line-height: 1.4; color: var(--ink); overflow-wrap: break-word; }
.turn__gloss { font-size: 13px; line-height: 1.45; color: var(--muted); overflow-wrap: break-word; }
mark { background: var(--mark); color: inherit; box-shadow: inset 0 -2px 0 var(--mark-edge); padding: 0 1px; border-radius: 1px; }
.turn__tag { text-align: right; }
.drilled-no {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--mark-edge);
  font-variant-numeric: tabular-nums;
}

.chips { display: flex; flex-wrap: wrap; gap: 0; margin: 0; border: 1px solid var(--rule); border-radius: 3px; background: var(--surface); }
.chip { display: flex; flex-direction: column; gap: 1px; padding: 8px 14px; flex: 1 1 auto; }
.chip + .chip { border-left: 1px solid var(--rule); }
.chip dt { font-family: var(--mono); font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.chip dd { margin: 0; font-family: var(--mono); font-size: 15px; font-variant-numeric: tabular-nums; color: var(--ink); }
.chip dd span { font-size: 11px; color: var(--muted); }
.chip--new dd { color: var(--plum); }

.drilled-wrap summary { font-size: 13px; color: var(--muted); cursor: pointer; padding: 4px 0; }
.drilled-wrap summary:focus-visible { outline: 2px solid var(--mark-edge); outline-offset: 2px; }
.drilled { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.drilled li { display: grid; grid-template-columns: 20px 1fr; gap: 8px; font-size: 14px; line-height: 1.35; }
.drilled__no { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.is-used .drilled__text { color: var(--ink); box-shadow: inset 0 -2px 0 var(--mark-edge); }
.is-missed .drilled__text { color: var(--miss); text-decoration: line-through; text-decoration-color: var(--miss); }

/* --------------------------------------------------------------- verdict */
.findings { display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 3px; }
@media (min-width: 780px) { .findings { grid-template-columns: 1fr 1fr; } }
.finding { background: var(--surface); padding: 20px 22px; display: flex; flex-direction: column; gap: 7px; }
.finding h3 { font-family: var(--serif); font-size: 18px; font-weight: 600; }
.finding p { font-size: 14.5px; color: var(--ink-soft); line-height: 1.5; }
.finding--open h3 { color: var(--plum); }

footer { border-top: 1px solid var(--rule); padding-top: 18px; font-size: 12.5px; color: var(--muted); }
code { font-family: var(--mono); font-size: .92em; background: var(--surface-2); padding: 1px 5px; border-radius: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">

  <header class="masthead">
    <p class="eyebrow">Feature prototype · ${new Date(data.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <h1>Ten Cards, One Story</h1>
    <p class="standfirst">Pierre Boralevi asked for the thing Taalhammer does and Glossika doesn't: after a run of flashcards, <em>a short dialogue that puts the sentences you just drilled back into context</em>. This is what our own catalogue plus Gemini 3.8 Flash actually produces — the same ten source sentences told in English and German, twice over, and what each one costs to write and to voice.</p>
    <div class="provenance">
      <span><b>Model</b> ${esc(data.model)}</span>
      <span><b>Voice</b> ${esc(data.ttsModel)}</span>
      <span><b>Source</b> sentences_translated.csv</span>
      <span><b>Sets</b> ${sets.length} × ${data.perStory} cards</span>
      <span><b>Seed</b> ${data.seed}</span>
    </div>
  </header>

  <section>
    <div class="section__head">
      <h2>What a story costs</h2>
      <p>Every figure below is billed USD read back from OpenRouter, not a list-price estimate. Audio dominates the bill by roughly an order of magnitude — and audio is the part Pierre wants to replay, which is the whole economic argument: a story is written and voiced once, then stored like any other library text and replayed for free.</p>
    </div>
    <div class="tiles">
      <div class="tile">
        <span class="tile__label">Writing a story</span>
        <span class="tile__value">${usd(llmPerStory, 4)}</span>
        <span class="tile__note">mean over ${data.results.length} generations, ${latency.toFixed(1)}s each</span>
      </div>
      <div class="tile">
        <span class="tile__label">Voicing it, two speakers</span>
        <span class="tile__value">${usd(ttsStitchedPerStory, 4)}</span>
        <span class="tile__note">${audioSeconds.toFixed(0)}s of audio, one call per line</span>
      </div>
      <div class="tile tile--accent">
        <span class="tile__label">All-in, per story</span>
        <span class="tile__value">${usd(perStoryTotal, 4)}</span>
        <span class="tile__note">${usd(usdPerAudioSecond * 60, 3)} per minute of finished dialogue</span>
      </div>
      <div class="tile">
        <span class="tile__label">A daily story, monthly</span>
        <span class="tile__value">${usd(monthly(30), 2)}</span>
        <span class="tile__note">per subscriber, replays free</span>
      </div>
    </div>

    <div class="tables">
      <div class="table-block">
        <h3>Measured speech runs</h3>
        <div class="scroll">
          <table>
            <caption>Both ways of voicing a dialogue. OpenRouter drops Gemini's multi-speaker config, so two voices means one call per line, stitched.</caption>
            <thead><tr><th>Story</th><th>Method</th><th>Calls</th><th>Audio</th><th>Billed</th></tr></thead>
            <tbody>
${ttsRows}
            </tbody>
          </table>
        </div>
        <p class="footnote">Splitting one text into per-line calls costs about the same as voicing it whole: the bill tracks audio seconds, and the repeated instruction preamble is a rounding error. <span class="footnote-ref">*</span> scaled from the calls whose billed cost the generation endpoint returned in time.</p>
      </div>
      <div class="table-block">
        <h3>Per subscriber, per month</h3>
        <div class="scroll">
          <table>
            <thead><tr><th>Cadence</th><th>Stories</th><th>Cost</th></tr></thead>
            <tbody>
${cadenceRows}
            </tbody>
          </table>
        </div>
        <p class="footnote">Against the €5–10 a month Pierre said he would pay. Even the heavy case leaves the margin intact, and none of it recurs when he listens again.</p>
      </div>
    </div>
  </section>

  <section>
    <div class="section__head">
      <h2>Two ways to ask</h2>
      <p><strong>Sentences</strong> hands the model the drilled sentences and asks it to re-use them word for word — a recap. <strong>Words</strong> hands it only the words from those cards, shuffled, and asks for a conversation that stays inside their difficulty — a new text pitched at what the learner just practised. The word list is <em>not</em> a vocabulary fence: someone drilling these ten cards knows thousands of other words, so the prompt sets a ceiling on difficulty rather than banning everything outside the list.</p>
    </div>
    <details class="prompts">
      <summary>The two prompts, verbatim</summary>
      <div class="prompts__grid">
        <div class="prompt">
          <h3>Sentences</h3>
          <pre>${esc(PROMPT_SENTENCES)}</pre>
        </div>
        <div class="prompt">
          <h3>Words</h3>
          <pre>${esc(PROMPT_WORDS)}</pre>
        </div>
      </div>
      <p class="footnote">Both then specify the JSON shape the page is built from. Shuffling the word list matters: in sentence order it leaks the sentences themselves, and the model just reassembles them.</p>
    </details>
    <div class="scroll">
      <table>
        <thead><tr><th>Language</th><th>Prompt</th><th>Cards re-used</th><th>Words</th><th>Off-card words</th><th>Cost</th></tr></thead>
        <tbody>
${summaryRows}
        </tbody>
      </table>
    </div>
    <p class="footnote" style="margin-top:10px">“Cards re-used” counts drilled sentences reproduced word for word. “Off-card words” is the share of the story's words that came from outside these ten cards — words the learner may well know, but which this session did not practise. It is a proxy for how far a story drifts from what was just drilled, not a claim about the learner's vocabulary.</p>
  </section>

  <section>
    <div class="section__head">
      <h2>Read them</h2>
      <p>Same ten source sentences down each pair of columns, so the English and the German are directly comparable. Highlighted spans are drilled sentences the model put back verbatim.</p>
    </div>
    <div class="controls">
      <span class="controls__label">Prompt</span>
      <div class="segmented" role="group" aria-label="Prompt variant">
        <button type="button" data-show="sentences" aria-pressed="true">Sentences</button>
        <button type="button" data-show="words" aria-pressed="false">Words</button>
      </div>
      <div class="legend">
        <span><i class="swatch swatch--mark"></i> drilled sentence, verbatim</span>
        <span><i class="swatch swatch--miss"></i> card the story skipped</span>
      </div>
    </div>
    <div class="sets">
${sets.map((i) => `${setSection(i, 'sentences')}\n${setSection(i, 'words')}`).join('\n')}
    </div>
  </section>

  <section>
    <div class="section__head">
      <h2>What this run says</h2>
    </div>
    <div class="findings">
      <div class="finding">
        <h3>The recap works</h3>
        <p>Fed the sentences, the model puts ${pct(verbatimRate('sentences'))} of them back word for word and builds a scene around them. That is the behaviour Pierre described, at ${usd(llmPerStory, 4)} a text.</p>
      </div>
      <div class="finding">
        <h3>The word prompt stays close to home</h3>
        <p>Only ${pct(newShare('words'))} of its words come from outside the ten cards, against ${pct(newShare('sentences'))} for the sentence prompt, whose connective tissue is where the drift happens. It re-uses almost no sentence verbatim (${pct(verbatimRate('words'))}), which is the point: a new text, not a recap.</p>
      </div>
      <div class="finding finding--open">
        <h3>A simple prompt buys a short one</h3>
        <p>With no length instruction the model stops at ${Math.round(words('words'))} words — a third of the sentence prompt's ${Math.round(words('sentences'))}, and well under the 100–250 Pierre asked for. One clause about length would fix it; the question is how much else has to come back with it.</p>
      </div>
      <div class="finding finding--open">
        <h3>English wobbles where German doesn't</h3>
        <p>Asked to lean on a word list, some English conversations bend grammar to fit it — “as if we was in part of the audience” — while the German stays clean. Not a scoreable metric here, but read set 3 and set 5 side by side before trusting the loose prompt.</p>
      </div>
      <div class="finding">
        <h3>Speech is the only real cost</h3>
        <p>Writing is ${(ttsStitchedPerStory / Math.max(llmPerStory, 1e-9)).toFixed(0)}× cheaper than voicing. Any lever that matters — length, cadence, whether replays re-synthesise — is an audio lever. Note the words column: shorter stories are cheaper twice over.</p>
      </div>
      <div class="finding finding--open">
        <h3>Still open</h3>
        <p>Two voices need per-line stitching until Gemini's multi-speaker config survives OpenRouter. Nothing here checks the target-language text for errors the way the translation pipeline does. And the catalogue has MSA but no Levantine, so Pierre's own case is untested.</p>
      </div>
    </div>
  </section>

  <footer>
    Generated by <code>scripts/story-prototype.ts</code> · ${data.results.length} stories · total LLM spend ${usd(data.llmSpendUsd, 4)} · sampled with seed ${data.seed} from the ${data.perStory}-card sets shown above.
  </footer>
</div>

<script>
  const buttons = document.querySelectorAll('.segmented button');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.show;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      document.querySelectorAll('.set').forEach((set) => {
        set.hidden = set.dataset.mode !== mode;
      });
    });
  });
</script>
`;

writeFileSync(resolve(OUT_DIR, 'review.html'), html);
console.log(`Wrote ${OUT_DIR}/review.html`);
