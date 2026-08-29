/**
 * Voice configuration for all TTS providers.
 *
 * This file owns:
 *   - The Voice type
 *   - Per-language voice pools (Google Chirp3 + Gemini)
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
 *   - gemini: "{name}" or "{name}@{locale}" e.g. "Leda", "Leda@en-GB"
 *
 * `active` gates whether a voice is eligible for selection. Dormant voices
 * stay in VOICE_POOLS (so re-enabling is a one-line flip) but are filtered
 * out of `getVoicesByLanguageCode`. See convex/lib/tts/index.ts for the
 * provider wiring. (Azure TTS was retired in Jul 2026, its voice pools were
 * removed with it; Azure Speech remains for STT only.)
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
 * Gemini 3.1 Flash TTS voices (via OpenRouter). The Gemini voice name itself is
 * accent-neutral; pronunciation/accent comes from the BCP-47 `language_code`
 * the provider sends. For single-locale languages (de, sv, pt_pt) the locale is
 * derived from the language code via `toGeminiBcp47`, so the apiCode is the bare
 * voice name (e.g. "Kore").
 *
 * For languages whose pool spans multiple accents (English: US/GB/AU) the
 * accent can't come from the language code, so the locale is encoded into the
 * apiCode as `"<Name>@<bcp47>"` (e.g. "Kore@en-GB"), mirroring how Google
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

// Every Chirp3 HD locale ships the same 16 voice names (8 female + 8 male),
// except some languages Google only offers the 8-voice core set. We build
// per-language pools from these shared name lists so the file stays readable.
const CHIRP3_STANDARD_FEMALES = [
  'Leda',
  'Kore',
  'Aoede',
  'Zephyr',
  'Achernar',
  'Autonoe',
  'Callirrhoe',
  'Sulafat',
] as const;
const CHIRP3_STANDARD_MALES = [
  'Charon',
  'Puck',
  'Fenrir',
  'Orus',
  'Achird',
  'Algenib',
  'Enceladus',
  'Umbriel',
] as const;
const CHIRP3_CORE_FEMALES = CHIRP3_STANDARD_FEMALES.slice(0, 4);
const CHIRP3_CORE_MALES = CHIRP3_STANDARD_MALES.slice(0, 4);

/**
 * MiniMax Speech 2.8 Turbo voices (via OpenRouter, see
 * convex/lib/tts/minimax.ts). The apiCode is the raw MiniMax system voice id;
 * language + dialect are baked into the voice itself (no locale steering).
 * NOTE the ids use a FULLWIDTH opening paren + ASCII closing paren. The
 * all-ASCII form errors upstream (verified live). MiniMax's other Cantonese
 * presets (GentleLady, PlayfulMan, CuteGirl, KindWoman) were skipped as
 * character-flavored; the ProfessionalHost pair are the neutral narrators.
 */
const MINIMAX_CANTONESE: Voice[] = [
  {
    provider: 'minimax',
    name: 'HostF',
    displayName: 'Professional Host (Female) - MiniMax Cantonese',
    apiCode: 'Cantonese_ProfessionalHost（F)',
    gender: 'female',
  },
  {
    provider: 'minimax',
    name: 'HostM',
    displayName: 'Professional Host (Male) - MiniMax Cantonese',
    apiCode: 'Cantonese_ProfessionalHost（M)',
    gender: 'male',
  },
];

function buildChirp3Pool(
  locale: string,
  accentLabel: string,
  variant: 'standard' | 'core' = 'standard',
): Voice[] {
  const females =
    variant === 'core' ? CHIRP3_CORE_FEMALES : CHIRP3_STANDARD_FEMALES;
  const males = variant === 'core' ? CHIRP3_CORE_MALES : CHIRP3_STANDARD_MALES;
  return [
    ...females.map((n) => createChirp3Voice(n, 'female', locale, accentLabel)),
    ...males.map((n) => createChirp3Voice(n, 'male', locale, accentLabel)),
  ];
}

// ---------------------------------------------------------------------------
// Per-language unified voice pools
//
// Each entry contains the full curated set. Google Chirp3 voices first (so a
// language can be switched back to `ttsProvider: 'google'` without touching
// voice config), then any Gemini pools.
// ---------------------------------------------------------------------------

// English "Mixed" pool. Pooled US + GB + AU Chirp3 voices.
const CHIRP3_EN_MIXED: Voice[] = [
  ...buildChirp3Pool('en-US', 'US'),
  ...buildChirp3Pool('en-GB', 'UK'),
  ...buildChirp3Pool('en-AU', 'Australia'),
];

