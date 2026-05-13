/**
 * Language metadata for the Flexling app.
 *
 * This file owns:
 *   - The Language and TtsProvider types
 *   - SUPPORTED_LANGUAGES (pure metadata — no voices)
 *   - Language-metadata helpers (name lookup, short labels, romanization, …)
 *
 * Voice data and voice-selection helpers live in `lib/voices.ts`. They're
 * re-exported at the bottom of this file so existing imports of things like
 * `getVoiceForLanguage` from `lib/languages` keep working.
 */

/** Identifier for which TTS backend a language currently uses. */
export type TtsProvider = 'google' | 'elevenlabs' | 'azure';

/** Identifier for which translation backend a target language currently uses. */
export type TranslationProvider = 'google' | 'openrouter';

/**
 * BCP-47-ish region label used in the LLM translation prompt's <context>.
 * Tells the model whether to lean Spanish-Spain vs Spanish-LatAm,
 * Portuguese-Brazil vs Portuguese-Portugal, etc.
 */
function regionLabelFromDisplayCode(displayCode: string): string {
  const REGION_MAP: Record<string, string> = {
    'es-ES': 'Spain',
    'es-419': 'Latin America',
    'pt-BR': 'Brazil',
    'pt-PT': 'Portugal',
    'zh-CN': 'Mainland China',
    'zh-TW': 'Taiwan',
    'en-US': 'United States',
    'en-GB': 'United Kingdom',
    'en-AU': 'Australia',
    'ar-SA': 'Saudi Arabia',
    'ar-EG': 'Egypt',
    'ar-IQ': 'Iraq',
    'yue-Hans-HK': 'Hong Kong (simplified script)',
    'yue-Hant-HK': 'Hong Kong (traditional script)',
    'sw-KE': 'Kenya',
    'sw-TZ': 'Tanzania',
    'nb-NO': 'Norway',
    'sv-SE': 'Sweden',
    'da-DK': 'Denmark',
    'fi-FI': 'Finland',
  };
  if (REGION_MAP[displayCode]) return REGION_MAP[displayCode];
  // Fall through: take the region segment after the dash, or the language tag if there isn't one.
  const dash = displayCode.indexOf('-');
  return dash >= 0 ? displayCode.slice(dash + 1) : displayCode;
}

/** Coarse grouping for the grouped language picker. */
export type LanguageCategory =
  | 'germanic'
  | 'romance'
  | 'slavic'
  | 'asian-east'
  | 'asian-southeast'
  | 'semitic'
  | 'african'
  | 'other';

/** Whether tier-1 LLMs reliably handle this language for translation/teaching. */
export type LlmSupportTier = 'tier1' | 'tier2';

