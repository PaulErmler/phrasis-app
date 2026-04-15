/**
 * Voice configuration for all TTS providers.
 *
 * This file owns:
 *   - The Voice type
 *   - Per-language voice pools (Google Chirp3 + ElevenLabs)
 *   - The VOICE_POOLS map keyed by language code
 *   - All voice-selection helpers (getVoiceForLanguage, etc.)
 *
 * Language metadata (code, name, flag, ttsProvider, ...) lives in
 * `lib/languages.ts`. The only coupling is that this file imports
 * `getLanguageByCode` from languages.ts to read each language's active
 * provider when filtering voices.
 */
import { getLanguageByCode, type TtsProvider } from './languages';

export type { TtsProvider };

/**
 * apiCode format depends on provider:
 *   - google:     "{locale}-Chirp3-HD-{name}"   e.g. "en-US-Chirp3-HD-Leda"
 *   - elevenlabs: raw voice_id (UUID)           e.g. "21m00Tcm4TlvDq8ikWAM"
 */
export interface Voice {
  provider: TtsProvider;
  name: string;
  displayName: string;
  apiCode: string;
  gender: 'female' | 'male';
}

// ---------------------------------------------------------------------------
// Voice factories
// ---------------------------------------------------------------------------

function createChirp3Voice(
  name: string,
  gender: 'female' | 'male',
  locale: string,
  accentLabel: string,
): Voice {
  return {
    provider: 'google',
    name,
    displayName: `${name} (${gender === 'female' ? 'Female' : 'Male'}) - ${accentLabel}`,
    apiCode: `${locale}-Chirp3-HD-${name}`,
    gender,
  };
}

function createElevenLabsVoice(
  name: string,
  gender: 'female' | 'male',
  voiceId: string,
): Voice {
  return {
    provider: 'elevenlabs',
    name,
    displayName: `${name} (${gender === 'female' ? 'Female' : 'Male'}) - ElevenLabs`,
    apiCode: voiceId,
    gender,
  };
}

// Every Chirp3 HD locale ships the same 16 voice names (8 female + 8 male),
// except some languages Google only offers the 8-voice core set. We build
// per-language pools from these shared name lists so the file stays readable.
const CHIRP3_STANDARD_FEMALES = [
  'Leda', 'Kore', 'Aoede', 'Zephyr',
  'Achernar', 'Autonoe', 'Callirrhoe', 'Sulafat',
] as const;
const CHIRP3_STANDARD_MALES = [
  'Charon', 'Puck', 'Fenrir', 'Orus',
  'Achird', 'Algenib', 'Enceladus', 'Umbriel',
] as const;
const CHIRP3_CORE_FEMALES = CHIRP3_STANDARD_FEMALES.slice(0, 4);
const CHIRP3_CORE_MALES = CHIRP3_STANDARD_MALES.slice(0, 4);

function buildChirp3Pool(
  locale: string,
  accentLabel: string,
  variant: 'standard' | 'core' = 'standard',
): Voice[] {
  const females = variant === 'core' ? CHIRP3_CORE_FEMALES : CHIRP3_STANDARD_FEMALES;
  const males = variant === 'core' ? CHIRP3_CORE_MALES : CHIRP3_STANDARD_MALES;
  return [
    ...females.map((n) => createChirp3Voice(n, 'female', locale, accentLabel)),
    ...males.map((n) => createChirp3Voice(n, 'male', locale, accentLabel)),
  ];
}

// ---------------------------------------------------------------------------
// Shared ElevenLabs multilingual voices
// ---------------------------------------------------------------------------

const EL_MARK = createElevenLabsVoice('Mark', 'male', 'UgBBYS2sOqTuMpoF3BR0');
const EL_JAMES = createElevenLabsVoice('James', 'male', 'EkK5I93UQWFDigLMpZcX');
const EL_JUNIPER = createElevenLabsVoice('Juniper', 'female', 'aMSt68OGf4xUZAnLpTU8');
const EL_ARABELLA = createElevenLabsVoice('Arabella', 'female', 'Z3R5wn05IrDiVCyEkUrK');
// Camille Martin — multilingual female used across fr / pt.

// ---------------------------------------------------------------------------
// Per-language ElevenLabs voice pools
// ---------------------------------------------------------------------------

