/**
 * Verify every ElevenLabs voice_id referenced in lib/languages.ts is
 * available on the account behind ELEVENLABS_API_KEY — and generate a
 * browsable HTML review page with a short MP3 sample per (voice × language)
 * so you can audition each voice in the language it's assigned to.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=sk_... npx tsx scripts/check-elevenlabs-voices.ts
 *   # then open scripts/voice-samples/index.html in a browser
 *
 * Flags:
 *   --no-samples    skip MP3 generation; just check availability
 *   --limit=N       cap total sample generations (debug)
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from '../lib/languages';
import { VOICE_POOLS, type Voice } from '../lib/voices';

// Mirrors toElevenLabsLanguageCode in convex/features/tts.ts so samples use
// the same language_code the app would send at runtime.
function toElevenLabsLanguageCode(internalCode: string): string {
  const map: Record<string, string> = { es_latam: 'es', cmn: 'zh' };
  return map[internalCode] ?? internalCode;
}

const SAMPLE_TEXT: Record<string, string> = {
  en: 'The early morning light filtered through the window as she poured herself a cup of coffee.',
  es: 'Me gusta mucho caminar por la playa al atardecer mientras escucho música.',
  es_latam: 'Me encanta caminar por la playa al atardecer mientras escucho música.',
  fr: 'Le soleil se couche lentement derrière les montagnes pendant que je lis un livre.',
  de: 'Die Sonne geht langsam hinter den Bergen unter, während ich ein Buch lese.',
  it: 'Mi piace molto ascoltare musica mentre cammino lungo la spiaggia al tramonto.',
  pt: 'Eu adoro caminhar pela praia ao pôr do sol enquanto escuto música.',
  ru: 'Я очень люблю гулять по парку вечером и слушать тихую музыку.',
  hi: 'मुझे शाम को पार्क में टहलना और शांत संगीत सुनना बहुत पसंद है।',
  zh: '我非常喜欢在傍晚的时候去公园散步并听一些轻音乐。',
  ja: '夕方に公園を散歩して静かな音楽を聴くのが大好きです。',
  ko: '저는 저녁에 공원을 산책하며 조용한 음악을 듣는 것을 좋아합니다.',
  vi: 'Tôi rất thích đi dạo trong công viên vào buổi tối và nghe nhạc nhẹ.',
  sv: 'Jag tycker verkligen om att ta en lugn promenad i parken på kvällen.',
  fi: 'Pidän todella paljon rauhallisesta iltakävelystä puistossa.',
  nl: 'Ik wandel graag in het park in de avond terwijl ik naar muziek luister.',
  el: 'Μου αρέσει πολύ να περπατάω στο πάρκο το βράδυ ακούγοντας ήσυχη μουσική.',
  ar: 'أحب التنزه في الحديقة في المساء والاستماع إلى الموسيقى الهادئة.',
};

const MODEL_ID = 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'mp3_44100_128';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'voice-samples');

const args = new Set(process.argv.slice(2));
const generateSamples = !args.has('--no-samples');
const force = args.has('--force');
const limitArg = [...args].find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type VoiceJob = {
  languageCode: string;
  languageName: string;
  flag: string;
  voice: Voice;
};

function collectJobs(): VoiceJob[] {
  const jobs: VoiceJob[] = [];
  for (const lang of SUPPORTED_LANGUAGES) {
    const pool = VOICE_POOLS[lang.code] ?? [];
    for (const voice of pool) {
      if (voice.provider !== 'elevenlabs') continue;
      jobs.push({
        languageCode: lang.code,
        languageName: lang.name,
        flag: lang.flag,
        voice,
      });
    }
  }
  return jobs;
}

async function synthesizeSample(
  text: string,
  voiceId: string,
  languageCode: string,
  apiKey: string,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        language_code: toElevenLabsLanguageCode(languageCode),
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.9 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sampleFileName(job: VoiceJob): string {
  // Unique filename per (voice × language) so the same voice assigned to
  // multiple languages gets separate samples.
  const safeName = job.voice.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `${job.languageCode}__${safeName}__${job.voice.apiCode}.mp3`;
}

type JobResult = {
  job: VoiceJob;
  available: boolean;
  error?: string;
  sampleFile?: string;
  cached?: boolean;
};

/**
 * Availability is proved by actually synthesizing a sample — the only
 * permission the app's key needs is text_to_speech. A successful response
 * means the voice exists and is usable; a 404/400 voice-not-found means it
 * doesn't exist. This also gives us the audio file to review in the HTML.
 *
 * If an MP3 for the exact (language, voice name, voice_id) tuple already
 * exists on disk, we skip the API call entirely and reuse the cached audio.
 * Pass `--force` to regenerate everything.
 */
