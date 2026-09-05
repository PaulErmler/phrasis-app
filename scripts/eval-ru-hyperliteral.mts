/**
 * Probe: can Gemini 3.1 Flash Lite produce, for a Russian sentence, (1) the
 * Cyrillic text with stress marks and (2) a Glossika-style hyper-literal
 * gloss, both from the text and from the audio alone?
 *
 *   pnpm eval:ru-hyperliteral            # five sentences, prints one table
 *   pnpm eval:ru-hyperliteral --no-audio # text condition only
 *
 * Audio is synthesized once per sentence with the production Gemini TTS
 * model (OpenRouter, PCM wrapped as WAV) and cached under .scratch/ru-hyperliteral/
 * so a re-run only pays for the model calls. The key is read from the
 * environment by name; nothing here opens .env.local.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ttsDeliveryInstruction } from '../convex/lib/tts/deliveryInstruction';

const MODEL = 'google/gemini-3.1-flash-lite';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OUT_DIR = resolve('.scratch/ru-hyperliteral');

// Synthesis mirrors convex/lib/tts/gemini.ts (same model, prompt shape and
// voice) but is inlined like scripts/generate-landing-audio.mts does, because
// the Convex provider's lamejs import does not resolve under tsx. The PCM is
// wrapped as WAV instead of transcoded: the model accepts WAV directly.
const TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';
const TTS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const VOICE = 'Kore';
const PCM_SAMPLE_RATE = 24000;

const fmtUsd = (x: number) => `$${x.toFixed(4)}`;
const stripJsonFences = (s: string) =>
  s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

/** Reference stress placed by hand (combining acute U+0301 after the vowel;
 *  ё carries its own stress; monosyllables unmarked). Used only to flag where
 *  the model disagrees. Sentence 2 has the за́мок/замо́к homograph. */
const SENTENCES: { text: string; stressed: string }[] = [
  { text: 'Я не знаю, где мои ключи.', stressed: 'Я не зна́ю, где мои́ ключи́.' },
  {
    text: 'На двери висит большой замок.',
    stressed: 'На двери́ виси́т большо́й замо́к.',
  },
  {
    text: 'Мне нравится гулять по городу вечером.',
    stressed: 'Мне нра́вится гуля́ть по го́роду ве́чером.',
  },
  { text: 'У неё нет времени на это.', stressed: 'У неё нет вре́мени на э́то.' },
  {
    text: 'Он сказал, что придёт позже.',
    stressed: 'Он сказа́л, что придёт по́зже.',
  },
];

const GLOSS_RULES = `A hyper-literal translation renders the Russian word for word into English:
- keep the Russian word order exactly;
- one gloss per Russian word; when one Russian word needs several English words, join them with hyphens (e.g. "нравится" → "pleases", "мне" → "to-me", "у меня" → "at me");
- keep prepositions and particles literal ("у" → "at", "не" → "not", "что" → "that"), never idiomatic;
- where Russian omits a word English needs (the copula), do not add it;
- keep the original punctuation.
Stress marks: write the sentence in Cyrillic and put the combining acute accent (U+0301) directly after the stressed vowel of every word with two or more syllables. Leave ё unmarked (it is always stressed) and leave monosyllables unmarked.`;

type Parsed = { transcript?: string; stressed: string; hyperliteral: string };

type Call = { parsed: Parsed | null; raw: string; costUsd: number; ms: number };

function parse(raw: string): Parsed | null {
  try {
    const j = JSON.parse(stripJsonFences(raw.trim())) as Record<string, unknown>;
    if (typeof j.stressed !== 'string' || typeof j.hyperliteral !== 'string') {
      return null;
    }
    return {
      transcript: typeof j.transcript === 'string' ? j.transcript : undefined,
      stressed: j.stressed,
      hyperliteral: j.hyperliteral,
    };
  } catch {
    return null;
  }
}

async function chat(content: unknown[]): Promise<Call> {
  const startedAt = Date.now();
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      usage: { include: true },
      temperature: 0,
      max_tokens: 600,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return {
    parsed: parse(raw),
    raw,
    costUsd: data.usage?.cost ?? 0,
    ms: Date.now() - startedAt,
  };
}

