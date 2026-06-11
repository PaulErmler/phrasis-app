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
 *
 * `active` gates whether a voice is eligible for selection. Dormant voices
 * stay in VOICE_POOLS (so re-enabling is a one-line flip) but are filtered
 * out of `getVoicesByLanguageCode`. ElevenLabs voices are currently dormant
 * — TTS runs Google-only. See convex/lib/tts/index.ts for the provider wiring.
 */
export interface Voice {
  provider: TtsProvider;
  name: string;
  displayName: string;
  apiCode: string;
  gender: 'female' | 'male';
  /** Defaults to true when omitted. Set to false to keep the entry as dormant metadata. */
  active?: boolean;
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
    // Default ElevenLabs voices to dormant. Pools for languages currently
    // running on ElevenLabs run their list through `activate(...)` below to
    // flip this back on.
    active: false,
  };
}

/**
 * Azure Speech (Cognitive Services) voices. apiCode is the Azure voice
 * short name, e.g. "sv-SE-SofieNeural" — the provider extracts the locale
 * from the prefix at synthesis time. Defaults to dormant; pools wrap with
 * `activate(...)` when their language is currently routed through Azure.
 */
function createAzureVoice(
  name: string,
  gender: 'female' | 'male',
  voiceShortName: string,
): Voice {
  return {
    provider: 'azure',
    name,
    displayName: `${name} (${gender === 'female' ? 'Female' : 'Male'}) - Azure`,
    apiCode: voiceShortName,
    gender,
    active: false,
  };
}

/**
 * Gemini 3.1 Flash TTS voices (via OpenRouter). The Gemini voice name itself is
 * accent-neutral; pronunciation/accent comes from the BCP-47 `language_code`
 * the provider sends. For single-locale languages (de, sv, pt_pt) the locale is
 * derived from the language code via `toGeminiBcp47`, so the apiCode is the bare
 * voice name (e.g. "Kore").
 *
 * For languages whose pool spans multiple accents (English: US/GB/AU) the
 * accent can't come from the language code, so the locale is encoded into the
 * apiCode as `"<Name>@<bcp47>"` (e.g. "Kore@en-GB") — mirroring how Google
 * embeds the locale in `en-GB-Chirp3-HD-Leda`. The provider in
 * convex/lib/tts/gemini.ts splits on `@`, sends the bare name as the voice, and
 * uses the suffix as the `language_code`. Active by default.
 */
function createGeminiVoice(
  name: string,
  gender: 'female' | 'male',
  locale?: string,
): Voice {
  const genderLabel = gender === 'female' ? 'Female' : 'Male';
  return {
    provider: 'gemini',
    name,
    displayName: locale
      ? `${name} (${genderLabel}) - Gemini ${locale}`
      : `${name} (${genderLabel}) - Gemini`,
    apiCode: locale ? `${name}@${locale}` : name,
    gender,
  };
}

// The four Gemini voices selected for production (2F + 2M), tuned for clear,
// neutral language-learning delivery.
const GEMINI_VOICE_DEFS: ReadonlyArray<readonly [string, 'female' | 'male']> = [
  ['Leda', 'female'],
  ['Gacrux', 'female'],
  ['Achird', 'male'],
  ['Iapetus', 'male'],
];

// Bare (locale-from-language) pool for single-accent Gemini languages (de, sv,
// pt_pt).
const GEMINI_CORE: Voice[] = GEMINI_VOICE_DEFS.map(([n, g]) =>
  createGeminiVoice(n, g),
);

// Locale-tagged Gemini pool: the same four voices steered to a specific accent
// via the `@<locale>` apiCode suffix. Used for English's per-accent pools.
function buildGeminiAccentPool(locale: string): Voice[] {
  return GEMINI_VOICE_DEFS.map(([n, g]) => createGeminiVoice(n, g, locale));
}