async function runJob(job: VoiceJob, apiKey: string): Promise<JobResult> {
  const text = SAMPLE_TEXT[job.languageCode];
  if (!text) {
    return {
      job,
      available: false,
      error: `no sample text for language "${job.languageCode}"`,
    };
  }

  const fname = sampleFileName(job);
  if (generateSamples && !force && (await fileExists(resolve(OUT_DIR, fname)))) {
    return { job, available: true, sampleFile: fname, cached: true };
  }

  try {
    const bytes = await synthesizeSample(text, job.voice.apiCode, job.languageCode, apiKey);
    if (!generateSamples) {
      return { job, available: true };
    }
    await writeFile(resolve(OUT_DIR, fname), Buffer.from(bytes));
    return { job, available: true, sampleFile: fname };
  } catch (err) {
    return {
      job,
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderHtml(results: JobResult[]): string {
  const byLang = new Map<string, JobResult[]>();
  for (const r of results) {
    const key = r.job.languageCode;
    if (!byLang.has(key)) byLang.set(key, []);
    byLang.get(key)!.push(r);
  }

  const totalVoices = new Set(results.map((r) => r.job.voice.apiCode)).size;
  const unavailable = results.filter((r) => !r.available);
  const uniqueUnavailable = new Set(unavailable.map((r) => r.job.voice.apiCode)).size;

  const sections: string[] = [];
  for (const lang of SUPPORTED_LANGUAGES) {
    const rows = byLang.get(lang.code);
    if (!rows) continue;
    sections.push(`
      <section>
        <h2>${lang.flag} ${lang.name} <code class="small">(${lang.code})</code></h2>
        <div class="grid">
          ${rows
            .map((r) => {
              const v = r.job.voice;
              const genderBadge = v.gender === 'female' ? '♀' : '♂';
              const status = r.available
                ? '<span class="ok">✓ available</span>'
                : `<span class="err">✗ ${r.error ?? 'missing'}</span>`;
              const audio = r.sampleFile
                ? `<audio controls preload="none" src="${r.sampleFile}"></audio>`
                : r.error && !r.available
                  ? `<span class="err small">${r.error}</span>`
                  : '<span class="small">(no sample)</span>';
              return `
                <div class="card ${r.available ? '' : 'card-err'}">
                  <div class="card-head">
                    <strong>${genderBadge} ${v.name}</strong>
                    <span class="small mono">${v.apiCode}</span>
                  </div>
                  <div class="small">${status}</div>
                  <div>${audio}</div>
                </div>
              `;
            })
            .join('')}
        </div>
      </section>
    `);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>ElevenLabs voice review</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { margin: 0 0 .3rem; }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: .3rem; margin-top: 2.5rem; }
    .summary { background: #f4f4f4; padding: .75rem 1rem; border-radius: 6px; margin: 1rem 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .card { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; background: #fff; display: flex; flex-direction: column; gap: 6px; }
    .card-err { border-color: #c00; background: #fff5f5; }
    .card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .ok { color: #080; font-weight: 600; }
    .err { color: #c00; font-weight: 600; }
    .small { font-size: 12px; color: #666; }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
    .labels { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { background: #eef; color: #336; padding: 1px 6px; border-radius: 3px; font-size: 11px; }
    audio { width: 100%; height: 32px; }
    code { background: #eee; padding: 1px 5px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>ElevenLabs voice review</h1>
  <div class="summary">
    <strong>${totalVoices}</strong> unique voices across <strong>${SUPPORTED_LANGUAGES.length}</strong> languages.
    ${uniqueUnavailable > 0
      ? `<span class="err">${uniqueUnavailable} NOT available on this account</span>`
      : '<span class="ok">All voice IDs resolved successfully</span>'}.
    Generated ${new Date().toISOString()}.
  </div>
  ${sections.join('\n')}
</body>
</html>`;
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY env var is required');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const jobs = collectJobs().slice(0, limit);
  console.log(
    `Checking ${jobs.length} (voice × language) pairs ` +
      `(${new Set(jobs.map((j) => j.voice.apiCode)).size} unique voices)…`,
  );

  // Serialize requests — ElevenLabs free/starter plans cap at 3 concurrent
  // requests. Going one-at-a-time avoids flaky 429s. Cached entries are
  // near-instant so a full run usually only pays for newly-changed voices.
  const results: JobResult[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const res = await runJob(job, apiKey);
    results.push(res);
    const tick = res.available ? '✓' : '✗';
    const sample = res.cached ? ' ⋯ cached' : res.sampleFile ? ' 🔊 generated' : '';
    console.log(
      `  [${i + 1}/${jobs.length}] ${tick} ${job.flag} ${job.languageCode} ` +
        `${job.voice.name} (${job.voice.apiCode})${sample}` +
        (res.error ? `  — ${res.error}` : ''),
    );
    // Small gap between calls when we actually hit the API, to stay under
    // the concurrency cap. Cached hits can go back-to-back.
    if (!res.cached) await sleep(120);
  }

  const html = renderHtml(results);
  const htmlPath = resolve(OUT_DIR, 'index.html');
  await writeFile(htmlPath, html);

  const missing = results.filter((r) => !r.available);
  const generated = results.filter((r) => r.sampleFile && !r.cached).length;
  const cached = results.filter((r) => r.cached).length;
  console.log('\n----- Summary -----');
  console.log(`generated: ${generated}   cached: ${cached}   failed: ${missing.length}`);
  const uniqMissing = new Set(missing.map((r) => r.job.voice.apiCode));
  console.log(
    `${results.length - missing.length}/${results.length} pairs ok — ` +
      `${uniqMissing.size} unique voice IDs unavailable`,
  );
  if (missing.length > 0) {
    console.log('\nUnavailable voices:');
    const shown = new Set<string>();
    for (const r of missing) {
      if (shown.has(r.job.voice.apiCode)) continue;
      shown.add(r.job.voice.apiCode);
      console.log(`  - ${r.job.voice.name} (${r.job.voice.apiCode}) — ${r.error}`);
    }
  }
  console.log(`\nReview page:  file://${htmlPath}`);

  if (uniqMissing.size > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