function fromText(text: string): Promise<Call> {
  return chat([
    {
      type: 'text',
      text: `${GLOSS_RULES}\n\nFor this Russian sentence return JSON only, shape {"stressed": string, "hyperliteral": string}.\n\nSentence: ${text}`,
    },
  ]);
}

function fromAudio(wav: Buffer): Promise<Call> {
  return chat([
    {
      type: 'text',
      text: `${GLOSS_RULES}\n\nListen to this Russian audio. Return JSON only, shape {"transcript": string, "stressed": string, "hyperliteral": string}: the verbatim transcript with standard spelling and punctuation, the same transcript with stress marks, and the hyper-literal translation. Do not translate idiomatically anywhere.`,
    },
    {
      type: 'input_audio',
      input_audio: { data: wav.toString('base64'), format: 'wav' },
    },
  ]);
}

/** 44-byte RIFF header in front of 16-bit mono little-endian PCM. */
function pcmToWav(pcm: Uint8Array): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(PCM_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

async function synthesize(i: number, text: string): Promise<Buffer> {
  const path = resolve(OUT_DIR, `${i + 1}.wav`);
  if (existsSync(path)) return readFileSync(path);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: `## Instruction: ${ttsDeliveryInstruction('Russian')}\n\n## Transcript: ${text}`,
        voice: VOICE,
        response_format: 'pcm',
        speed: 1,
        provider: { options: { google: { language_code: 'ru-RU' } } },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const pcm = new Uint8Array(await res.arrayBuffer());
    if (pcm.byteLength === 0) continue; // OpenRouter's intermittent empty 200
    const wav = pcmToWav(pcm);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path, wav);
    return wav;
  }
  throw new Error(`Gemini TTS returned empty audio three times for "${text}"`);
}

/** Strip the acute so a stress diff compares letters only; back to NFC so
 *  й and ё (decomposed by NFD) compare equal to the source. */
const plain = (s: string) =>
  s.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');

/** Canonical stressed form: NFC, and an acute on ё dropped (ё is stressed
 *  by definition, so marking it is redundant rather than wrong). */
const canon = (s: string) => s.normalize('NFC').replace(/ё\u0301/g, 'ё');

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set. Run via: pnpm eval:ru-hyperliteral');
    process.exit(1);
  }
  const withAudio = !process.argv.includes('--no-audio');
  let spent = 0;
  const rows: string[] = ['Text | letters | hyperliteral 1 (text) | hyperliteral 2 (audio)'];
  const notes: string[] = [];

  for (const [i, s] of SENTENCES.entries()) {
    const t = await fromText(s.text);
    spent += t.costUsd;
    let a: Call | null = null;
    if (withAudio) {
      const wav = await synthesize(i, s.text);
      a = await fromAudio(wav);
      spent += a.costUsd;
    }
    const letters = t.parsed?.stressed ?? `<unparsed: ${t.raw.slice(0, 60)}>`;
    rows.push(
      [
        s.text,
        letters,
        t.parsed?.hyperliteral ?? '<unparsed>',
        a ? (a.parsed?.hyperliteral ?? `<unparsed: ${a.raw.slice(0, 60)}>`) : '(skipped)',
      ].join(' | '),
    );

    const n = i + 1;
    if (t.parsed && canon(t.parsed.stressed) !== canon(s.stressed)) {
      notes.push(`#${n} text stress differs from reference: ${t.parsed.stressed}  (ref ${s.stressed})`);
    }
    if (a?.parsed) {
      if (a.parsed.transcript && plain(a.parsed.transcript) !== s.text) {
        notes.push(`#${n} audio transcript: ${a.parsed.transcript}`);
      }
      if (canon(a.parsed.stressed) !== canon(s.stressed)) {
        notes.push(`#${n} audio stress: ${a.parsed.stressed}  (ref ${s.stressed})`);
      }
    }
    notes.push(
      `#${n} cost text ${fmtUsd(t.costUsd)} ${t.ms}ms` +
        (a ? `, audio ${fmtUsd(a.costUsd)} ${a.ms}ms` : ''),
    );
  }

  console.log(rows.join('\n'));
  console.log('\n' + notes.join('\n'));
  console.log(`\nmodel ${MODEL}, total ${fmtUsd(spent)}`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'report.txt'), rows.join('\n') + '\n\n' + notes.join('\n') + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