export interface Language {
  code: string; // Internal language code (e.g. "en", "es_latam", "zh")
  displayCode: string; // BCP 47 tag for display (e.g. "es-MX", "zh-CN")
  name: string; // English name (fallback)
  nativeName: string; // Name in the language itself
  flag: string; // Flag emoji
  /** Coarse grouping for the grouped language picker (search + section headers). */
  category: LanguageCategory;
  /** Whether tier-1 LLMs reliably handle this language. UI may surface a "less supported" badge for tier2. */
  llmSupportTier: LlmSupportTier;
  /** Which provider's voices the app uses for this language right now. */
  ttsProvider: TtsProvider;
  /** Whether the script requires Latin transliteration for learners. */
  needsRomanization: boolean;
  /**
   * Whether per-word karaoke highlighting (the blue current-word colour
   * during audio playback) makes sense for this language. False for languages
   * where Intl.Segmenter produces per-morpheme tokens that flicker too fast
   * to read — currently only Japanese. Click-to-explain popovers are still
   * rendered regardless.
   */
  supportsKaraoke: boolean;
  /**
   * Whether our STT backend (Azure Fast Transcription, api-version
   * 2024-11-15) can transcribe audio in this language. Gates two downstream
   * features: TTS validation roundtrips (synthesize → transcribe → compare)
   * and per-word audio timings. Karaoke highlighting depends on timings, so
   * `supportsKaraoke: true` only takes effect when this is also true.
   *
   * Currently false only for Greek (`el`): the locale `el-GR` is absent from
   * Azure Fast Transcription's supported list, so calls return 400 InvalidLocale.
   * If you add a language, check the "Fast transcription support" column at
   * https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=stt
   */
  supportsStt: boolean;
  /**
   * Which backend translates English → this language. Omit to take the
   * default: 'openrouter' for every non-English language, 'google' for English
   * (which is source-only and never translated by the system).
   * Set to 'google' explicitly to keep a language on the legacy Google
   * Translate path (e.g. if a particular language regresses on LLM translation).
   */
  translationProvider?: TranslationProvider;
  /**
   * Named pipeline that decides which OpenRouter model(s) + reasoning levels
   * the translation worker uses for this language, with optional fallbacks
   * on truncation. Defined in TRANSLATION_RULES below. Unset → `default_hybrid`
   * (Gemini Flash Lite with length-based reasoning, no fallback).
   */
  translationRule?: TranslationRuleId;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: 'en',
    displayCode: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🌐',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'en_gb',
    displayCode: 'en-GB',
    name: 'English (UK)',
    nativeName: 'English (UK)',
    flag: '🇬🇧',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'en_us',
    displayCode: 'en-US',
    name: 'English (US)',
    nativeName: 'English (US)',
    flag: '🇺🇸',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'en_au',
    displayCode: 'en-AU',
    name: 'English (Australia)',
    nativeName: 'English (Australia)',
    flag: '🇦🇺',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'es',
    displayCode: 'es-ES',
    name: 'Spanish (Spain)',
    nativeName: 'Español (España)',
    flag: '🇪🇸',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'es_latam',
    displayCode: 'es-419',
    name: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
    flag: '🌎',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'es_mixed',
    // Sentinel displayCode — the LLM-prompt/STT/voice paths special-case `es_mixed`
    // and expand to es-ES + es-419/es-MX as needed; Intl.DisplayNames is overridden
    // for this code so the displayCode value itself is never user-facing.
    displayCode: 'es',
    name: 'Spanish (Mixed)',
    nativeName: 'Español (mixto)',
    flag: '🌐',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'fr',
    displayCode: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'de',
    displayCode: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'it',
    displayCode: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'pt',
    displayCode: 'pt',
    name: 'Portuguese (Brazil)',
    nativeName: 'Português',
    flag: '🇧🇷',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ro',
    displayCode: 'ro',
    name: 'Romanian',
    nativeName: 'Română',
    flag: '🇷🇴',
    category: 'romance',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ru',
    displayCode: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    flag: '🇷🇺',
    category: 'slavic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'pl',
    displayCode: 'pl',
    name: 'Polish',
    nativeName: 'Polski',
    flag: '🇵🇱',
    category: 'slavic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'sk',
    displayCode: 'sk',
    name: 'Slovak',
    nativeName: 'Slovenčina',
    flag: '🇸🇰',
    category: 'slavic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'cs',
    displayCode: 'cs',
    name: 'Czech',
    nativeName: 'Čeština',
    flag: '🇨🇿',
    category: 'slavic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'nl',
    displayCode: 'nl',
    name: 'Dutch',
    nativeName: 'Nederlands',
    flag: '🇳🇱',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'sv',
    displayCode: 'sv',
    name: 'Swedish',
    nativeName: 'Svenska',
    flag: '🇸🇪',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'azure',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'nb',
    displayCode: 'nb',
    name: 'Norwegian (Bokmål)',
    nativeName: 'Norsk bokmål',
    flag: '🇳🇴',
    category: 'germanic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'da',
    displayCode: 'da',
    name: 'Danish',
    nativeName: 'Dansk',
    flag: '🇩🇰',
    category: 'germanic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'fi',
    displayCode: 'fi',
    name: 'Finnish',
    nativeName: 'Suomi',
    flag: '🇫🇮',
    // Uralic (Finno-Ugric), not Germanic. Grouped with `other` to stay
    // consistent with Hungarian (the only other Uralic entry in the catalog).
    category: 'other',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'el',
    displayCode: 'el',
    name: 'Greek',
    nativeName: 'Ελληνικά',
    flag: '🇬🇷',
    category: 'other',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: false,
    // Azure Fast Transcription doesn't support el-GR; without STT we can't
    // produce per-word timings, so karaoke highlighting will no-op for Greek.
    supportsStt: false,
  },
  {
    code: 'hi',
    displayCode: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    category: 'other',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'bn',
    displayCode: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    flag: '🇧🇩',
    category: 'other',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'tr',
    displayCode: 'tr',
    name: 'Turkish',
    nativeName: 'Türkçe',
    flag: '🇹🇷',
    category: 'other',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'hu',
    displayCode: 'hu',
    name: 'Hungarian',
    nativeName: 'Magyar',
    flag: '🇭🇺',
    // Uralic (like Finnish), but no clean cluster of Uralic learners yet —
    // grouped with 'other' rather than forced into Germanic.
    category: 'other',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'zh',
    displayCode: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '中文（简体）',
    flag: '🇨🇳',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    // Disabled along with other CJK + Thai languages: word-level segmentation
    // produces per-character tokens that flicker too fast to read. Revisit
    // when we have a learner-grade segmenter.
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'zh_traditional',
    displayCode: 'zh-TW',
    name: 'Chinese (Traditional)',
    nativeName: '中文（繁體）',
    flag: '🇹🇼',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'yue',
    displayCode: 'yue-Hans-HK',
    name: 'Cantonese (Simplified)',
    nativeName: '粵語（简体）',
    flag: '🇭🇰',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    // Romanization via cantonese-romanisation (LSHK / Jyutping). The lookup
    // table is traditional-script oriented, so simplified Cantonese may
    // surface gaps for a few characters — see romanizeCantonese().
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'yue_traditional',
    displayCode: 'yue-Hant-HK',
    name: 'Cantonese (Traditional)',
    nativeName: '粵語（繁體）',
    flag: '🇭🇰',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'ja',
    displayCode: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    // Japanese tokenizes per-morpheme; karaoke flickers too fast to read.
    // Click-to-explain popovers still work — only the current-word colour
    // is gated off.
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'ko',
    displayCode: 'ko',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'vi',
    displayCode: 'vi',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    flag: '🇻🇳',
    category: 'asian-southeast',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'th',
    displayCode: 'th',
    name: 'Thai',
    nativeName: 'ไทย',
    flag: '🇹🇭',
    category: 'asian-southeast',
    llmSupportTier: 'tier2',
    ttsProvider: 'azure',
    // Romanization disabled — Google v3 doesn't support Thai, and the
    // available pure-JS Thai libraries have not yet been evaluated for
    // learner-grade quality. Re-enable once a good lib is wired up.
    needsRomanization: false,
    // No spaces between words; per-character karaoke flickers. Disabled
    // alongside CJK; revisit with a learner-grade Thai segmenter.
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'id',
    displayCode: 'id',
    name: 'Indonesian',
    nativeName: 'Bahasa Indonesia',
    flag: '🇮🇩',
    category: 'asian-southeast',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ar',
    displayCode: 'ar',
    name: 'Arabic (Modern Standard)',
    nativeName: 'العربية (الفصحى)',
    flag: '🇸🇦',
    category: 'semitic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ar_sa',
    displayCode: 'ar-SA',
    name: 'Arabic (Saudi)',
    nativeName: 'العربية (السعودية)',
    flag: '🇸🇦',
    category: 'semitic',
    llmSupportTier: 'tier2',
    ttsProvider: 'azure',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ar_eg',
    displayCode: 'ar-EG',
    name: 'Arabic (Egyptian)',
    nativeName: 'العربية (المصرية)',
    flag: '🇪🇬',
    category: 'semitic',
    llmSupportTier: 'tier2',
    ttsProvider: 'azure',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ar_iq',
    displayCode: 'ar-IQ',
    name: 'Arabic (Iraqi)',
    nativeName: 'العربية (العراقية)',
    flag: '🇮🇶',
    category: 'semitic',
    llmSupportTier: 'tier2',
    ttsProvider: 'azure',
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'he',
    displayCode: 'he',
    name: 'Hebrew',
    nativeName: 'עברית',
    flag: '🇮🇱',
    category: 'semitic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    // Romanization via the `hebrew-transliteration` package (SBL Academic
    // style), wired in convex/lib/localRomanization.ts.
    needsRomanization: true,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'sw',
    displayCode: 'sw-KE',
    name: 'Swahili (Kenya)',
    nativeName: 'Kiswahili (Kenya)',
    flag: '🇰🇪',
    category: 'african',
    llmSupportTier: 'tier2',
    ttsProvider: 'azure',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'sw_tz',
    displayCode: 'sw-TZ',
    name: 'Swahili (Tanzania)',
    nativeName: 'Kiswahili (Tanzania)',
    flag: '🇹🇿',
    category: 'african',
    llmSupportTier: 'tier2',
    ttsProvider: 'azure',
    needsRomanization: false,
    supportsKaraoke: false,
    // Azure Fast Transcription rejects sw-TZ (May 2026). sw-KE is supported;
    // sw_tz courses inherit the Greek pattern — no validation roundtrips,
    // no per-word timings, no karaoke.
    supportsStt: false,
  },
];