export const VOICE_POOLS: Record<string, Voice[]> = {
  // English runs on Gemini (mixed US/GB/AU accents on the default `en`, pinned
  // accent on the dialect codes). Google Chirp3 voices stay listed but go
  // dormant. The `ttsProvider: 'gemini'` filter excludes them, so a revert
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
  // Spanish Mixed. Accent-tagged Gemini voices (`@es-ES` + `@es-US`, like the
  // English accent pools) so the audio-player can pick by the persisted
  // translation `regionVariant` via `getVoiceForLanguageVariant`. The dormant
  // Google Chirp3 pools are kept for revert.
  es_mixed: [
    ...buildGeminiAccentPool('es-ES'),
    ...buildGeminiAccentPool('es-US'),
    ...buildChirp3Pool('es-ES', 'Spain'),
    ...buildChirp3Pool('es-US', 'Latin America'),
  ],
  fr: [...buildChirp3Pool('fr-FR', 'France'), ...GEMINI_CORE],
  de: [...buildChirp3Pool('de-DE', 'Germany'), ...GEMINI_CORE],
  it: [...buildChirp3Pool('it-IT', 'Italy'), ...GEMINI_CORE],
  pt: [...buildChirp3Pool('pt-BR', 'Brazil'), ...GEMINI_CORE],
  // European Portuguese runs on Gemini. Google ships no Chirp3-HD pt-PT voices
  // (verified against /v1/voices), so there's no Google fallback to list.
  // Gemini is the only pool.
  pt_pt: [...GEMINI_CORE],
  ru: [...buildChirp3Pool('ru-RU', 'Russia', 'core'), ...GEMINI_CORE],
  pl: [...buildChirp3Pool('pl-PL', 'Poland'), ...GEMINI_CORE],
  sk: [...buildChirp3Pool('sk-SK', 'Slovakia'), ...GEMINI_CORE],
  hi: [...buildChirp3Pool('hi-IN', 'India'), ...GEMINI_CORE],
  // Bengali runs on Gemini TTS (bn-BD via `geminiBcp47`). The Chirp3 bn-IN
  // pool stays listed dormant for a one-line revert.
  bn: [...GEMINI_CORE, ...buildChirp3Pool('bn-IN', 'Bengali')],
  tr: [...buildChirp3Pool('tr-TR', 'Türkiye'), ...GEMINI_CORE],
  hu: [...buildChirp3Pool('hu-HU', 'Hungary'), ...GEMINI_CORE],
  ro: [...buildChirp3Pool('ro-RO', 'Romania'), ...GEMINI_CORE],
  cs: [...buildChirp3Pool('cs-CZ', 'Czechia'), ...GEMINI_CORE],
  zh: [...buildChirp3Pool('cmn-CN', 'Mandarin'), ...GEMINI_CORE],
  // Mandarin-Traditional runs on Gemini TTS (cmn-TW via `geminiBcp47`, accent
  // reinforced by `ttsPromptName: 'Taiwanese Mandarin'`). Azure TTS is retired
  // and Google ships no Chirp3-HD voices for cmn-TW, so Gemini is the only pool.
  zh_traditional: [...GEMINI_CORE],
  // Cantonese runs on MiniMax (native Cantonese system voices, Gemini has
  // none, and Chirp3-HD misread 唔; see convex/lib/tts/minimax.ts). The
  // Chirp3 yue-HK pool stays listed dormant for a one-line revert. Both
  // script variants share the same audio.
  yue: [...MINIMAX_CANTONESE, ...buildChirp3Pool('yue-HK', 'Hong Kong')],
  yue_traditional: [
    ...MINIMAX_CANTONESE,
    ...buildChirp3Pool('yue-HK', 'Hong Kong'),
  ],
  ja: [...buildChirp3Pool('ja-JP', 'Japan'), ...GEMINI_CORE],
  ko: [...buildChirp3Pool('ko-KR', 'Korea'), ...GEMINI_CORE],
  vi: [...buildChirp3Pool('vi-VN', 'Vietnam'), ...GEMINI_CORE],
  // Southern Vietnamese runs on Gemini TTS (vi-VN locale + 'Southern
  // Vietnamese' named in the prompt, Gemini has no southern locale). The
  // Chirp3 vi-VN pool is listed dormant for a one-line provider revert; it
  // carries no dialect distinction either.
  vi_south: [...buildChirp3Pool('vi-VN', 'Vietnam'), ...GEMINI_CORE],
  th: [...buildChirp3Pool('th-TH', 'Thailand'), ...GEMINI_CORE],
  id: [...buildChirp3Pool('id-ID', 'Indonesia'), ...GEMINI_CORE],
  // Filipino runs on Gemini TTS (fil-PH). No Google Chirp3-HD fil voices, so
  // Gemini is the only pool (mirrors fa / pt_pt).
  fil: [...GEMINI_CORE],
  sv: [...buildChirp3Pool('sv-SE', 'Sweden'), ...GEMINI_CORE],
  nb: [...buildChirp3Pool('nb-NO', 'Norway'), ...GEMINI_CORE],
  da: [...buildChirp3Pool('da-DK', 'Denmark'), ...GEMINI_CORE],
  is: [...GEMINI_CORE],
  fi: [...buildChirp3Pool('fi-FI', 'Finland'), ...GEMINI_CORE],
  nl: [...buildChirp3Pool('nl-NL', 'Netherlands'), ...GEMINI_CORE],
  el: [...buildChirp3Pool('el-GR', 'Greece'), ...GEMINI_CORE],
  he: [...buildChirp3Pool('he-IL', 'Israel'), ...GEMINI_CORE],
  // Jul 2026 expansion wave. All Gemini-only pools (locale pinned via each
  // language's `geminiBcp47`; no Google Chirp3 pools were verified for these).
  ca: [...GEMINI_CORE],
  hr: [...GEMINI_CORE],
  sl: [...GEMINI_CORE],
  uk: [...GEMINI_CORE],
  sr: [...GEMINI_CORE],
  // Bulgarian (Aug 2026), same shape: Gemini-only, locale pinned by `bg-BG`.
  bg: [...GEMINI_CORE],
  lt: [...GEMINI_CORE],
  lv: [...GEMINI_CORE],
  et: [...GEMINI_CORE],
  ms: [...GEMINI_CORE],
  ta: [...GEMINI_CORE],
  te: [...GEMINI_CORE],
  // All Arabic dialects run on Gemini TTS: the global Arabic Gemini voice
  // (GEMINI_CORE) steered by `geminiBcp47`. `ar-001` for MSA/Saudi/Iraqi/
  // Levantine and the dedicated `ar-EG` for Egyptian, with each dialect named
  // in the prompt via `ttsPromptName` (lib/languages.ts). The prior Google MSA
  // (`ar-XA`) and Azure Egyptian pools stay listed as a dormant one-line-revert
  // fallback (filtered out by `getVoicesByLanguageCode` while ttsProvider is
  // gemini); switching a dialect's `ttsProvider` back re-activates them.
  ar: [...GEMINI_CORE, ...buildChirp3Pool('ar-XA', 'MSA')],
  ar_sa: [...GEMINI_CORE, ...buildChirp3Pool('ar-XA', 'MSA')],
  ar_eg: [...GEMINI_CORE],
  ar_iq: [...GEMINI_CORE, ...buildChirp3Pool('ar-XA', 'MSA')],
  ar_lev: [...GEMINI_CORE],
  // Persian runs on Gemini TTS (fa-IR). No Google Chirp3-HD fa voices, so
  // Gemini is the only pool (mirrors pt_pt).
  fa: [...GEMINI_CORE],
  sw: [...GEMINI_CORE],
  // Tanzanian Swahili runs on Gemini TTS (sw-KE locale + 'Tanzanian Swahili'
  // named in the prompt, Gemini has no sw-TZ locale).
  sw_tz: [...GEMINI_CORE],
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Get voices available for synthesis for a language. Filtered to the
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
 * **deterministic**. Two concurrent callers for the same text will produce
 * the same gender. Without a seed the function falls back to `Math.random()`,
 * which is fine for one-shot creation paths (where the result is stored on
 * insert and never re-flipped) but causes a race for paths that may run
 * multiple times against an already-inserted text (e.g. `scheduleMissingContent`
 * for a text whose `audioSpeakerGender` field hasn't been written yet).
 * Two racing jobs would each flip independently and produce inconsistent
 * audio rows, triggering an audio-regeneration loop the next time the
 * stored gender is reconciled.
 */
export function resolveAudioSpeakerGender(
  speakerGender?: string,
  seed?: string,
): 'male' | 'female' {
  if (speakerGender === 'male' || speakerGender === 'female')
    return speakerGender;
  if (seed && seed.length > 0) {
    // FNV-1a. Fast and well-distributed for short identifiers like a
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
 *   1. Definitive `speakerGender` ('male'/'female'): the source of truth; mirror
 *      it into `audioSpeakerGender`, never overwrite `speakerGender`.
 *   2. Custom + neutral/undefined: preserve the LLM's `speakerGender` verdict;
 *      only resolve `audioSpeakerGender` (preferring a prior resolution).
 *   3. Premade + neutral/undefined: coin-flip BOTH fields to the same value so
 *      the prompt and the voice agree.
 * Prior `audioSpeakerGender` is preserved when present so two runs don't re-roll.
 */
export function resolveCardSpeakerGenders(
  text: SpeakerGenderInput,
  seed: string,
): {
  audioSpeakerGender: 'male' | 'female';
  genderPatch: {
    speakerGender?: 'male' | 'female';
    audioSpeakerGender?: 'male' | 'female';
  };
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