// English — 4 original + 4 added natives (US + UK mix)
const ELEVENLABS_VOICES_EN: Voice[] = [
  EL_JUNIPER,
  EL_ARABELLA,
  createElevenLabsVoice('Adrea', 'female', 'ji8lGJ0ZLrpJ5KY4NwOd'),
  createElevenLabsVoice('Lauren', 'female', 'DODLEQrClDo8wCz460ld'),
  EL_MARK,
  EL_JAMES,
  createElevenLabsVoice('Alistair (UK)', 'male', 'l30f87tf05uxyknGdDw6'),
  createElevenLabsVoice('US Male', 'male', 'tZssYepgGaQmegsMEXjK'),
];

// Spanish (Spain / Castilian) — Clara + Carolina (native Castilian females);
// James + Emilio (native Spanish male).
const ELEVENLABS_VOICES_ES: Voice[] = [
  createElevenLabsVoice('Aitana', 'female', 'AxFLn9byyiDbMn5fmyqu'),
  createElevenLabsVoice('Eva', 'female', 'RgXx32WYOGrd7gFNifSf'),
  createElevenLabsVoice('David' ,'male', "Nh2zY9kknu6z4pZy6FhD"), 
  createElevenLabsVoice('Emilio', 'male', 'ZCh4e9eZSUf41K4cmCEL'),
];

// Spanish (Latin America) — Kate + Alma (native LATAM females);
// Beto + Alessio (native LATAM males).
const ELEVENLABS_VOICES_ES_LATAM: Voice[] = [
  createElevenLabsVoice('Kate', 'female', 'imFXYz8XIletRKLZZQaA'),
  createElevenLabsVoice('Alma', 'female', '3ttovAt5bt3Kk38UGIob'),
  createElevenLabsVoice('Beto', 'male', 'ukupJ4zdf9bo1Py6MiO6'),
  createElevenLabsVoice('Alessio', 'male', '8MlXhVr7f7x9lck6CiCF'),
];

// French (France) — all 4 native French speakers
const ELEVENLABS_VOICES_FR: Voice[] = [
  createElevenLabsVoice('Camille', 'female', 'hFgOzpmS0CMtL2to8sAl'),
  createElevenLabsVoice('Victoria', 'female', 'WeAAwKYcS06VmXw086yZ'),
  createElevenLabsVoice('Francois Louis', 'male', 'UBXZKOKbt62aLQHhc1Jm'),
  createElevenLabsVoice('Celian', 'male', 'DGTOOUoGpoP6UZ9uSWfA'),
];

// German (Germany) — Juniper + Arabella + Irene (F); Alexander + Narration (M).
const ELEVENLABS_VOICES_DE: Voice[] = [
  createElevenLabsVoice('Ben', 'male', 'aTTiK3YzK3dXETpuDE2h'),
  createElevenLabsVoice('Irene', 'female', '8wPhfH9uUzEMHTmRkoAR'),
  createElevenLabsVoice('Carla', 'female', 'rKiu7lQ4c5P3az3745s3'),
  createElevenLabsVoice('Alexander', 'male', 'kkJxCnlRCckmfFvzDW5Q'),
];

// Italian — 4 native Italian speakers
const ELEVENLABS_VOICES_IT: Voice[] = [
  createElevenLabsVoice('Tiziana', 'female', 'RXoaSpLaWTEckJgPUBG3'),
  createElevenLabsVoice('Violette', 'female', 'gfKKsLN1k0oYYN9n2dXX'),
  createElevenLabsVoice('Brando', 'male', 'o4b57JYAECRMJyCEXyIE'),
  createElevenLabsVoice('Marco', 'male', '13Cuh3NuYvWOVQtLbRN8'),
];

// Portuguese (Brazilian) — 4 native Brazilian speakers + Camille (multilingual).
const ELEVENLABS_VOICES_PT: Voice[] = [
  createElevenLabsVoice('Andrea', 'female', 'HOfBIVLhom4mc9WvXfyH'),
  createElevenLabsVoice('Carla', 'female', 'oJebhZNaPllxk6W0LSBA'),
  createElevenLabsVoice('Eduardo', 'male', '4J31DrhygVjvFsoj7BsM'),
  createElevenLabsVoice('Marcio', 'male', 'Zk0wRqIFBWGMu2lIk7hw'),
];