// ---------------------------------------------------------------------------
// Language-metadata helpers
// ---------------------------------------------------------------------------

/** Get a language by its internal code (e.g. "es", "es_latam", "zh"). */
export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

/**
 * Which TTS provider is active for the given language.
 * Defaults to 'google' when the language is not found so callers get a safe
 * fallback instead of throwing.
 */
export function getTtsProviderForLanguage(code: string): TtsProvider {
  return getLanguageByCode(code)?.ttsProvider ?? 'google';
}

// ---------------------------------------------------------------------------
// Translation rules — named (model × reasoning × fallback) pipelines.
//
// A rule is a list of length-keyed branches; each branch declares a primary
// model+reasoning and an ordered fallback chain. The translation worker
// resolves the rule for a sentence by (a) finding the first branch whose
// `maxChars` matches the sentence length, then (b) trying primary → each
// fallback in turn until a stage succeeds or the chain is exhausted. After
// the chain exhausts, the worker schedules the legacy Google Translate path
// as the final safety net.
//
// To add a new pipeline:
//   1. Define a new entry in TRANSLATION_RULES below.
//   2. Set `translationRule: '<id>'` on the Language entries that should use it.
//   3. If a language has no `translationRule`, it falls back to `default_hybrid`.
// ---------------------------------------------------------------------------

