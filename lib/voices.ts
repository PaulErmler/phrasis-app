/**
 * Voice configuration for all TTS providers.
 *
 * This file owns:
 *   - The Voice type
 *   - Per-language voice pools (Google Chirp3 + Azure + Gemini)
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
 *   - google: "{locale}-Chirp3-HD-{name}"   e.g. "en-US-Chirp3-HD-Leda"
 *   - azure:  Azure voice short name        e.g. "sv-SE-SofieNeural"
 *
 * `active` gates whether a voice is eligible for selection. Dormant voices
 * stay in VOICE_POOLS (so re-enabling is a one-line flip) but are filtered
 * out of `getVoicesByLanguageCode`. See convex/lib/tts/index.ts for the
 * provider wiring.
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
 * Mark a voice list as selectable. Used by pools whose voices default to
 * dormant (e.g. Azure) but are the active provider for that language — wraps
 * the list so every entry becomes `active: true` without touching the
 * per-voice definitions.
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

// Swedish — native sv-SE Azure Neural voices. Catalog only ships 1 male
// (Mattias) and 2 female (Sofie, Hillevi) at the time of this change.
const AZURE_VOICES_SV: Voice[] = [
  createAzureVoice('Sofie', 'female', 'sv-SE-SofieNeural'),
  createAzureVoice('Hillevi', 'female', 'sv-SE-HilleviNeural'),
  createAzureVoice('Mattias', 'male', 'sv-SE-MattiasNeural'),
];

// Arabic Egyptian — Azure Neural M+F. All Arabic dialects now run on Gemini TTS
// (see VOICE_POOLS below); this Azure Egyptian pool and the Google MSA (`ar-XA`)
// pool are kept only as dormant one-line-revert fallbacks (filtered out by
// `getVoicesByLanguageCode` while ttsProvider is gemini).
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

// Persian (Iran) — Azure Neural fallback (Gemini fa-IR is the active provider).
// Verified against Azure's language-support docs: fa-IR ships two neural voices
// and is supported by Fast Transcription.
const AZURE_VOICES_FA_IR: Voice[] = [
  createAzureVoice('Dilara', 'female', 'fa-IR-DilaraNeural'),
  createAzureVoice('Farid', 'male', 'fa-IR-FaridNeural'),
];

// Filipino (Philippines) — Azure Neural fallback (Gemini fil-PH is the active
// provider). Verified against Azure's language-support docs: fil-PH ships two
// neural voices and is supported by Fast Transcription.
const AZURE_VOICES_FIL_PH: Voice[] = [
  createAzureVoice('Blessica', 'female', 'fil-PH-BlessicaNeural'),
  createAzureVoice('Angelo', 'male', 'fil-PH-AngeloNeural'),
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

// ---------------------------------------------------------------------------
// Per-language unified voice pools
//
// Each entry contains the full curated set — Google Chirp3 voices first (so a
// language can be switched back to `ttsProvider: 'google'` without touching
// voice config), then any Azure / Gemini pools.
// ---------------------------------------------------------------------------

// English "Mixed" pool — pooled US + GB + AU Chirp3 voices.
const CHIRP3_EN_MIXED: Voice[] = [
  ...buildChirp3Pool('en-US', 'US'),
  ...buildChirp3Pool('en-GB', 'UK'),
  ...buildChirp3Pool('en-AU', 'Australia'),
];

export const VOICE_POOLS: Record<string, Voice[]> = {
  // English runs on Gemini (mixed US/GB/AU accents on the default `en`, pinned
  // accent on the dialect codes). Google Chirp3 voices stay listed but go
  // dormant — the `ttsProvider: 'gemini'` filter excludes them — so a revert
  // is a one-line `ttsProvider` flip in lib/languages.ts.
  en: [...CHIRP3_EN_MIXED, ...GEMINI_EN_MIXED],
  en_gb: [...buildChirp3Pool('en-GB', 'UK'), ...GEMINI_EN_GB],
  en_us: [...buildChirp3Pool('en-US', 'US'), ...GEMINI_EN_US],
  en_au: [...buildChirp3Pool('en-AU', 'Australia'), ...GEMINI_EN_AU],
  // Spanish runs on Gemini TTS: Spain via `es-ES`, Latin America via `es-US`,
  // with the accent named in the prompt (lib/languages.ts `ttsPromptName`).
  // Google Chirp3 voices stay listed but dormant (filtered out by
  // `getVoicesByLanguageCode` while ttsProvider is gemini) for a one-line revert.
  es: [...GEMINI_CORE, ...buildChirp3Pool('es-ES', 'Spain')],
  es_latam: [...GEMINI_CORE, ...buildChirp3Pool('es-US', 'Latin America')],
  // Spanish Mixed — accent-tagged Gemini voices (`@es-ES` + `@es-US`, like the
  // English accent pools) so the audio-player can pick by the persisted
  // translation `regionVariant` via `getVoiceForLanguageVariant`. The dormant
  // Google Chirp3 pools are kept for revert.
  es_mixed: [
    ...buildGeminiAccentPool('es-ES'),
    ...buildGeminiAccentPool('es-US'),
    ...buildChirp3Pool('es-ES', 'Spain'),
    ...buildChirp3Pool('es-US', 'Latin America'),
  ],
  fr: [...buildChirp3Pool('fr-FR', 'France')],
  de: [...buildChirp3Pool('de-DE', 'Germany'), ...GEMINI_CORE],
  it: [...buildChirp3Pool('it-IT', 'Italy')],
  pt: [...buildChirp3Pool('pt-BR', 'Brazil')],
  // European Portuguese runs on Gemini. Google ships no Chirp3-HD pt-PT voices
  // (verified against /v1/voices), so there's no Google fallback to list —
  // Gemini is the only pool.
  pt_pt: [...GEMINI_CORE],
  ru: [...buildChirp3Pool('ru-RU', 'Russia', 'core')],
  pl: [...buildChirp3Pool('pl-PL', 'Poland')],
  sk: [...buildChirp3Pool('sk-SK', 'Slovakia'), ...AZURE_VOICES_SK],
  hi: [...buildChirp3Pool('hi-IN', 'India')],
  bn: [...buildChirp3Pool('bn-IN', 'Bengali'), ...AZURE_VOICES_BN],
  tr: [...buildChirp3Pool('tr-TR', 'Türkiye'), ...AZURE_VOICES_TR],
  hu: [...buildChirp3Pool('hu-HU', 'Hungary'), ...AZURE_VOICES_HU],
  ro: [...buildChirp3Pool('ro-RO', 'Romania'), ...AZURE_VOICES_RO],
  cs: [...buildChirp3Pool('cs-CZ', 'Czechia'), ...AZURE_VOICES_CS],
  zh: [
    ...buildChirp3Pool('cmn-CN', 'Mandarin'),
    // Dormant Dragon HD pool — activate by switching the language to Azure.
    ...AZURE_DRAGON_HD_VOICES_ZH,
  ],
  // No Google Chirp3-HD voices for cmn-TW — use Azure Neural zh-TW instead.
  zh_traditional: [...activate(AZURE_VOICES_ZH_TW)],
  yue: [...buildChirp3Pool('yue-HK', 'Hong Kong')],
  yue_traditional: [...buildChirp3Pool('yue-HK', 'Hong Kong')],
  ja: [...buildChirp3Pool('ja-JP', 'Japan')],
  ko: [...buildChirp3Pool('ko-KR', 'Korea')],
  vi: [...buildChirp3Pool('vi-VN', 'Vietnam')],
  th: [...buildChirp3Pool('th-TH', 'Thailand'), ...AZURE_VOICES_TH],
  id: [...buildChirp3Pool('id-ID', 'Indonesia')],
  // Filipino runs on Gemini TTS (fil-PH). No Google Chirp3-HD fil voices, so
  // Gemini is the active pool (mirrors fa); Azure fil-PH Neural voices are
  // listed dormant as a verified fallback (flip ttsProvider to 'azure').
  fil: [...GEMINI_CORE, ...AZURE_VOICES_FIL_PH],
  sv: [
    ...buildChirp3Pool('sv-SE', 'Sweden'),
    ...AZURE_VOICES_SV,
    ...GEMINI_CORE,
  ],
  // nb: [...buildChirp3Pool('nb-NO', 'Norway')], // disabled — see SUPPORTED_LANGUAGES
  da: [...buildChirp3Pool('da-DK', 'Denmark')],
  fi: [...buildChirp3Pool('fi-FI', 'Finland')],
  nl: [...buildChirp3Pool('nl-NL', 'Netherlands')],
  el: [...buildChirp3Pool('el-GR', 'Greece')],
  he: [...buildChirp3Pool('he-IL', 'Israel'), ...AZURE_VOICES_HE],
  // All Arabic dialects run on Gemini TTS: the global Arabic Gemini voice
  // (GEMINI_CORE) steered by `geminiBcp47` — `ar-001` for MSA/Saudi/Iraqi/
  // Levantine and the dedicated `ar-EG` for Egyptian — with each dialect named
  // in the prompt via `ttsPromptName` (lib/languages.ts). The prior Google MSA
  // (`ar-XA`) and Azure Egyptian pools stay listed as a dormant one-line-revert
  // fallback (filtered out by `getVoicesByLanguageCode` while ttsProvider is
  // gemini); switching a dialect's `ttsProvider` back re-activates them.
  ar: [...GEMINI_CORE, ...buildChirp3Pool('ar-XA', 'MSA')],
  ar_sa: [...GEMINI_CORE, ...buildChirp3Pool('ar-XA', 'MSA')],
  ar_eg: [...GEMINI_CORE, ...AZURE_VOICES_AR_EG],
  ar_iq: [...GEMINI_CORE, ...buildChirp3Pool('ar-XA', 'MSA')],
  ar_lev: [...GEMINI_CORE],
  // Persian runs on Gemini TTS (fa-IR). No Google Chirp3-HD fa voices, so
  // Gemini is the active pool (mirrors pt_pt). Azure fa-IR Neural voices are a
  // verified fallback: wrapped in activate() (createAzureVoice defaults to
  // active:false) so flipping the language's ttsProvider to 'azure' actually
  // surfaces them — without activate() the provider filter would resolve to an
  // empty pool. They stay dormant while ttsProvider is 'gemini' because
  // getVoicesForLanguage also filters by provider.
  fa: [...GEMINI_CORE, ...activate(AZURE_VOICES_FA_IR)],
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

/** Minimal view of a `texts` row needed to resolve its speaker genders. */
export interface SpeakerGenderInput {
  /** Linguistic speaker gender: 'male' | 'female' | 'neutral' | undefined. */
  speakerGender?: string;
  /** Previously-resolved voice gender: 'male' | 'female' | undefined. */
  audioSpeakerGender?: string;
  /** Whether the text is user-created (custom/chat) vs premade dataset. */
  userCreated: boolean;
}