// Russian — James + native Ivan; Russian females (verify before production).
const ELEVENLABS_VOICES_RU: Voice[] = [
  createElevenLabsVoice('Ekaterina', 'female', 'GN4wbsbejSnGSa1AzjH5'),
  createElevenLabsVoice('Mariia', 'female', 'EDpEYNf6XIeKYRzYcx4I'),
  createElevenLabsVoice('Alex', 'male', 'txnCCHHGKmYIwrn7HfHQ'),
  createElevenLabsVoice('Ivan', 'male', 'rQOBu7YxCDxGiFdTm28w'),
];

// Hindi — 4 native Indian speakers.
const ELEVENLABS_VOICES_HI: Voice[] = [
  createElevenLabsVoice('Monika', 'female', '1qEiC6qsybMkmnNdVMbK'),
  createElevenLabsVoice('Devi', 'female', 'MF4J4IDTRo0AxOO4dpFR'),
  createElevenLabsVoice('Niraj', 'male', 'zgqefOY5FPQ3bB7OZTVR'),
  createElevenLabsVoice('Leo', 'male', 'IvLWq57RKibBrqZGpQrC'),
];

// Chinese (Mandarin) — Stacy (native) + Jane (multilingual); Martin Li + Haytham.
const ELEVENLABS_VOICES_ZH: Voice[] = [
  createElevenLabsVoice('Stacy', 'female', 'hkfHEbBvdQFNX4uWHqRF'),
  createElevenLabsVoice('Jane', 'female', 'RILOU7YmBhvwJGDGjNmP'),
  createElevenLabsVoice('Martin Li', 'male', 'WuLq5z7nEcrhppO0ZQJw'),
  createElevenLabsVoice('Haytham', 'male', 'IES4nrmZdUBHByLBde0P'),
];

// Japanese — 4 native Japanese speakers.
const ELEVENLABS_VOICES_JA: Voice[] = [
  createElevenLabsVoice('Satomi', 'female', 'wcs09USXSN5Bl7FXohVZ'),
  createElevenLabsVoice('Shizuka', 'female', 'WQz3clzUdMqvBf0jswZQ'),
  createElevenLabsVoice('Otani', 'male', '3JDquces8E8bkmvbh6Bc'),
  createElevenLabsVoice('Kozy', 'male', 'GxxMAMfQkDlnqjpzjLHH'),
];

// Korean — Arabella + native JiYoung; native KKC.
const ELEVENLABS_VOICES_KO: Voice[] = [
  createElevenLabsVoice('JiYoung', 'female', 'AW5wrnG1jVizOYY7R1Oo'),
  createElevenLabsVoice('KKC', 'male', '1W00IGEmNmwmsDeYy7ag'),
];

// Vietnamese — 2 native Vietnamese speakers. 1F + 1M.
const ELEVENLABS_VOICES_VI: Voice[] = [
  createElevenLabsVoice('Nhu', 'female', 'A5w1fw5x0uXded1LDvZp'),
  createElevenLabsVoice('Ninh', 'male', 'aN7cv9yXNrfIR87bDmyD'),
];

// Swedish — Arabella + Jane; James.
const ELEVENLABS_VOICES_SV: Voice[] = [

  createElevenLabsVoice('Jane', 'female', 'RILOU7YmBhvwJGDGjNmP'),
  createElevenLabsVoice('Sanna', 'female', '4xkUqaR9MYOJHoaC1Nak'), 
  createElevenLabsVoice('Louise', 'female', 'QLfvbukvQvrPOx9HXQ3x'), 
  createElevenLabsVoice('Adam', 'male', 'x0u3EW21dbrORJzOq1m9'), 
  createElevenLabsVoice('Martin', 'male', 'CuaAIFbkzX2kaNH5EtHZ'),
];

// Finnish — 4 native speakers.
const ELEVENLABS_VOICES_FI: Voice[] = [
  createElevenLabsVoice('Aurora', 'female', 'YSabzCJMvEHDduIDMdwV'),
  createElevenLabsVoice('Soili', 'female', 'RiWFFlzYFZuu4lPMig3i'),
  createElevenLabsVoice('Miika', 'male', 'fC33e0BIKA7wWK2MeARj'),
  createElevenLabsVoice('Jussi', 'male', 'dlbXHgJnwobU5JdZ8F5M'),
];