/** One leg of a translation rule — an OpenRouter model + optional reasoning. */
export type ModelStage = {
  /** OpenRouter slug, e.g. `'google/gemini-3.1-flash-lite-preview'`. */
  model: string;
  /** Reasoning / thinking effort. `undefined` = no thinking. */
  reasoning?: 'low' | 'medium' | 'high';
  /**
   * Per-stage cap on response tokens. Tuned so reasoning-heavy stages have
   * the headroom their thinking traces need (DeepSeek V4 Flash with `high`
   * effort can consume 3–6K tokens of thinking before any visible output)
   * while no-reasoning stages stay tight on cost. `translateTextWithLLM`
   * applies the constant `DEFAULT_MAX_OUTPUT_TOKENS` when this is unset.
   */
  maxOutputTokens?: number;
};

type LengthBranch = {
  /**
   * Maximum source-text character length for this branch (inclusive). Use
   * `Infinity` for the catch-all branch at the end. Branches are evaluated
   * in order; the first matching one wins.
   */
  maxChars: number;
  primary: ModelStage;
  /**
   * Ordered fallback stages tried on truncation / empty output / HTTP failure
   * before the worker schedules the Google Translate path.
   */
  fallbacks?: ModelStage[];
};

export type TranslationRule = {
  id: string;
  /** Human-readable summary for logs and eval reports. */
  label: string;
  branches: LengthBranch[];
};

// --- Shared model stages (referenced by multiple rules) --------------------

// Gemini Flash Lite never approaches the 5K token mark on translation output —
// the cap is mainly a runaway safeguard.
const GEMINI_FLASH_LITE: ModelStage = {
  model: 'google/gemini-3.1-flash-lite-preview',
  maxOutputTokens: 5_000,
};
const GEMINI_FLASH_LITE_LOW: ModelStage = {
  model: 'google/gemini-3.1-flash-lite-preview',
  reasoning: 'low',
  maxOutputTokens: 5_000,
};
// DeepSeek V4 Flash at `high` reasoning emits 3–6K tokens of thinking before
// the visible translation. The wider 8K cap gives the thinking trace room
// before truncation triggers the Gemini fallback stage.
const DEEPSEEK_V4_FLASH_HIGH: ModelStage = {
  model: 'deepseek/deepseek-v4-flash',
  reasoning: 'high',
  maxOutputTokens: 8_000,
};