// English Gemini accent pools. The default `en` pool unions all three so a
// random pick yields a mix of US/GB/AU accents; the dialect codes pin one.
const GEMINI_EN_US: Voice[] = buildGeminiAccentPool('en-US');
const GEMINI_EN_GB: Voice[] = buildGeminiAccentPool('en-GB');
const GEMINI_EN_AU: Voice[] = buildGeminiAccentPool('en-AU');
const GEMINI_EN_MIXED: Voice[] = [
  ...GEMINI_EN_US,
  ...GEMINI_EN_GB,
  ...GEMINI_EN_AU,
];

/**
 * Mark a voice list as selectable. Used by pools for languages whose
 * `ttsProvider` is currently `'elevenlabs'` — wraps the list so every
 * entry becomes `active: true` without touching the per-voice definitions.
 */
function activate(voices: Voice[]): Voice[] {
  return voices.map((v) => ({ ...v, active: true }));
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
const EL_CHRISTINA = createElevenLabsVoice('Christina', 'female', 'X03mvPuTfprif8QBAVeJ');
// Camille Martin — multilingual female used across fr / pt.

// ---------------------------------------------------------------------------
// Per-language ElevenLabs voice pools
// ---------------------------------------------------------------------------

// English — 4 original + 4 added natives (US + UK mix)
const ELEVENLABS_VOICES_EN: Voice[] = [
  EL_JUNIPER,
  EL_CHRISTINA,
  createElevenLabsVoice('Adrea', 'female', 'ji8lGJ0ZLrpJ5KY4NwOd'),
  createElevenLabsVoice('Lauren', 'female', 'DODLEQrClDo8wCz460ld'),
  EL_MARK,
  EL_JAMES,
  createElevenLabsVoice('Alistair (UK)', 'male', 'l30f87tf05uxyknGdDw6'),
];

// Spanish (Spain / Castilian) — Clara + Carolina (native Castilian females);
// James + Emilio (native Spanish male).
const ELEVENLABS_VOICES_ES: Voice[] = [
  createElevenLabsVoice('Eva', 'female', 'RgXx32WYOGrd7gFNifSf'),
  createElevenLabsVoice('Lydia', 'female', 'SDVJaMLoJa7wc3s2sn7d'),
  createElevenLabsVoice('David' ,'male', "Nh2zY9kknu6z4pZy6FhD"), 
  createElevenLabsVoice('Emilio', 'male', 'ZCh4e9eZSUf41K4cmCEL'),
];

// Spanish (Latin America) — Kate + Alma (native LATAM females);
// Beto + Alessio (native LATAM males).
const ELEVENLABS_VOICES_ES_LATAM: Voice[] = [
  createElevenLabsVoice('Kate', 'female', 'imFXYz8XIletRKLZZQaA'),
  createElevenLabsVoice('Alma', 'female', '3ttovAt5bt3Kk38UGIob'),
  createElevenLabsVoice('Antonio', 'male', 'htFfPSZGJwjBv1CL0aMD'),
  createElevenLabsVoice('Mario', 'male', 'tomkxGQGz4b1kE0EM722'),
];

// French (France) — all 4 native French speakers
const ELEVENLABS_VOICES_FR: Voice[] = [
  createElevenLabsVoice('Camille', 'female', 'hFgOzpmS0CMtL2to8sAl'),
  createElevenLabsVoice('Claire', 'female', 'HuLbOdhRlvQQN8oPP0AJ'),
  createElevenLabsVoice('Marcel', 'male', 'kENkNtk0xyzG09WW40xE'),
  createElevenLabsVoice('Yann', 'male', 'nr2EGJNe96rzn9FRlTId'),
  createElevenLabsVoice('Celian', 'male', 'DGTOOUoGpoP6UZ9uSWfA'),
  createElevenLabsVoice('Anna', 'female', 'nVPCtAFzgyMX3FZKNzH0'),
];

// German (Germany) — native German speakers (2F + 2M).
const ELEVENLABS_VOICES_DE: Voice[] = [
  createElevenLabsVoice('Ben', 'male', 'aTTiK3YzK3dXETpuDE2h'),
  createElevenLabsVoice('Irene', 'female', '8wPhfH9uUzEMHTmRkoAR'),
  createElevenLabsVoice('Carla', 'female', 'rKiu7lQ4c5P3az3745s3'),
  createElevenLabsVoice('Leo', 'male', 'f64OyGck4gc2zk7QOs55'),
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
  createElevenLabsVoice('Amy', 'female', 'bhJUNIXWQQ94l8eI2VUf'),
  createElevenLabsVoice('Jane', 'female', 'RILOU7YmBhvwJGDGjNmP'),
  createElevenLabsVoice('Jin', 'male', 'vZZLclMx4wouUtKBRfZn'),
  createElevenLabsVoice('Haytham', 'male', 'IES4nrmZdUBHByLBde0P'),
];

// Japanese — 4 native Japanese speakers.
const ELEVENLABS_VOICES_JA: Voice[] = [
  createElevenLabsVoice('Satomi', 'female', 'wcs09USXSN5Bl7FXohVZ'),
  createElevenLabsVoice('Shizuka', 'female', 'WQz3clzUdMqvBf0jswZQ'),
  createElevenLabsVoice('Otani', 'male', '3JDquces8E8bkmvbh6Bc'),
  createElevenLabsVoice('Kozy', 'male', 'GxxMAMfQkDlnqjpzjLHH'),
];

// Korean — native JiYoung (F) + native KKC (M).
const ELEVENLABS_VOICES_KO: Voice[] = [
  createElevenLabsVoice('Han', 'female', '8jHHF8rMqMlg8if2mOUe'),
  createElevenLabsVoice('Hyuk', 'male', 'ZJCNdZEjYwkOElxugmW2'),
];

// Vietnamese — 2 native Vietnamese speakers. 1F + 1M.
const ELEVENLABS_VOICES_VI: Voice[] = [
  createElevenLabsVoice('Nhu', 'female', 'A5w1fw5x0uXded1LDvZp'),
  createElevenLabsVoice('Ninh', 'male', 'aN7cv9yXNrfIR87bDmyD'),
  createElevenLabsVoice('Chris', 'male', 'PDoCXqBQFGsvfO0hNkEs'),
  createElevenLabsVoice('Seo', 'female', 'o2sPqaz4lRxUCRm2QqQK'),
];

// Swedish — Jane + native Sanna/Louise (F); native Peter/Martin (M).
const ELEVENLABS_VOICES_SV: Voice[] = [
  createElevenLabsVoice('Jane', 'female', 'RILOU7YmBhvwJGDGjNmP'),
  createElevenLabsVoice('Louise', 'female', 'QLfvbukvQvrPOx9HXQ3x'),
  createElevenLabsVoice('Martin', 'male', 'CuaAIFbkzX2kaNH5EtHZ'),
  createElevenLabsVoice('Andres', 'male', 'hMTrLL2ZiyJiyKrdg2z4'),
];

// Swedish — native sv-SE Azure Neural voices. Catalog only ships 1 male
// (Mattias) and 2 female (Sofie, Hillevi) at the time of this change.
const AZURE_VOICES_SV: Voice[] = [
  createAzureVoice('Sofie', 'female', 'sv-SE-SofieNeural'),
  createAzureVoice('Hillevi', 'female', 'sv-SE-HilleviNeural'),
  createAzureVoice('Mattias', 'male', 'sv-SE-MattiasNeural'),
];

// Arabic Egyptian — Azure Neural M+F. Saudi and Iraqi route through the
// shared Google MSA pool (`ar-XA`); Egyptian stays on Azure for now since
// Egyptian dialect diverges enough from MSA that MSA voices read unnaturally.
const AZURE_VOICES_AR_EG: Voice[] = [
  createAzureVoice('Salma', 'female', 'ar-EG-SalmaNeural'),
  createAzureVoice('Shakir', 'male', 'ar-EG-ShakirNeural'),
];

// Thai — Azure Neural M+F. No Dragon HD voices for Thai (May 2026).
const AZURE_VOICES_TH: Voice[] = [
  createAzureVoice('Premwadee', 'female', 'th-TH-PremwadeeNeural'),
  createAzureVoice('Niwat', 'male', 'th-TH-NiwatNeural'),
];

// Hebrew — Azure Neural fallback (Google Chirp3-HD he-IL is primary).
const AZURE_VOICES_HE: Voice[] = [
  createAzureVoice('Hila', 'female', 'he-IL-HilaNeural'),
  createAzureVoice('Avri', 'male', 'he-IL-AvriNeural'),
];

// Slovak — Azure Neural fallback (Google Chirp3-HD sk-SK is primary).
const AZURE_VOICES_SK: Voice[] = [
  createAzureVoice('Viktoria', 'female', 'sk-SK-ViktoriaNeural'),
  createAzureVoice('Lukas', 'male', 'sk-SK-LukasNeural'),
];

// Swahili (Kenya) — Azure Neural M+F. Google has no Chirp3-HD sw-KE voices
// at the time of this change, so Azure is the active provider.
const AZURE_VOICES_SW_KE: Voice[] = [
  createAzureVoice('Zuri', 'female', 'sw-KE-ZuriNeural'),
  createAzureVoice('Rafiki', 'male', 'sw-KE-RafikiNeural'),
];

// Swahili (Tanzania) — Azure Neural M+F. Fast Transcription rejects sw-TZ,
// so the language is configured with supportsStt: false (Greek pattern).
const AZURE_VOICES_SW_TZ: Voice[] = [
  createAzureVoice('Rehema', 'female', 'sw-TZ-RehemaNeural'),
  createAzureVoice('Daudi', 'male', 'sw-TZ-DaudiNeural'),
];

// Turkish — Azure Neural fallback (Google Chirp3-HD tr-TR is primary).
const AZURE_VOICES_TR: Voice[] = [
  createAzureVoice('Emel', 'female', 'tr-TR-EmelNeural'),
  createAzureVoice('Ahmet', 'male', 'tr-TR-AhmetNeural'),
];

// Romanian — Azure Neural fallback.
const AZURE_VOICES_RO: Voice[] = [
  createAzureVoice('Alina', 'female', 'ro-RO-AlinaNeural'),
  createAzureVoice('Emil', 'male', 'ro-RO-EmilNeural'),
];

// Czech — Azure Neural fallback.
const AZURE_VOICES_CS: Voice[] = [
  createAzureVoice('Vlasta', 'female', 'cs-CZ-VlastaNeural'),
  createAzureVoice('Antonin', 'male', 'cs-CZ-AntoninNeural'),
];

// Hungarian — Azure Neural fallback.
const AZURE_VOICES_HU: Voice[] = [
  createAzureVoice('Noemi', 'female', 'hu-HU-NoemiNeural'),
  createAzureVoice('Tamas', 'male', 'hu-HU-TamasNeural'),
];

// Bengali (India) — Azure Neural fallback.
const AZURE_VOICES_BN: Voice[] = [
  createAzureVoice('Tanishaa', 'female', 'bn-IN-TanishaaNeural'),
  createAzureVoice('Bashkar', 'male', 'bn-IN-BashkarNeural'),
];

// Mandarin Traditional (zh-TW) — Azure Neural M+F. Google ships no Chirp3-HD
// voices for cmn-TW (only legacy Standard/WaveNet), so Azure is the active
// provider for the `zh_traditional` language. Catalog: 2F (HsiaoChen, HsiaoYu)
// and 1M (YunJhe).
const AZURE_VOICES_ZH_TW: Voice[] = [
  createAzureVoice('HsiaoChen', 'female', 'zh-TW-HsiaoChenNeural'),
  createAzureVoice('HsiaoYu', 'female', 'zh-TW-HsiaoYuNeural'),
  createAzureVoice('YunJhe', 'male', 'zh-TW-YunJheNeural'),
];

// Mandarin zh-CN — Microsoft DragonHDLatestNeural voices. Highest-tier
// Microsoft voices among the catalog at the time of this change. Stored
// dormant (active: false) so they don't affect existing zh courses; activate
// by switching the language's ttsProvider to 'azure' or by surfacing them
// through a per-course voice-set switch (TBD).
const AZURE_DRAGON_HD_VOICES_ZH: Voice[] = [
  createAzureVoice('Xiaochen', 'female', 'zh-CN-Xiaochen:DragonHDLatestNeural'),
  createAzureVoice('Yunfan', 'male', 'zh-CN-Yunfan:DragonHDLatestNeural'),
];

// Finnish — 4 native speakers.
const ELEVENLABS_VOICES_FI: Voice[] = [
  createElevenLabsVoice('Aurora', 'female', 'YSabzCJMvEHDduIDMdwV'),
  createElevenLabsVoice('Miika', 'male', 'fC33e0BIKA7wWK2MeARj'),
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
  createElevenLabsVoice('Eugene', 'male', '5DAtyqt3LGjv9jkjNVFd'),
  createElevenLabsVoice('Christos', 'male', 'PaZ8laODC1yRxHTPYJFh'),
];

// Arabic — 4 native Arabic speakers.
const ELEVENLABS_VOICES_AR: Voice[] = [
  createElevenLabsVoice('Sara', 'female', 'XTa3iQyMA6f1qrI4F6kZ'),
  createElevenLabsVoice('Sara2', 'female', 'gMB389pj77Qe5nErWNjd'),
  createElevenLabsVoice('Mohammed', 'male', 'Qp2PG6sgef1EHtrNQKnf'),
  createElevenLabsVoice('Mazen', 'male', 'rPNcQ53R703tTmtue1AT'),
];

// ---------------------------------------------------------------------------
// Per-language unified voice pools
//
// Each entry contains the full curated set — Google Chirp3 voices first (so a
// language can be switched back to `ttsProvider: 'google'` without touching
// voice config), then the ElevenLabs pool.
// ---------------------------------------------------------------------------

// English "Mixed" pool — pooled US + GB + AU Chirp3 voices.
const CHIRP3_EN_MIXED: Voice[] = [
  ...buildChirp3Pool('en-US', 'US'),
  ...buildChirp3Pool('en-GB', 'UK'),
  ...buildChirp3Pool('en-AU', 'Australia'),
];

export const VOICE_POOLS: Record<string, Voice[]> = {
  // English runs on Gemini (mixed US/GB/AU accents on the default `en`, pinned
  // accent on the dialect codes). Google Chirp3 + ElevenLabs voices stay listed
  // but go dormant — the `ttsProvider: 'gemini'` filter excludes them — so a
  // revert is a one-line `ttsProvider` flip in lib/languages.ts.
  en: [...CHIRP3_EN_MIXED, ...ELEVENLABS_VOICES_EN, ...GEMINI_EN_MIXED],
  en_gb: [...buildChirp3Pool('en-GB', 'UK'), ...GEMINI_EN_GB],
  en_us: [...buildChirp3Pool('en-US', 'US'), ...GEMINI_EN_US],
  en_au: [...buildChirp3Pool('en-AU', 'Australia'), ...GEMINI_EN_AU],
  es: [...buildChirp3Pool('es-ES', 'Spain'), ...activate(ELEVENLABS_VOICES_ES)],
  es_latam: [
    ...buildChirp3Pool('es-US', 'Latin America'),
    ...activate(ELEVENLABS_VOICES_ES_LATAM),
  ],
  // Spanish Mixed — union of Spain + LatAm Google voice pools. The audio-player
  // picks by the persisted translation `regionVariant` (see
  // `getVoiceForLanguageVariant` below); ElevenLabs voices stay out of the
  // mixed pool because they aren't tagged with a Spanish region prefix.
  es_mixed: [
    ...buildChirp3Pool('es-ES', 'Spain'),
    ...buildChirp3Pool('es-US', 'Latin America'),
  ],
  fr: [...buildChirp3Pool('fr-FR', 'France'), ...ELEVENLABS_VOICES_FR],
  de: [...buildChirp3Pool('de-DE', 'Germany'), ...ELEVENLABS_VOICES_DE, ...GEMINI_CORE],
  it: [...buildChirp3Pool('it-IT', 'Italy'), ...ELEVENLABS_VOICES_IT],
  pt: [...buildChirp3Pool('pt-BR', 'Brazil'), ...ELEVENLABS_VOICES_PT],
  // European Portuguese runs on Gemini. Google ships no Chirp3-HD pt-PT voices
  // (verified against /v1/voices), so there's no Google fallback to list —
  // Gemini is the only pool.
  pt_pt: [...GEMINI_CORE],
  ru: [...buildChirp3Pool('ru-RU', 'Russia', 'core'), ...ELEVENLABS_VOICES_RU],
  pl: [...buildChirp3Pool('pl-PL', 'Poland')],
  sk: [...buildChirp3Pool('sk-SK', 'Slovakia'), ...AZURE_VOICES_SK],
  hi: [...buildChirp3Pool('hi-IN', 'India'), ...ELEVENLABS_VOICES_HI],
  bn: [...buildChirp3Pool('bn-IN', 'Bengali'), ...AZURE_VOICES_BN],
  tr: [...buildChirp3Pool('tr-TR', 'Türkiye'), ...AZURE_VOICES_TR],
  hu: [...buildChirp3Pool('hu-HU', 'Hungary'), ...AZURE_VOICES_HU],
  ro: [...buildChirp3Pool('ro-RO', 'Romania'), ...AZURE_VOICES_RO],
  cs: [...buildChirp3Pool('cs-CZ', 'Czechia'), ...AZURE_VOICES_CS],
  zh: [
    ...buildChirp3Pool('cmn-CN', 'Mandarin'),
    ...ELEVENLABS_VOICES_ZH,
    // Dormant Dragon HD pool — activate by switching the language to Azure.
    ...AZURE_DRAGON_HD_VOICES_ZH,
  ],
  // No Google Chirp3-HD voices for cmn-TW — use Azure Neural zh-TW instead.
  zh_traditional: [...activate(AZURE_VOICES_ZH_TW)],
  yue: [...buildChirp3Pool('yue-HK', 'Hong Kong')],
  yue_traditional: [...buildChirp3Pool('yue-HK', 'Hong Kong')],
  ja: [...buildChirp3Pool('ja-JP', 'Japan'), ...ELEVENLABS_VOICES_JA],
  ko: [...buildChirp3Pool('ko-KR', 'Korea'), ...ELEVENLABS_VOICES_KO],
  vi: [...buildChirp3Pool('vi-VN', 'Vietnam'), ...ELEVENLABS_VOICES_VI],
  th: [...buildChirp3Pool('th-TH', 'Thailand'), ...AZURE_VOICES_TH],
  id: [...buildChirp3Pool('id-ID', 'Indonesia')],
  sv: [
    ...buildChirp3Pool('sv-SE', 'Sweden'),
    ...ELEVENLABS_VOICES_SV,
    ...AZURE_VOICES_SV,
    ...GEMINI_CORE,
  ],
  // nb: [...buildChirp3Pool('nb-NO', 'Norway')], // disabled — see SUPPORTED_LANGUAGES
  da: [...buildChirp3Pool('da-DK', 'Denmark')],
  fi: [...buildChirp3Pool('fi-FI', 'Finland'), ...ELEVENLABS_VOICES_FI],
  nl: [...buildChirp3Pool('nl-NL', 'Netherlands'), ...ELEVENLABS_VOICES_NL],
  el: [...buildChirp3Pool('el-GR', 'Greece'), ...ELEVENLABS_VOICES_EL],
  he: [...buildChirp3Pool('he-IL', 'Israel'), ...AZURE_VOICES_HE],
  ar: [...buildChirp3Pool('ar-XA', 'MSA'), ...ELEVENLABS_VOICES_AR],
  // Saudi, Iraqi, and Levantine dialects share the Google MSA pool (`ar-XA`)
  // — none has dedicated Chirp3 voices, and dialect-specific Azure voices
  // read worse than MSA on these dialects' typical content.
  ar_sa: [...buildChirp3Pool('ar-XA', 'MSA')],
  ar_eg: [...activate(AZURE_VOICES_AR_EG)],
  ar_iq: [...buildChirp3Pool('ar-XA', 'MSA')],
  ar_lev: [...buildChirp3Pool('ar-XA', 'MSA')],
  sw: [...activate(AZURE_VOICES_SW_KE)],
  sw_tz: [...activate(AZURE_VOICES_SW_TZ)],
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Get voices available for synthesis for a language — filtered to the
 * language's currently active TTS provider AND excluding dormant voices.
 * Use `getAllVoicesByLanguageCode` if you need the full curated set
 * across providers (e.g., for a settings UI).
 */
export function getVoicesByLanguageCode(code: string): Voice[] {
  const language = getLanguageByCode(code);
  if (!language) return [];
  const pool = VOICE_POOLS[code] ?? [];
  return pool.filter(
    (v) => v.provider === language.ttsProvider && v.active !== false,
  );
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
 * Resolve an audio-voice gender when the linguistic speaker gender is
 * missing/neutral. Sentences of one card end up with a consistent gender
 * across languages because callers pass the same resolved value per card.
 *
 * Pass `seed` (typically the text's `_id`) to make the resolution
 * **deterministic** — two concurrent callers for the same text will produce
 * the same gender. Without a seed the function falls back to `Math.random()`,
 * which is fine for one-shot creation paths (where the result is stored on
 * insert and never re-flipped) but causes a race for paths that may run
 * multiple times against an already-inserted text (e.g. `scheduleMissingContent`
 * for a text whose `audioSpeakerGender` field hasn't been written yet) —
 * two racing jobs would each flip independently and produce inconsistent
 * audio rows, triggering an audio-regeneration loop the next time the
 * stored gender is reconciled.
 */
export function resolveAudioSpeakerGender(
  speakerGender?: string,
  seed?: string,
): 'male' | 'female' {
  if (speakerGender === 'male' || speakerGender === 'female') return speakerGender;
  if (seed && seed.length > 0) {
    // FNV-1a — fast and well-distributed for short identifiers like a
    // Convex `_id`. Last bit picks the gender deterministically.
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ((h >>> 0) & 1) === 0 ? 'male' : 'female';
  }
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
 * Variant-aware voice picker. Used for languages whose pool spans multiple
 * regional accents (today: `es_mixed`). Filters the active-provider pool to
 * voices whose apiCode starts with `regionVariant` before applying the same
 * gender preference logic as `getVoiceForLanguage`. Falls back to the full
 * pool when no voice matches the variant prefix.
 *
 * `regionVariant` is a Google locale prefix such as `"es-ES"` or `"es-US"`
 * (the prefix matches the leading segment of the Chirp3 apiCode, e.g.
 * `es-ES-Chirp3-HD-Leda`). Pass it through verbatim from the persisted
 * translation `regionVariant` column.
 */
export function getVoiceForLanguageVariant(
  code: string,
  regionVariant: string | undefined,
  speakerGender?: string,
): string {
  if (!regionVariant) return getVoiceForLanguage(code, speakerGender);
  const all = getVoicesByLanguageCode(code);
  if (all.length === 0) {
    throw new Error(
      `No voices available for language "${code}" with active provider. Add voices in lib/voices.ts.`,
    );
  }
  const variantPool = all.filter((v) => v.apiCode.startsWith(`${regionVariant}-`));
  const pool = variantPool.length > 0 ? variantPool : all;
  if (speakerGender === 'male' || speakerGender === 'female') {
    const matching = pool.filter((v) => v.gender === speakerGender);
    if (matching.length > 0) {
      return matching[Math.floor(Math.random() * matching.length)].apiCode;
    }
  }
  return pool[Math.floor(Math.random() * pool.length)].apiCode;
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