/**
 * Resolve the voice gender (`audioSpeakerGender`) a card's audio should use, and
 * the patch (if any) to write back to the text so the translation prompt's
 * `<speaker_gender>` tag and the audio voice agree.
 *
 * Three cases (`seed` is the text id, used for a deterministic coin-flip):
 *   1. Definitive `speakerGender` ('male'/'female') — the source of truth; mirror
 *      it into `audioSpeakerGender`, never overwrite `speakerGender`.
 *   2. Custom + neutral/undefined — preserve the LLM's `speakerGender` verdict;
 *      only resolve `audioSpeakerGender` (preferring a prior resolution).
 *   3. Premade + neutral/undefined — coin-flip BOTH fields to the same value so
 *      the prompt and the voice agree.
 * Prior `audioSpeakerGender` is preserved when present so two runs don't re-roll.
 */
export function resolveCardSpeakerGenders(
  text: SpeakerGenderInput,
  seed: string,
): {
  audioSpeakerGender: 'male' | 'female';
  genderPatch: { speakerGender?: 'male' | 'female'; audioSpeakerGender?: 'male' | 'female' };
} {
  let audioSpeakerGender: 'male' | 'female';
  const genderPatch: {
    speakerGender?: 'male' | 'female';
    audioSpeakerGender?: 'male' | 'female';
  } = {};

  if (text.speakerGender === 'male' || text.speakerGender === 'female') {
    audioSpeakerGender = text.speakerGender;
    if (text.audioSpeakerGender !== audioSpeakerGender) {
      genderPatch.audioSpeakerGender = audioSpeakerGender;
    }
  } else if (text.userCreated) {
    audioSpeakerGender =
      text.audioSpeakerGender === 'male' || text.audioSpeakerGender === 'female'
        ? text.audioSpeakerGender
        : resolveAudioSpeakerGender(text.speakerGender, seed);
    if (text.audioSpeakerGender !== audioSpeakerGender) {
      genderPatch.audioSpeakerGender = audioSpeakerGender;
    }
  } else {
    audioSpeakerGender =
      text.audioSpeakerGender === 'male' || text.audioSpeakerGender === 'female'
        ? text.audioSpeakerGender
        : resolveAudioSpeakerGender(undefined, seed);
    if (text.speakerGender !== audioSpeakerGender) {
      genderPatch.speakerGender = audioSpeakerGender;
    }
    if (text.audioSpeakerGender !== audioSpeakerGender) {
      genderPatch.audioSpeakerGender = audioSpeakerGender;
    }
  }

  return { audioSpeakerGender, genderPatch };
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
 * voices matching `regionVariant` before applying the same gender preference
 * logic as `getVoiceForLanguage`. Falls back to the full pool when no voice
 * matches the variant.
 *
 * `regionVariant` is a Google locale such as `"es-ES"` or `"es-US"`, matched
 * against the apiCode in BOTH provider encodings: as a Chirp3 apiCode prefix
 * (`es-ES-Chirp3-HD-Leda`) and as a Gemini `@locale` suffix (`Leda@es-ES`). The
 * Gemini suffix path is the live one for es_mixed today (it runs on Gemini); the
 * Chirp3 prefix path is dormant. Pass it through verbatim from the persisted
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
  // Match the regional voice across providers: Google Chirp3 encodes the locale
  // as an apiCode PREFIX ("es-ES-Chirp3-HD-Leda"), while Gemini encodes it as an
  // `@locale` SUFFIX ("Leda@es-ES"). Handle both so es_mixed works on Gemini.
  const variantPool = all.filter(
    (v) =>
      v.apiCode.startsWith(`${regionVariant}-`) ||
      v.apiCode.endsWith(`@${regionVariant}`),
  );
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
 * "en-US-Chirp3-HD-Leda" → "en-US"). Returns null for non-Chirp3 voice IDs.
 */
export function getLocaleFromApiCode(apiCode: string): string | null {
  if (!apiCode.includes('-Chirp3-HD-')) return null;
  const parts = apiCode.split('-Chirp3-HD-');
  return parts[0] || null;
}

/**
 * Unique locales for a language (Google voices only; other providers' voices
 * are multilingual and carry no locale).
 */
export function getLocalesByLanguageCode(code: string): string[] {
  const locales = getAllVoicesByLanguageCode(code)
    .map((v) => getLocaleFromApiCode(v.apiCode))
    .filter((l): l is string => l !== null);
  return [...new Set(locales)];
}