/**
 * Source-length threshold (characters) used by length-hybrid rules.
 * Sentences strictly below this are considered "short" and routed to the
 * no-thinking branch in `default_hybrid`. Eval data in
 * `data_preparation/translation_eval/` justified 30 chars as the breakpoint
 * where reasoning starts to pay off.
 */
export const HYBRID_LENGTH_THRESHOLD = 30;

export const TRANSLATION_RULES = {
  /**
   * Default for every language without an explicit `translationRule`.
   * Short sentences run Gemini Flash Lite with no reasoning (fast + cheap);
   * longer ones get `reasoning: 'low'` for better idiom + grammar handling.
   */
  default_hybrid: {
    id: 'default_hybrid',
    label: 'Gemini Flash Lite — length-hybrid reasoning',
    branches: [
      { maxChars: HYBRID_LENGTH_THRESHOLD - 1, primary: GEMINI_FLASH_LITE },
      { maxChars: Infinity, primary: GEMINI_FLASH_LITE_LOW },
    ],
  },
  /**
   * DeepSeek V4 Flash with high reasoning, Gemini Flash Lite fallback on
   * truncation. Currently **not assigned to any language** — kept around so
   * we can re-enable it after running a quality eval. An initial side-by-side
   * comparison on English→Chinese sentences showed DeepSeek tends toward
   * over-literal renderings on idiomatic Chinese vs. Gemini Flash Lite, so
   * all Asian languages are routed through `default_hybrid` for now.
   */
  asian_deepseek: {
    id: 'asian_deepseek',
    label: 'DeepSeek V4 Flash (high) → Gemini Flash Lite on truncation',
    branches: [
      {
        maxChars: Infinity,
        primary: DEEPSEEK_V4_FLASH_HIGH,
        fallbacks: [GEMINI_FLASH_LITE],
      },
    ],
  },
} satisfies Record<string, TranslationRule>;

export type TranslationRuleId = keyof typeof TRANSLATION_RULES;

/**
 * Resolve the ordered stages the translation worker should try for a given
 * (language, source-text-length) pair. Returns `[primary, ...fallbacks]` from
 * the matching branch of the language's rule (or `default_hybrid` when the
 * language doesn't set one).
 */
export function resolveTranslationStages(
  code: string,
  sourceTextLength: number,
): ModelStage[] {
  const lang = getLanguageByCode(code);
  const ruleId: TranslationRuleId = lang?.translationRule ?? 'default_hybrid';
  // Cast through `TranslationRule` so each branch is typed as the union with
  // optional `fallbacks`. `satisfies` above narrows literals (some branches
  // don't declare `fallbacks`), which would otherwise drop that property
  // from the per-branch type when accessed below.
  const rule: TranslationRule = TRANSLATION_RULES[ruleId];
  const branch =
    rule.branches.find((b) => sourceTextLength <= b.maxChars) ??
    rule.branches[rule.branches.length - 1];
  return [branch.primary, ...(branch.fallbacks ?? [])];
}

/**
 * Resolved per-language context for the LLM prompt. Drops `model`/`reasoning`
 * — those now come from `resolveTranslationStages` since they depend on
 * source-text length and may include a fallback chain.
 */
export type ResolvedTranslationConfig = {
  provider: TranslationProvider;
  targetRegion: string;                      // for the LLM prompt's <context>
  targetLangName: string;                    // English language name
  /**
   * Language name in its native script (e.g. 'Deutsch', '中文（简体）'). Always
   * injected alongside the English name in LLM prompts — see translationLLM.ts
   * and customTexts.ts. Falls back to the English name when the language has
   * no separate native form (e.g. English variants).
   */
  targetLangNativeName: string;
};

