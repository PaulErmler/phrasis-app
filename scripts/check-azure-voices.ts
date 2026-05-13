/**
 * Verify every Azure Speech voice referenced in lib/voices.ts is available
 * in the Azure region behind AZURE_SPEECH_API_KEY / AZURE_SPEECH_REGION,
 * and generate a browsable HTML review page with a short MP3 sample per
 * (voice × language).
 *
 * Usage:
 *   AZURE_SPEECH_API_KEY=... AZURE_SPEECH_REGION=westeurope \
 *     npx tsx scripts/check-azure-voices.ts
 *   # then open scripts/voice-samples/azure/index.html in a browser
 *
 * Flags:
 *   --no-samples           skip MP3 generation; just check availability
 *   --limit=N              cap total sample generations (debug)
 *   --force                regenerate cached samples
 *   --preview              audition every catalog voice for en/de/es (defaults
 *                          to DEFAULT_PREVIEW_LOCALES); rendered as a separate
 *                          section per language alongside any configured voices
 *   --preview=en,de,es,fr  same but pick the language codes explicitly
 */
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from '../lib/languages';
import { VOICE_POOLS, type Voice } from '../lib/voices';

const HERE = dirname(fileURLToPath(import.meta.url));

// `.env.local` is loaded by Next.js but not by tsx, so this script wouldn't
// see AZURE_SPEECH_* even though they're set there. Mirror the loader used
// in tests/integration/*.test.ts so the same vars Just Work.
async function loadEnvLocal() {
  const envPath = resolve(HERE, '..', '.env.local');
  try {
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local is optional — fall back to existing process.env
  }
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

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const OUT_DIR = resolve(HERE, 'voice-samples', 'azure');

const argv = process.argv.slice(2);
const args = new Set(argv);
const generateSamples = !args.has('--no-samples');
const force = args.has('--force');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

// Default Azure locales used for `--preview` auditioning per internal language
// code. Each entry lists every locale whose voices we want to render samples
// for. Edit to add more languages.
const DEFAULT_PREVIEW_LOCALES: Record<string, string[]> = {
  en: ['en-US', 'en-GB'],
  de: ['de-DE'],
  es: ['es-ES'],
};

const previewArg = argv.find((a) => a === '--preview' || a.startsWith('--preview='));
const previewLanguages: string[] | null = previewArg
  ? previewArg === '--preview'
    ? Object.keys(DEFAULT_PREVIEW_LOCALES)
    : previewArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extractLocale(voiceShortName: string): string {
  const parts = voiceShortName.split('-');
  return `${parts[0]}-${parts[1]}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type VoiceJob = {
  languageCode: string;
  languageName: string;
  flag: string;
  voice: Voice;
  /** Where this job came from — drives HTML grouping. */
  source: 'configured' | 'preview';
  /** Azure VoiceType from the catalog ("Neural", "Neural-HD", etc). */
  voiceType?: string;
};

function collectJobs(): VoiceJob[] {
  const jobs: VoiceJob[] = [];
  for (const lang of SUPPORTED_LANGUAGES) {
    const pool = VOICE_POOLS[lang.code] ?? [];
    for (const voice of pool) {
      if (voice.provider !== 'azure') continue;
      jobs.push({
        languageCode: lang.code,
        languageName: lang.name,
        flag: lang.flag,
        voice,
        source: 'configured',
      });
    }
  }
  return jobs;
}

/**
 * Azure exposes a few voice families per locale. We rank them so the preview
 * picks the highest-quality 2F + 2M per language without auditioning the full
 * catalog. Lower number = preferred.
 *
 *   1. HD / DragonHD — newest, highest fidelity (e.g. en-US-Ava:DragonHDLatestNeural)
 *   2. Standard Neural for the native locale — well-tuned, authentic accent
 *   3. Multilingual Neural — good but cross-locale, can sound less native
 */
function voiceQualityRank(v: AzureVoice): number {
  const name = v.ShortName;
  const type = v.VoiceType ?? '';
  if (/HD/i.test(name) || /Dragon/i.test(name) || /HD/i.test(type)) return 1;
  if (/Multilingual/i.test(name)) return 3;
  return 2;
}

const PREVIEW_PER_GENDER = 2;

function collectPreviewJobs(
  languageCodes: string[],
  catalog: AzureVoice[],
): VoiceJob[] {
  const jobs: VoiceJob[] = [];
  for (const code of languageCodes) {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
    if (!lang) {
      console.warn(`  preview: unknown internal language "${code}", skipping`);
      continue;
    }
    const locales = DEFAULT_PREVIEW_LOCALES[code];
    if (!locales) {
      console.warn(`  preview: no locale map for "${code}" — add it to DEFAULT_PREVIEW_LOCALES`);
      continue;
    }
    const matches = catalog.filter((v) => locales.includes(v.Locale));

    // Bucket by gender, sort each bucket by quality rank (then ShortName for
    // stability), and take the top PREVIEW_PER_GENDER from each.
    const females = matches
      .filter((v) => v.Gender.toLowerCase() === 'female')
      .sort(
        (a, b) =>
          voiceQualityRank(a) - voiceQualityRank(b) ||
          a.ShortName.localeCompare(b.ShortName),
      )
      .slice(0, PREVIEW_PER_GENDER);
    const males = matches
      .filter((v) => v.Gender.toLowerCase() === 'male')
      .sort(
        (a, b) =>
          voiceQualityRank(a) - voiceQualityRank(b) ||
          a.ShortName.localeCompare(b.ShortName),
      )
      .slice(0, PREVIEW_PER_GENDER);

    for (const cv of [...females, ...males]) {
      const gender = cv.Gender.toLowerCase() === 'male' ? 'male' : 'female';
      jobs.push({
        languageCode: code,
        languageName: lang.name,
        flag: lang.flag,
        voice: {
          provider: 'azure',
          name: cv.ShortName.replace(/^[a-z]{2,3}-[A-Za-z0-9]+-/, '').replace(/Neural$/, ''),
          displayName: `${cv.ShortName} (${gender}) - ${cv.Locale}`,
          apiCode: cv.ShortName,
          gender,
        },
        source: 'preview',
        voiceType: cv.VoiceType,
      });
    }
  }
  return jobs;
}

type AzureVoice = {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  VoiceType?: string;
  SecondaryLocaleList?: string[];
};

async function fetchVoiceCatalog(
  region: string,
  apiKey: string,
): Promise<AzureVoice[]> {
  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
    {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`voices/list ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as AzureVoice[];
}

async function synthesizeSample(
  text: string,
  voiceShortName: string,
  region: string,
  apiKey: string,
): Promise<ArrayBuffer> {
  const locale = extractLocale(voiceShortName);
  const ssml =
    `<speak version="1.0" xml:lang="${locale}">` +
    `<voice name="${voiceShortName}">${escapeXml(text)}</voice>` +
    `</speak>`;
  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        'User-Agent': 'phrasis-check-azure-voices',
      },
      body: ssml,
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

async function runJob(
  job: VoiceJob,
  region: string,
  apiKey: string,
  catalog: Map<string, AzureVoice>,
): Promise<JobResult> {
  if (!catalog.has(job.voice.apiCode)) {
    return {
      job,
      available: false,
      error: `voice "${job.voice.apiCode}" not in Azure ${region} catalog`,
    };
  }

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
    const bytes = await synthesizeSample(text, job.voice.apiCode, region, apiKey);
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

function renderHtml(results: JobResult[], catalogSize: number, region: string): string {
  const byLang = new Map<string, JobResult[]>();
  for (const r of results) {
    const key = r.job.languageCode;
    if (!byLang.has(key)) byLang.set(key, []);
    byLang.get(key)!.push(r);
  }

  const totalVoices = new Set(results.map((r) => r.job.voice.apiCode)).size;
  const unavailable = results.filter((r) => !r.available);
  const uniqueUnavailable = new Set(unavailable.map((r) => r.job.voice.apiCode)).size;

  function renderCards(rows: JobResult[]): string {
    // Group by gender so it's easy to scan male vs female within a section.
    const sorted = [...rows].sort((a, b) => {
      if (a.job.voice.gender !== b.job.voice.gender) {
        return a.job.voice.gender === 'female' ? -1 : 1;
      }
      return a.job.voice.apiCode.localeCompare(b.job.voice.apiCode);
    });
    return sorted
      .map((r) => {
        const v = r.job.voice;
        const genderBadge = v.gender === 'female' ? '♀' : '♂';
        const typeTag = r.job.voiceType
          ? `<span class="tag">${r.job.voiceType}</span>`
          : '';
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
                  ${typeTag}
                </div>
                <div class="small mono">${v.apiCode}</div>
                <div class="small">${status}</div>
                <div>${audio}</div>
              </div>
            `;
      })
      .join('');
  }

  const sections: string[] = [];
  for (const lang of SUPPORTED_LANGUAGES) {
    const rows = byLang.get(lang.code);
    if (!rows) continue;
    const configured = rows.filter((r) => r.job.source === 'configured');
    const preview = rows.filter((r) => r.job.source === 'preview');
    const subSections: string[] = [];
    if (configured.length > 0) {
      subSections.push(
        `<h3>Configured in lib/voices.ts <span class="small">(${configured.length})</span></h3>` +
          `<div class="grid">${renderCards(configured)}</div>`,
      );
    }
    if (preview.length > 0) {
      subSections.push(
        `<h3>Preview — full catalog <span class="small">(${preview.length})</span></h3>` +
          `<div class="grid">${renderCards(preview)}</div>`,
      );
    }
    sections.push(`
      <section>
        <h2>${lang.flag} ${lang.name} <code class="small">(${lang.code})</code></h2>
        ${subSections.join('\n')}
      </section>
    `);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Azure voice review</title>
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
    .tag { background: #eef; color: #336; padding: 1px 6px; border-radius: 3px; font-size: 11px; }
    h3 { margin: 1.2rem 0 .6rem; font-size: 14px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; }
    audio { width: 100%; height: 32px; }
    code { background: #eee; padding: 1px 5px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Azure voice review — region <code>${region}</code></h1>
  <div class="summary">
    <strong>${totalVoices}</strong> configured Azure voices, region catalog has <strong>${catalogSize}</strong> voices total.
    ${uniqueUnavailable > 0
    ? `<span class="err">${uniqueUnavailable} NOT available in this region</span>`
    : '<span class="ok">All voice IDs resolved successfully</span>'}.
    Generated ${new Date().toISOString()}.
  </div>
  ${sections.join('\n')}
</body>
</html>`;
}

async function main() {
  await loadEnvLocal();
  const apiKey = process.env.AZURE_SPEECH_API_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!apiKey || !region) {
    console.error('AZURE_SPEECH_API_KEY and AZURE_SPEECH_REGION env vars are required');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Fetching Azure voice catalog for region "${region}"…`);
  const catalogList = await fetchVoiceCatalog(region, apiKey);
  const catalog = new Map<string, AzureVoice>(
    catalogList.map((v) => [v.ShortName, v]),
  );
  console.log(`  catalog: ${catalog.size} voices`);

  const configuredJobs = collectJobs();
  const previewJobs = previewLanguages
    ? collectPreviewJobs(previewLanguages, catalogList)
    : [];
  if (previewLanguages) {
    console.log(
      `Preview mode: ${previewJobs.length} catalog voices across ${previewLanguages.join(', ')}`,
    );
  }
  // Configured voices always run; preview voices appended after. Apply the
  // limit across the combined list so --limit caps total API calls.
  const jobs = [...configuredJobs, ...previewJobs].slice(0, limit);
  console.log(
    `Processing ${jobs.length} (voice × language) pairs ` +
      `(${new Set(jobs.map((j) => j.voice.apiCode)).size} unique voices)…`,
  );

  const results: JobResult[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const res = await runJob(job, region, apiKey, catalog);
    results.push(res);
    const tick = res.available ? '✓' : '✗';
    const sample = res.cached ? ' ⋯ cached' : res.sampleFile ? ' 🔊 generated' : '';
    console.log(
      `  [${i + 1}/${jobs.length}] ${tick} ${job.flag} ${job.languageCode} ` +
        `${job.voice.name} (${job.voice.apiCode})${sample}` +
        (res.error ? `  — ${res.error}` : ''),
    );
    if (!res.cached) await sleep(120);
  }

  const html = renderHtml(results, catalog.size, region);
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