// Dutch (Netherlands) — 4 native Dutch speakers.
const ELEVENLABS_VOICES_NL: Voice[] = [
  createElevenLabsVoice('Ruth', 'female', 'yO6w2xlECAQRFP6pX7Hw'),
  createElevenLabsVoice('Melanie', 'female', 'SXBL9NbvTrjsJQYay2kT'),
  createElevenLabsVoice('Serge', 'male', 'UNBIyLbtFB9k7FKW8wJv'),
  createElevenLabsVoice('Peter', 'male', '60CwgZt94Yf7yYIXMDDe'),
];

// Greek — 4 native Greek speakers.
const ELEVENLABS_VOICES_EL: Voice[] = [
  createElevenLabsVoice('Sophie', 'female', '7smwXrU3C1PfaspIIUZB'),
  createElevenLabsVoice('Hope', 'female', 'tnSpp4vdxKPjI9w0GnoV'),
  createElevenLabsVoice('Theos', 'male', 'n0vzWypeCK1NlWPVwhOc'),
  createElevenLabsVoice('Christos', 'male', 'PaZ8laODC1yRxHTPYJFh'),
];

// Arabic — 4 native Arabic speakers.
const ELEVENLABS_VOICES_AR: Voice[] = [
  createElevenLabsVoice('Sara', 'female', 'XTa3iQyMA6f1qrI4F6kZ'),
  createElevenLabsVoice('Sara2', 'female', 'gMB389pj77Qe5nErWNjd'),
  createElevenLabsVoice('Yahya', 'male', 'QRq5hPRAKf5ZhSlTBH6r'),
  createElevenLabsVoice('Anas', 'male', 'R6nda3uM038xEEKi7GFl'),
];

// ---------------------------------------------------------------------------
// Per-language unified voice pools
//
// Each entry contains the full curated set — Google Chirp3 voices first (so a
// language can be switched back to `ttsProvider: 'google'` without touching
// voice config), then the ElevenLabs pool.
// ---------------------------------------------------------------------------