export function getTranslationConfigForLanguage(
  code: string,
): ResolvedTranslationConfig {
  const lang = getLanguageByCode(code);
  // Unknown / English → Google. English is source-only and never translated by
  // the system, but defaulting unknowns to Google is also the safe behavior.
  if (!lang || lang.code === 'en') {
    return {
      provider: lang?.translationProvider ?? 'google',
      targetRegion: lang ? regionLabelFromDisplayCode(lang.displayCode) : code,
      targetLangName: lang?.name ?? code,
      targetLangNativeName: lang?.nativeName ?? lang?.name ?? code,
    };
  }
  // Non-English: default to openrouter unless the language explicitly opts back to google.
  const provider: TranslationProvider = lang.translationProvider ?? 'openrouter';
  return {
    provider,
    targetRegion: regionLabelFromDisplayCode(lang.displayCode),
    targetLangName: lang.name,
    targetLangNativeName: lang.nativeName,
  };
}

/**
 * Short tag for badges, chat previews, audio button labels, etc.
 * Both Spanish variants map to "ES" so internal codes like es_latam never
 * appear in the UI.
 */
export function getLanguageShortLabel(code: string | null | undefined): string {
  if (!code) return '';
  const normalized = code.toLowerCase();
  if (normalized === 'es' || normalized === 'es_latam') return 'ES';
  const language = getLanguageByCode(code);
  return language ? language.code.toUpperCase() : code.toUpperCase();
}

/** Resolve an array of codes to Language objects, dropping unknowns. */
export function getLanguagesByCodes(codes: string[]): Language[] {
  return codes
    .map((code) => getLanguageByCode(code))
    .filter((lang): lang is Language => lang !== undefined);
}

/** Human-readable course label like "English → Spanish, Japanese". */
export function generateCourseName(
  baseLanguageCodes: string[],
  targetLanguageCodes: string[],
): string {
  const baseLanguages = getLanguagesByCodes(baseLanguageCodes);
  const targetLanguages = getLanguagesByCodes(targetLanguageCodes);
  const baseName = baseLanguages.map((l) => l.name).join(', ');
  const targetName = targetLanguages.map((l) => l.name).join(', ');
  return `${baseName} → ${targetName}`;
}

// Display-name overrides applied before falling back to Intl.DisplayNames.
// Used where Intl returns an ambiguous string ("Cantonese" for both yue
// scripts, "Spanish" for every es-* tag) or where we model a sentinel variant
// ("Mixed"). Two lookup paths share the same map: internal codes (es_mixed,
// zh_traditional) AND raw displayCodes for back-compat with the historical
// `getLocalizedLanguageName('zh-CN', 'en')` contract.
const NAME_OVERRIDES: Record<string, Record<string, string>> = {
  // `en` falls through to Intl.DisplayNames so it displays as plain
  // "English" / "Englisch" with no "(Mixed)" qualifier — the variant codes
  // (en_gb / en_us / en_au) are what users see when they want a specific
  // accent; `en` is the default English.
  en_gb: { en: 'English (UK)', de: 'Englisch (UK)' },
  en_us: { en: 'English (US)', de: 'Englisch (USA)' },
  en_au: { en: 'English (Australia)', de: 'Englisch (Australien)' },
  es: { en: 'Spanish (Spain)', de: 'Spanisch (Spanien)' },
  es_latam: { en: 'Spanish (Latin America)', de: 'Spanisch (Lateinamerika)' },
  es_mixed: { en: 'Spanish (Mixed)', de: 'Spanisch (Gemischt)' },
  zh: { en: 'Chinese (Simplified)', de: 'Chinesisch (Vereinfacht)' },
  // Historical displayCode key — pre-refactor callers passed 'zh-CN' directly
  // to `getLocalizedLanguageName`. Kept so external consumers/tests don't
  // break.
  'zh-CN': { en: 'Chinese (Simplified)', de: 'Chinesisch (Vereinfacht)' },
  zh_traditional: { en: 'Chinese (Traditional)', de: 'Chinesisch (Traditionell)' },
  yue: { en: 'Cantonese (Simplified)', de: 'Kantonesisch (Vereinfacht)' },
  yue_traditional: { en: 'Cantonese (Traditional)', de: 'Kantonesisch (Traditionell)' },
  ar: { en: 'Arabic (Modern Standard)', de: 'Arabisch (Hocharabisch)' },
  ar_sa: { en: 'Arabic (Saudi)', de: 'Arabisch (Saudisch)' },
  ar_eg: { en: 'Arabic (Egyptian)', de: 'Arabisch (Ägyptisch)' },
  ar_iq: { en: 'Arabic (Iraqi)', de: 'Arabisch (Irakisch)' },
  sw: { en: 'Swahili (Kenya)', de: 'Swahili (Kenia)' },
  sw_tz: { en: 'Swahili (Tanzania)', de: 'Swahili (Tansania)' },
};

