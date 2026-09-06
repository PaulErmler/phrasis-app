/**
 * Live check of the lenient TTS validator prompt (convex/lib/
 * ttsSemanticValidation.ts): every case below is sent to the real judge
 * with the real prompt, and the verdict is compared with the expected one.
 * Run after every prompt edit; the negatives exist so a looser prompt can't
 * pass silently.
 *
 *   pnpm eval:validation
 *
 * The key is read from the environment by name; nothing here opens .env.local.
 */
import { textsMatchSemantic } from '../convex/lib/ttsSemanticValidation';

type Case = {
  language: string;
  original: string;
  transcribed: string;
  expect: 'match' | 'mismatch';
  why: string;
};

const CASES: Case[] = [
  // --- spoken symbols and units
  {
    language: 'es',
    original:
      'Las entradas cuestan 30 $ por persona y 13 $ para los conductores designados.',
    transcribed:
      'Las entradas cuestan 30 dólares por persona y 13 dólares para los conductores designados.',
    expect: 'match',
    why: 'currency symbol spoken as a word',
  },
  {
    language: 'en',
    original: 'The fee is 5% of the total.',
    transcribed: 'The fee is five percent of the total.',
    expect: 'match',
    why: 'percent sign',
  },
  {
    language: 'de',
    original: 'Es sind heute 25 °C.',
    transcribed: 'Es sind heute 25 Grad.',
    expect: 'match',
    why: 'degree sign',
  },
  {
    language: 'fr',
    original: 'Ça coûte 20 € par personne.',
    transcribed: 'Ça coûte vingt euros par personne.',
    expect: 'match',
    why: 'euro sign and number as words',
  },
  // --- alphanumeric identifiers
  {
    language: 'en',
    original: 'e2eImportms6e05af goodbye',
    transcribed: 'E2E import MS6E05A05. Goodbye.',
    expect: 'match',
    why: 'identifier read aloud, one char drifts',
  },
  {
    language: 'es',
    original: 'Gracias e2eImportms6e05af',
    transcribed: 'Gracias a E2I Import M6E05AF.',
    expect: 'match',
    why: 'identifier read aloud, spacing and letters drift',
  },
  {
    language: 'en',
    original: 'Your code is AB12cd.',
    transcribed: 'Your code is A B 12 C D.',
    expect: 'match',
    why: 'letters spelled out',
  },
  // --- contractions and CJK spacing
  {
    language: 'fr',
    original: 'Tu es parti quelque part le week-end dernier ?',
    transcribed: "T'es parti quelque part le week-end dernier ?",
    expect: 'match',
    why: 'elision of the same words',
  },
  {
    language: 'yue_traditional',
    original: '我有幾樣嘢要辦。',
    transcribed: '我 有 幾 樣 嘢 要 辦 。',
    expect: 'match',
    why: 'spaces between characters',
  },
  // --- real mismatches must stay mismatches
  {
    language: 'sv',
    original: 'Vad gör du?',
    transcribed: 'Vad gör ni?',
    expect: 'mismatch',
    why: 'pronoun changed',
  },
  {
    language: 'sv',
    original: 'Ta för dig.',
    transcribed: 'Ta farväl.',
    expect: 'mismatch',
    why: 'different words',
  },
  {
    language: 'is',
    original: 'Hvað finnst þér?',
    transcribed: 'Kaffins þér.',
    expect: 'mismatch',
    why: 'garbled',
  },
  {
    language: 'en',
    original: 'The fee is 5% of the total.',
    transcribed: 'The fee is fifty percent of the total.',
    expect: 'mismatch',
    why: 'number changed, symbol leniency must not hide it',
  },
  {
    language: 'en',
    original: 'Your code is AB12cd.',
    transcribed: 'Your code is XY99.',
    expect: 'mismatch',
    why: 'different identifier',
  },
  {
    language: 'yue_traditional',
    original: '等一陣。',
    transcribed: '大家好。',
    expect: 'mismatch',
    why: 'different sentence',
  },
  {
    language: 'es',
    original: 'Adiós, hasta mañana.',
    transcribed: 'Hola, hasta mañana.',
    expect: 'mismatch',
    why: 'word changed',
  },
];

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run via: pnpm eval:validation',
    );
    process.exit(1);
  }
  let wrong = 0;
  let cost = 0;
  for (const c of CASES) {
    const verdict = await textsMatchSemantic(
      c.original,
      c.transcribed,
      c.language,
      (t) => {
        cost += t.costUsd ?? 0;
      },
    );
    const ok = verdict === c.expect;
    if (!ok) wrong++;
    console.log(
      `${ok ? 'ok  ' : 'WRONG'} expected ${c.expect.padEnd(8)} got ${verdict.padEnd(8)} [${c.language}] ${c.why}\n      ${c.original}\n      ${c.transcribed}`,
    );
  }
  console.log(
    `\n${CASES.length - wrong}/${CASES.length} correct, judge spend ${cost.toFixed(4)} USD`,
  );
  process.exit(wrong ? 1 : 0);
}
main();