export const VOICE_POOLS: Record<string, Voice[]> = {
  en: [
    ...buildChirp3Pool('en-US', 'US'),
    ...buildChirp3Pool('en-GB', 'UK'),
    ...ELEVENLABS_VOICES_EN,
  ],
  es: [...buildChirp3Pool('es-ES', 'Spain'), ...ELEVENLABS_VOICES_ES],
  es_latam: [
    ...buildChirp3Pool('es-US', 'Latin America'),
    ...ELEVENLABS_VOICES_ES_LATAM,
  ],
  fr: [...buildChirp3Pool('fr-FR', 'France'), ...ELEVENLABS_VOICES_FR],
  de: [...buildChirp3Pool('de-DE', 'Germany'), ...ELEVENLABS_VOICES_DE],
  it: [...buildChirp3Pool('it-IT', 'Italy'), ...ELEVENLABS_VOICES_IT],
  pt: [...buildChirp3Pool('pt-BR', 'Brazil'), ...ELEVENLABS_VOICES_PT],
  ru: [...buildChirp3Pool('ru-RU', 'Russia', 'core'), ...ELEVENLABS_VOICES_RU],
  hi: [...buildChirp3Pool('hi-IN', 'India'), ...ELEVENLABS_VOICES_HI],
  zh: [...buildChirp3Pool('cmn-CN', 'Mandarin'), ...ELEVENLABS_VOICES_ZH],
  ja: [...buildChirp3Pool('ja-JP', 'Japan'), ...ELEVENLABS_VOICES_JA],
  ko: [...buildChirp3Pool('ko-KR', 'Korea'), ...ELEVENLABS_VOICES_KO],
  vi: [...buildChirp3Pool('vi-VN', 'Vietnam'), ...ELEVENLABS_VOICES_VI],
  sv: [...buildChirp3Pool('sv-SE', 'Sweden'), ...ELEVENLABS_VOICES_SV],
  fi: [...buildChirp3Pool('fi-FI', 'Finland'), ...ELEVENLABS_VOICES_FI],
  nl: [...buildChirp3Pool('nl-NL', 'Netherlands'), ...ELEVENLABS_VOICES_NL],
  el: [...buildChirp3Pool('el-GR', 'Greece'), ...ELEVENLABS_VOICES_EL],
  ar: [...buildChirp3Pool('ar-XA', 'MSA'), ...ELEVENLABS_VOICES_AR],
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Get voices available for synthesis for a language — filtered to the
 * language's currently active TTS provider. Use `getAllVoicesByLanguageCode`
 * if you need the full curated set across providers (e.g., for a settings UI).
 */
export function getVoicesByLanguageCode(code: string): Voice[] {
  const language = getLanguageByCode(code);
  if (!language) return [];
  const pool = VOICE_POOLS[code] ?? [];
  return pool.filter((v) => v.provider === language.ttsProvider);
}

/** Every curated voice for a language regardless of active provider. */
export function getAllVoicesByLanguageCode(code: string): Voice[] {
  return VOICE_POOLS[code] ?? [];
}

/**
 * Pick a random voice_id for a language, ignoring gender.
 * @throws Error when the language has no voices for its active provider.
 */
export function getRandomVoiceForLanguage(code: string): string {
  const voices = getVoicesByLanguageCode(code);
  if (voices.length === 0) {
    throw new Error(
      `No voices available for language "${code}" with active provider. Add voices in lib/voices.ts.`,
    );
  }
  return voices[Math.floor(Math.random() * voices.length)].apiCode;
}

/** Look up the gender of a voice by its full apiCode across every pool. */
export function getVoiceGenderByApiCode(
  apiCode: string,
): 'male' | 'female' | undefined {
  for (const pool of Object.values(VOICE_POOLS)) {
    const voice = pool.find((v) => v.apiCode === apiCode);
    if (voice) return voice.gender;
  }
  return undefined;
}

/** Look up the provider that produced a given voice apiCode. */
export function getProviderByApiCode(apiCode: string): TtsProvider | undefined {
  for (const pool of Object.values(VOICE_POOLS)) {
    const voice = pool.find((v) => v.apiCode === apiCode);
    if (voice) return voice.provider;
  }
  return undefined;
}

/**
 * Coin-flip an audio-voice gender when the linguistic speaker gender is
 * missing/neutral. Sentences of one card end up with a consistent gender
 * across languages because callers pass the same resolved value per card.
 */
export function resolveAudioSpeakerGender(
  speakerGender?: string,
): 'male' | 'female' {
  if (speakerGender === 'male' || speakerGender === 'female') return speakerGender;
  return Math.random() < 0.5 ? 'male' : 'female';
}

/**
 * Get a voice apiCode for a language, optionally matching a speaker gender.
 * Falls back to random-from-pool when gender filtering yields nothing.
 */
export function getVoiceForLanguage(
  code: string,
  speakerGender?: string,
): string {
  const voices = getVoicesByLanguageCode(code);
  if (voices.length === 0) {
    throw new Error(
      `No voices available for language "${code}" with active provider. Add voices in lib/voices.ts.`,
    );
  }
  if (speakerGender === 'male' || speakerGender === 'female') {
    const matching = voices.filter((v) => v.gender === speakerGender);
    if (matching.length > 0) {
      return matching[Math.floor(Math.random() * matching.length)].apiCode;
    }
  }
  return voices[Math.floor(Math.random() * voices.length)].apiCode;
}

/**
 * Extract locale from a Google Chirp3 voice apiCode (e.g.
 * "en-US-Chirp3-HD-Leda" → "en-US"). Returns null for ElevenLabs voice IDs.
 */
export function getLocaleFromApiCode(apiCode: string): string | null {
  if (!apiCode.includes('-Chirp3-HD-')) return null;
  const parts = apiCode.split('-Chirp3-HD-');
  return parts[0] || null;
}

/**
 * Unique locales for a language (Google voices only; ElevenLabs voices are
 * multilingual and carry no locale).
 */
export function getLocalesByLanguageCode(code: string): string[] {
  const locales = getAllVoicesByLanguageCode(code)
    .map((v) => getLocaleFromApiCode(v.apiCode))
    .filter((l): l is string => l !== null);
  return [...new Set(locales)];
}