function localizedOverride(
  key: string,
  locale: string,
): string | undefined {
  // displayCode lookups arrive with mixed casing (`zh-CN` vs `zh-cn`); we
  // normalize both the override keys and the incoming key for the second
  // pass so casing doesn't matter.
  const overrides =
    NAME_OVERRIDES[key] ??
    Object.entries(NAME_OVERRIDES).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    )?.[1];
  if (!overrides) return undefined;
  const lang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  return overrides[lang] ?? overrides.en;
}

/**
 * Localised language name via Intl.DisplayNames.
 * @param displayCode BCP 47 language tag (e.g. "es-MX", "zh-CN")
 * @param locale      Locale to display the name in (e.g. "en", "de")
 */
export function getLocalizedLanguageName(
  displayCode: string,
  locale: string,
): string {
  // Hard-coded display-code overrides win first — Intl returns "Chinese
  // (China)" for zh-CN, but we want script-based naming.
  const override = localizedOverride(displayCode, locale);
  if (override) return override;
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
    return displayNames.of(displayCode) || displayCode;
  } catch (error) {
    console.warn(
      `Failed to get localized name for language "${displayCode}" in locale "${locale}":`,
      error,
    );
    return displayCode;
  }
}

/** Same as `getLocalizedLanguageName` but takes our internal code. */
export function getLocalizedLanguageNameByCode(
  code: string,
  locale: string,
): string {
  const override = localizedOverride(code, locale);
  if (override) return override;
  const language = getLanguageByCode(code);
  if (!language) return code;
  return getLocalizedLanguageName(language.displayCode, locale);
}

/**
 * Languages whose script requires romanization (Latin transliteration).
 * Usable in both frontend and Convex backend.
 */
/**
 * Languages with WORKING romanization right now. Membership gates both the
 * frontend display flag and the convex worker's `romanizeText` calls.
 *
 * Coverage matrix:
 *  - Local libraries (sync, no network): zh, zh_traditional, el, ko, he,
 *    yue, yue_traditional.
 *  - Google v3 romanizeText API: ru, hi, ja, ar (and the Arabic dialects via
 *    GOOGLE_TRANSLATE_CODE_MAP collapsing to "ar"). Google's officially
 *    supported source-language set is small: am/ar/be/bn/gu/hi/ja/kn/my/ru/
 *    sr/ta/te/uk — anything outside that list 400s with "Source language is
 *    unsupported."
 *  - NOT currently supported (no local lib AND no Google v3): th. The
 *    `Language.needsRomanization` flag is also `false` on that entry so the
 *    UI doesn't render a romanization slot for it. To enable, wire a
 *    pure-JS Thai romanizer into `convex/lib/localRomanization.ts` (no
 *    learner-grade option exists yet at the time of this change).
 */
export const ROMANIZATION_LANGUAGES = new Set([
  'ru', 'hi', 'bn', 'ja', 'ko',
  'zh', 'zh_traditional',
  'yue', 'yue_traditional',
  'el', 'he',
  'ar', 'ar_sa', 'ar_eg', 'ar_iq',
]);

export function languageNeedsRomanization(code: string): boolean {
  return ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Whether per-word karaoke highlighting is enabled for the given language.
 * Karaoke requires word timings, so any language without STT support gets
 * `false` regardless of its declared `supportsKaraoke` — the field is a UX
 * preference that's only meaningful when timings exist.
 *
 * Defaults to true for unknown codes (so new languages get karaoke unless
 * explicitly opted out), but still gated by `languageSupportsStt`.
 */
export function languageSupportsKaraoke(code: string): boolean {
  if (!languageSupportsStt(code)) return false;
  return getLanguageByCode(code)?.supportsKaraoke ?? true;
}

/**
 * Whether our STT backend can transcribe audio in this language. Single
 * source of truth gating both TTS validation roundtrips and per-word
 * timings. Defaults to false for unknown codes — Azure Fast Transcription
 * rejects unsupported locales with a 400, so not-trying is the safe default.
 */
export function languageSupportsStt(code: string): boolean {
  return getLanguageByCode(code)?.supportsStt ?? false;
}

/**
 * Variant suffixes recognised by `normalizeLanguageCode`. Add new ones here
 * whenever a new dialect variant is added to `SUPPORTED_LANGUAGES` — stats and
 * the variants-collapsing UI rely on this list. Kept as a single union so a
 * code like "ar_iq" collapses to "ar" rather than passing through.
 */
const VARIANT_SUFFIX_RE = /_(latam|mixed|traditional|gb|us|au|sa|eg|iq|tz)$/;

/**
 * Mixed-dialect language codes whose translations span multiple regional
 * sub-variants. For each one, the translation worker resolves a concrete
 * sub-variant per sentence (deterministically seeded by `textId`) and stores
 * both the prose and the picked `regionVariant` on the translations row.
 *
 * Each entry's `variants` array is consumed in order — `resolveMixedVariant`
 * does a deterministic 0..variants.length-1 hash mod, so a coin-flip needs
 * exactly two variants. Voice locale prefixes match the apiCode prefix that
 * `getVoiceForLanguageVariant` filters on.
 */
const MIXED_LANGUAGE_VARIANTS: Record<
  string,
  ReadonlyArray<{
    subCode: string;
    voiceLocalePrefix: string;
  }>
> = {
  es_mixed: [
    { subCode: 'es', voiceLocalePrefix: 'es-ES' },
    { subCode: 'es_latam', voiceLocalePrefix: 'es-US' },
  ],
};

export function isMixedLanguage(code: string): boolean {
  return code in MIXED_LANGUAGE_VARIANTS;
}

/**
 * Deterministic FNV-1a hash for short strings. Used to seed the per-text
 * variant pick for mixed-dialect languages — re-running translation for the
 * same textId always lands on the same variant, so the persisted
 * `regionVariant` and the synthesized voice stay in agreement across retries.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Resolve the concrete regional sub-variant for a mixed-dialect language.
 * Returns `null` when `code` is not a mixed language — callers should fall
 * back to the non-mixed translation path in that case.
 *
 * `seed` should be the textId (or any stable per-sentence identifier) so the
 * choice survives retries and re-translations. The returned `subCode` is the
 * language code to feed `getTranslationConfigForLanguage` (so the LLM gets
 * regionally accurate prompt context), and `regionVariant` is the locale
 * prefix the audio player needs to pick a matching voice.
 */
export function resolveMixedVariant(
  code: string,
  seed: string,
): { subCode: string; regionVariant: string } | null {
  const variants = MIXED_LANGUAGE_VARIANTS[code];
  if (!variants) return null;
  const idx = fnv1a(seed) % variants.length;
  const pick = variants[idx];
  return { subCode: pick.subCode, regionVariant: pick.voiceLocalePrefix };
}

/**
 * Normalize a language code by stripping regional variant suffixes (e.g.
 * `"es_latam"` → `"es"`, `"ar_iq"` → `"ar"`). Single source of truth for
 * variant collapsing across stats, search, and UI.
 */
export function normalizeLanguageCode(code: string): string {
  return code.replace(VARIANT_SUFFIX_RE, '');
}

// ---------------------------------------------------------------------------
// Voice helpers — re-exported from lib/voices.ts for backward compat.
// New code should import these directly from `lib/voices`.
// ---------------------------------------------------------------------------

export type { Voice } from './voices';
export {
  VOICE_POOLS,
  getVoicesByLanguageCode,
  getAllVoicesByLanguageCode,
  getRandomVoiceForLanguage,
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  getVoiceGenderByApiCode,
  getProviderByApiCode,
  getLocaleFromApiCode,
  getLocalesByLanguageCode,
  resolveAudioSpeakerGender,
} from './voices';
