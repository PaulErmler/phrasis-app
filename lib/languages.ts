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

/**
 * Identifier for which TTS backend a language currently uses. Must stay in sync
 * with `ttsProviderValidator` in `convex/types.ts` (the Convex-side source of
 * truth used for stored `audioRecordings.ttsProvider`). 'gemini' = Gemini 3.1
 * Flash TTS via OpenRouter (distinct from 'google' = Google Cloud Chirp3).
 *
 * 'elevenlabs' is a retired provider kept only as a tombstone so historical
 * stored `ttsProvider` values still validate — no language routes to it and it
 * is no longer dispatchable (see convex/lib/tts/index.ts). Do not remove it
 * from this array without first migrating any stored rows that use it.
 */
export const TTS_PROVIDERS = ['google', 'elevenlabs', 'azure', 'gemini'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

/** Identifier for which translation backend a target language currently uses. */
export type TranslationProvider = 'google' | 'openrouter';

/**
 * BCP-47-ish region label used in the LLM translation prompt's <context>.
 * Tells the model whether to lean Spanish-Spain vs Spanish-LatAm,
 * Portuguese-Brazil vs Portuguese-Portugal, etc.
 *
 * Derived from each Language's `regionLabel` field (keyed by displayCode; see
 * `DISPLAY_CODE_TO_REGION` below). Falls back to the region segment of the
 * displayCode, or the bare tag when there's no dash — so a language without an
 * explicit `regionLabel` (e.g. `en`) renders its code rather than a blank.
 */
function regionLabelFromDisplayCode(displayCode: string): string {
  const mapped = DISPLAY_CODE_TO_REGION[displayCode];
  if (mapped) return mapped;
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
  /**
   * Override for the language name that appears in the LLM translation
   * prompt's "English-to-X" line. Falls back to `name` when unset.
   *
   * Used today only for Hebrew (`'Modern Hebrew'`) — the bare "Hebrew" label
   * is ambiguous between Modern and Biblical Hebrew, so the prompt pins the
   * register explicitly. The UI continues to use `name` ("Hebrew") because
   * "Modern" is implicit in a contemporary language-learning context.
   */
  translationName?: string;
  /**
   * Override for the language name used in the Gemini TTS prompt's "speak like
   * a native X" instruction (convex/lib/tts/gemini.ts). Defaults to `name` with
   * the region parenthetical stripped ("English (US)" → "English"), since the
   * accent is normally pinned by `geminiBcp47`. Set this when the dialect can't
   * be pinned by the locale and must be named in the prose instead — e.g.
   * Levantine Arabic, whose `geminiBcp47` collapses to `ar-001` (World Arabic),
   * shared with MSA/Saudi/Iraqi.
   */
  ttsPromptName?: string;
  /**
   * Translation-method version (defaults to 1 via `getCurrentTranslationVersion`).
   * Bump when changing the model/prompt for this language to lazily regenerate
   * its existing non-custom translations (and their audio) on next view. See the
   * content-versioning helpers below and `translations.translationVersion` in
   * convex/schema.ts.
   */
  translationVersion?: number;
  /**
   * TTS-setup version (defaults to 1 via `getCurrentTtsVersion`). Bump when
   * changing this language's voice pool, Gemini `ttsPromptName`, or provider so
   * existing audio regenerates lazily — needed for prompt-only changes on an
   * already-Gemini language where the provider-mismatch regen wouldn't fire
   * (e.g. pt_pt). See `audioRecordings.ttsVersion` in convex/schema.ts.
   */
  ttsVersion?: number;
  /**
   * When `true`, this language is excluded from user-facing pickers in
   * onboarding / course creation / settings (`LanguageSelector` and
   * `DualLanguageEditor`). The entry remains in `SUPPORTED_LANGUAGES` so
   * voice lookups, `getLanguageByCode`, and existing course data referring
   * to the code keep working — only the *picker* surfaces hide it.
   *
   * Used today to retire the English sub-variants (`en_gb`, `en_us`,
   * `en_au`) from course-creation UIs while their voice + display metadata
   * stays available for any rows already referencing them.
   */
  hiddenFromPicker?: boolean;

  // --- Provider locale codes + display overrides --------------------------
  // Single source of truth for the per-language data that used to live in
  // separate maps (REGION_MAP, toGeminiBcp47, toAzureSttLocale,
  // GOOGLE_TRANSLATE_CODE_MAP, textCompare PER_LANGUAGE, NAME_OVERRIDES,
  // MIXED_LANGUAGE_VARIANTS, LOCAL_ROMANIZATION_LANGUAGES). Each derived map is
  // built from these fields; omit a field to take its documented default.

  /**
   * Region label injected into the LLM translation prompt's <context> (e.g.
   * 'Spain', 'the Arab world'). Omit to fall back to the region segment of
   * `displayCode` (or the bare code when there's no dash).
   */
  regionLabel?: string;
  /**
   * BCP-47 locale for Gemini TTS (`toGeminiBcp47`). Omit when Gemini should
   * auto-detect from the text (Cantonese) — the code passes through unchanged.
   */
  geminiBcp47?: string;
  /**
   * Locale for Azure Fast Transcription (`toAzureSttLocale`). Omit to take the
   * `<code>-<UPPER(code)>` default (correct for symmetric ISO-639-1 pairs).
   */
  azureSttLocale?: string;
  /**
   * Google Translate v2 / romanize-v3 code (`toGoogleTranslateCode`). Omit to
   * pass the internal code through unchanged.
   */
  googleTranslateCode?: string;
  /**
   * Intl.Segmenter locale for answer text-comparison (`getCompareConfig`).
   * Omit to default to the internal code.
   */
  compareLocale?: string;
  /**
   * Whether the script uses spaces between words. Omit (= true) for everything
   * except scripts segmented per character/morpheme (zh/ja/th/yue), where the
   * comparator falls back to char-level diffing.
   */
  hasWordBoundaries?: boolean;
  /**
   * How this language romanizes when `needsRomanization` is true: 'local'
   * (in-process library, see convex/lib/localRomanization.ts) or 'google-v3'
   * (Google Cloud romanizeText). Omit when the language needs no romanization.
   */
  romanizationBackend?: 'local' | 'google-v3';
  /**
   * Locale-keyed display-name overrides (e.g. { en: 'Spanish (Spain)' }) for
   * codes where Intl.DisplayNames is ambiguous. Resolution falls back to the
   * `en` value, then Intl. The `displayCode` is also registered as a lookup key.
   */
  displayNameOverrides?: Record<string, string>;
  /**
   * Mixed-dialect expansion: each entry is a concrete sub-variant the
   * translation worker resolves deterministically per text. Presence marks the
   * language as mixed (`isMixedLanguage`).
   */
  variants?: ReadonlyArray<{ subCode: string; voiceLocalePrefix: string }>;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: 'en',
    displayCode: 'en',
    geminiBcp47: 'en-US',
    azureSttLocale: 'en-US',
    name: 'English',
    nativeName: 'English',
    flag: '🌎',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'en_gb',
    displayCode: 'en-GB',
    regionLabel: 'United Kingdom',
    geminiBcp47: 'en-GB',
    azureSttLocale: 'en-GB',
    googleTranslateCode: 'en',
    compareLocale: 'en-GB',
    displayNameOverrides: { en: 'English (UK)', de: 'Englisch (UK)' },
    name: 'English (UK)',
    nativeName: 'English (UK)',
    flag: '🇬🇧',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // Pin the accent in the prompt too — `geminiBcp47: 'en-GB'` alone can drift
    // toward Gemini's default American English. ttsVersion bump regenerates
    // existing en_gb audio (prompt-only change on an already-Gemini language).
    ttsPromptName: 'British English',
    ttsVersion: 2,
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
    hiddenFromPicker: true,
  },
  {
    code: 'en_us',
    displayCode: 'en-US',
    regionLabel: 'United States',
    geminiBcp47: 'en-US',
    azureSttLocale: 'en-US',
    googleTranslateCode: 'en',
    compareLocale: 'en-US',
    displayNameOverrides: { en: 'English (US)', de: 'Englisch (USA)' },
    name: 'English (US)',
    nativeName: 'English (US)',
    flag: '🇺🇸',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
    hiddenFromPicker: true,
  },
  {
    code: 'en_au',
    displayCode: 'en-AU',
    regionLabel: 'Australia',
    geminiBcp47: 'en-AU',
    azureSttLocale: 'en-AU',
    googleTranslateCode: 'en',
    compareLocale: 'en-AU',
    displayNameOverrides: { en: 'English (Australia)', de: 'Englisch (Australien)' },
    name: 'English (Australia)',
    nativeName: 'English (Australia)',
    flag: '🇦🇺',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // Pin the accent in the prompt too — `geminiBcp47: 'en-AU'` alone can drift
    // toward Gemini's default American English. ttsVersion bump regenerates
    // existing en_au audio (prompt-only change on an already-Gemini language).
    ttsPromptName: 'Australian English',
    ttsVersion: 2,
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
    hiddenFromPicker: true,
  },
  {
    code: 'es',
    displayCode: 'es-ES',
    regionLabel: 'Spain',
    geminiBcp47: 'es-ES',
    azureSttLocale: 'es-ES',
    displayNameOverrides: { en: 'Spanish (Spain)', de: 'Spanisch (Spanien)' },
    name: 'Spanish (Spain)',
    nativeName: 'Español (España)',
    flag: '🇪🇸',
    category: 'romance',
    llmSupportTier: 'tier1',
    // Runs on Gemini TTS (`geminiBcp47: 'es-ES'`), with the Castilian accent
    // named in the prompt so it doesn't drift toward Latin American Spanish.
    ttsProvider: 'gemini',
    ttsPromptName: 'Castilian Spanish',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'es_latam',
    displayCode: 'es-419',
    regionLabel: 'Latin America',
    // Gemini TTS locale: `es-US` is Gemini's American-Spanish locale (it has no
    // `es-419` macro locale); the Latin American accent is reinforced in the
    // prompt. This mirrors the `es-US` voiceLocalePrefix `es_mixed` already uses
    // for the es_latam sub-variant.
    geminiBcp47: 'es-US',
    azureSttLocale: 'es-MX',
    googleTranslateCode: 'es',
    compareLocale: 'es-419',
    displayNameOverrides: { en: 'Spanish (Latin America)', de: 'Spanisch (Lateinamerika)' },
    name: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
    flag: '🇲🇽',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    ttsPromptName: 'Latin American Spanish',
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
    geminiBcp47: 'es-ES',
    azureSttLocale: 'es-ES',
    googleTranslateCode: 'es',
    compareLocale: 'es',
    displayNameOverrides: { en: 'Spanish (Mixed)', de: 'Spanisch (Gemischt)' },
    variants: [
      { subCode: 'es', voiceLocalePrefix: 'es-ES' },
      { subCode: 'es_latam', voiceLocalePrefix: 'es-US' },
    ],
    name: 'Spanish (Mixed)',
    nativeName: 'Español (mixto)',
    flag: '🌎',
    category: 'romance',
    llmSupportTier: 'tier1',
    // Runs on Gemini TTS. The per-text accent (Spain vs Latin America) is pinned
    // by the chosen voice's `@es-ES` / `@es-US` locale suffix (see the es_mixed
    // Gemini pool in lib/voices.ts and `getVoiceForLanguageVariant`), so no
    // single `ttsPromptName` applies here — the locale on the voice carries it.
    ttsProvider: 'gemini',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'fr',
    displayCode: 'fr',
    regionLabel: 'France',
    geminiBcp47: 'fr-FR',
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
    regionLabel: 'Germany',
    geminiBcp47: 'de-DE',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'it',
    displayCode: 'it',
    regionLabel: 'Italy',
    geminiBcp47: 'it-IT',
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
    regionLabel: 'Brazil',
    geminiBcp47: 'pt-BR',
    azureSttLocale: 'pt-BR',
    displayNameOverrides: { en: 'Portuguese (Brazil)', de: 'Portugiesisch (Brasilien)' },
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
    code: 'pt_pt',
    displayCode: 'pt-PT',
    regionLabel: 'Portugal',
    geminiBcp47: 'pt-PT',
    azureSttLocale: 'pt-PT',
    googleTranslateCode: 'pt-PT',
    compareLocale: 'pt-PT',
    displayNameOverrides: { en: 'Portuguese (Portugal)', de: 'Portugiesisch (Portugal)' },
    name: 'Portuguese (Portugal)',
    nativeName: 'Português (Portugal)',
    flag: '🇵🇹',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // Name the dialect in the Gemini prompt. `geminiBcp47: 'pt-PT'` alone let
    // Gemini drift to Brazilian (reported); "native European Portuguese speaker"
    // pins it. ttsVersion bump regenerates existing pt_pt audio (provider is
    // unchanged, so the provider-mismatch regen path wouldn't fire).
    ttsPromptName: 'European Portuguese',
    ttsVersion: 2,
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ro',
    displayCode: 'ro',
    regionLabel: 'Romania',
    geminiBcp47: 'ro-RO',
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
    regionLabel: 'Russia',
    geminiBcp47: 'ru-RU',
    romanizationBackend: 'google-v3',
    name: 'Russian',
    nativeName: 'Русский',
    flag: '🇷🇺',
    category: 'slavic',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    // Cyrillic — karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'pl',
    displayCode: 'pl',
    regionLabel: 'Poland',
    geminiBcp47: 'pl-PL',
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
    regionLabel: 'Slovakia',
    geminiBcp47: 'sk-SK',
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
    regionLabel: 'Czechia',
    geminiBcp47: 'cs-CZ',
    azureSttLocale: 'cs-CZ',
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
    regionLabel: 'Netherlands',
    geminiBcp47: 'nl-NL',
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
    regionLabel: 'Sweden',
    geminiBcp47: 'sv-SE',
    azureSttLocale: 'sv-SE',
    name: 'Swedish',
    nativeName: 'Svenska',
    flag: '🇸🇪',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  // Norwegian (Bokmål) — disabled for now. The provider-locale fields the derived
  // maps need (regionLabel, azureSttLocale `nb-NO`, googleTranslateCode `no`) are
  // baked into the commented record below, and the voice pool / textCompare entry
  // are still in place, so re-enabling is just uncommenting this block.
  // {
  //   code: 'nb',
  //   displayCode: 'nb',
  //   regionLabel: 'Norway',
  //   azureSttLocale: 'nb-NO',
  //   googleTranslateCode: 'no',
  //   name: 'Norwegian (Bokmål)',
  //   nativeName: 'Norsk bokmål',
  //   flag: '🇳🇴',
  //   category: 'germanic',
  //   llmSupportTier: 'tier2',
  //   ttsProvider: 'google',
  //   needsRomanization: false,
  //   supportsKaraoke: true,
  //   supportsStt: true,
  // },
  {
    code: 'da',
    displayCode: 'da',
    regionLabel: 'Denmark',
    geminiBcp47: 'da-DK',
    azureSttLocale: 'da-DK',
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
    regionLabel: 'Finland',
    geminiBcp47: 'fi-FI',
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
    regionLabel: 'Greece',
    geminiBcp47: 'el-GR',
    azureSttLocale: 'el-GR',
    romanizationBackend: 'local',
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
    regionLabel: 'India',
    geminiBcp47: 'hi-IN',
    azureSttLocale: 'hi-IN',
    romanizationBackend: 'google-v3',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    category: 'other',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    // Devanagari — karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'bn',
    displayCode: 'bn',
    regionLabel: 'Bangladesh',
    geminiBcp47: 'bn-BD',
    azureSttLocale: 'bn-IN',
    romanizationBackend: 'google-v3',
    name: 'Bengali',
    nativeName: 'বাংলা',
    // Flag is India, not Bangladesh: voice + STT infra is bn-IN (Google
    // Chirp3-HD and Azure Fast Transcription only support bn-IN, not bn-BD).
    flag: '🇮🇳',
    category: 'other',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    needsRomanization: true,
    // Bengali script — karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'tr',
    displayCode: 'tr',
    regionLabel: 'Turkey',
    geminiBcp47: 'tr-TR',
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
    regionLabel: 'Hungary',
    geminiBcp47: 'hu-HU',
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
    regionLabel: 'Mainland China',
    geminiBcp47: 'cmn-CN',
    azureSttLocale: 'zh-CN',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Chinese (Simplified)', de: 'Chinesisch (Vereinfacht)' },
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
    regionLabel: 'Taiwan',
    geminiBcp47: 'cmn-TW',
    azureSttLocale: 'zh-TW',
    googleTranslateCode: 'zh-TW',
    compareLocale: 'zh-TW',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Chinese (Traditional)', de: 'Chinesisch (Traditionell)' },
    name: 'Chinese (Traditional)',
    nativeName: '中文（繁體）',
    flag: '🇹🇼',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    // Google has no Chirp3-HD voices for cmn-TW (only legacy Standard/WaveNet),
    // so we use Azure Neural for Mandarin-Traditional courses.
    ttsProvider: 'azure',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'yue',
    displayCode: 'yue-Hans-HK',
    regionLabel: 'Hong Kong (simplified script)',
    azureSttLocale: 'zh-HK',
    compareLocale: 'yue-Hans-HK',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Cantonese (Simplified)', de: 'Kantonesisch (Vereinfacht)' },
    name: 'Cantonese (Simplified)',
    nativeName: '粵語（简体）',
    flag: '🇭🇰',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    // Romanization disabled — the cantonese-romanisation (LSHK / Jyutping)
    // lookup table is traditional-script oriented, so simplified Cantonese
    // surfaces too many gaps to ship reliably. Traditional Cantonese
    // (`yue_traditional`) keeps romanization on.
    needsRomanization: false,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'yue_traditional',
    displayCode: 'yue-Hant-HK',
    regionLabel: 'Hong Kong (traditional script)',
    azureSttLocale: 'zh-HK',
    googleTranslateCode: 'yue',
    compareLocale: 'yue-Hant-HK',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Cantonese (Traditional)', de: 'Kantonesisch (Traditionell)' },
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
    regionLabel: 'Japan',
    geminiBcp47: 'ja-JP',
    azureSttLocale: 'ja-JP',
    hasWordBoundaries: false,
    romanizationBackend: 'google-v3',
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
    regionLabel: 'South Korea',
    geminiBcp47: 'ko-KR',
    azureSttLocale: 'ko-KR',
    romanizationBackend: 'local',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'google',
    needsRomanization: true,
    // Hangul — karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'vi',
    displayCode: 'vi',
    regionLabel: 'Vietnam',
    geminiBcp47: 'vi-VN',
    azureSttLocale: 'vi-VN',
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
    regionLabel: 'Thailand',
    geminiBcp47: 'th-TH',
    hasWordBoundaries: false,
    name: 'Thai',
    nativeName: 'ไทย',
    flag: '🇹🇭',
    category: 'asian-southeast',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
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
    regionLabel: 'Indonesia',
    geminiBcp47: 'id-ID',
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
    code: 'fil',
    displayCode: 'fil',
    regionLabel: 'the Philippines',
    geminiBcp47: 'fil-PH',
    azureSttLocale: 'fil-PH',
    // Google Translate v2 (the legacy fallback path) catalogs Filipino under
    // the Tagalog code `tl`; `fil` isn't in /v2/languages.
    googleTranslateCode: 'tl',
    name: 'Filipino',
    nativeName: 'Filipino',
    flag: '🇵🇭',
    category: 'asian-southeast',
    llmSupportTier: 'tier1',
    // Gemini 3 Flash TTS (fil-PH, Preview). See VOICE_POOLS in lib/voices.ts
    // (`fil: [...GEMINI_CORE, ...AZURE_VOICES_FIL_PH]`). Latin script, so no
    // romanization; Azure fil-PH supports Fast Transcription, so STT + karaoke
    // stay on.
    ttsProvider: 'gemini',
    needsRomanization: false,
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'ar',
    displayCode: 'ar',
    regionLabel: 'the Arab world',
    geminiBcp47: 'ar-001',
    azureSttLocale: 'ar-SA',
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Arabic (Modern Standard)', de: 'Arabisch (Hocharabisch)' },
    name: 'Arabic (Modern Standard)',
    nativeName: 'العربية (الفصحى)',
    flag: '🌎',
    category: 'semitic',
    llmSupportTier: 'tier1',
    // Runs on Gemini global Arabic (`geminiBcp47: 'ar-001'`); the dialect is
    // conveyed in the prompt via `ttsPromptName`. Switching off Google triggers
    // the provider-mismatch regen (lib/ttsPrecedence.ts) for existing audio.
    ttsProvider: 'gemini',
    ttsPromptName: 'Modern Standard Arabic',
    needsRomanization: true,
    // Karaoke disabled for Arabic: ligatures + clitics don't align to STT
    // word timings, producing flickery/mis-positioned per-word highlights.
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'ar_sa',
    displayCode: 'ar-SA',
    regionLabel: 'Saudi Arabia',
    geminiBcp47: 'ar-001',
    azureSttLocale: 'ar-SA',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-SA',
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Arabic (Saudi)', de: 'Arabisch (Saudisch)' },
    name: 'Arabic (Saudi)',
    nativeName: 'العربية (السعودية)',
    flag: '🇸🇦',
    category: 'semitic',
    llmSupportTier: 'tier2',
    // Runs on Gemini global Arabic (`ar-001`); Saudi dialect named in the prompt.
    ttsProvider: 'gemini',
    ttsPromptName: 'Saudi Arabic',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'ar_eg',
    displayCode: 'ar-EG',
    regionLabel: 'Egypt',
    geminiBcp47: 'ar-EG',
    azureSttLocale: 'ar-EG',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-EG',
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Arabic (Egyptian)', de: 'Arabisch (Ägyptisch)' },
    name: 'Arabic (Egyptian)',
    nativeName: 'العربية (المصرية)',
    flag: '🇪🇬',
    category: 'semitic',
    llmSupportTier: 'tier2',
    // Egyptian uses Gemini's dedicated Egyptian locale (`geminiBcp47: 'ar-EG'`)
    // plus an explicit prompt. Switching off Azure triggers the provider-mismatch
    // regen (gemini overrides azure) for existing audio.
    ttsProvider: 'gemini',
    ttsPromptName: 'Egyptian Arabic',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'ar_iq',
    displayCode: 'ar-IQ',
    regionLabel: 'Iraq',
    geminiBcp47: 'ar-001',
    azureSttLocale: 'ar-IQ',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-IQ',
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Arabic (Iraqi)', de: 'Arabisch (Irakisch)' },
    name: 'Arabic (Iraqi)',
    nativeName: 'العربية (العراقية)',
    flag: '🇮🇶',
    category: 'semitic',
    llmSupportTier: 'tier2',
    // Runs on Gemini global Arabic (`ar-001`); Iraqi dialect named in the prompt.
    ttsProvider: 'gemini',
    ttsPromptName: 'Iraqi Arabic',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'ar_lev',
    displayCode: 'ar-LB',
    regionLabel: 'the Levant (Lebanon, Syria, Palestine, Jordan)',
    geminiBcp47: 'ar-001',
    azureSttLocale: 'ar-LB',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-LB',
    romanizationBackend: 'local',
    displayNameOverrides: { en: 'Arabic (Levantine)', de: 'Arabisch (Levantinisch)' },
    name: 'Arabic (Levantine)',
    nativeName: 'العربية (الشامية)',
    flag: '🇱🇧',
    category: 'semitic',
    llmSupportTier: 'tier2',
    // Runs on Gemini TTS. Gemini has no Levantine locale (it collapses to
    // `ar-001` World Arabic, shared with MSA/Saudi/Iraqi), so the voice is the
    // shared/global Arabic Gemini voice and the dialect is named in the prompt
    // via `ttsPromptName`. See lib/voices.ts (`ar_lev: [...GEMINI_CORE, ...]`).
    ttsProvider: 'gemini',
    ttsPromptName: 'Levantine Arabic',
    needsRomanization: true,
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'he',
    displayCode: 'he',
    regionLabel: 'Israel',
    geminiBcp47: 'he-IL',
    azureSttLocale: 'he-IL',
    romanizationBackend: 'local',
    name: 'Hebrew',
    nativeName: 'עברית',
    flag: '🌎',
    category: 'semitic',
    llmSupportTier: 'tier2',
    ttsProvider: 'google',
    // Romanization via the `hebrew-transliteration` package (SBL Academic
    // style), wired in convex/lib/localRomanization.ts.
    needsRomanization: true,
    // Hebrew script — karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    // Disambiguates from Biblical Hebrew in the translation prompt.
    translationName: 'Modern Hebrew',
  },
  {
    code: 'fa',
    displayCode: 'fa',
    regionLabel: 'Iran',
    geminiBcp47: 'fa-IR',
    azureSttLocale: 'fa-IR',
    name: 'Persian',
    nativeName: 'فارسی',
    flag: '🇮🇷',
    category: 'other',
    llmSupportTier: 'tier1',
    // Gemini 3 Flash TTS (via OpenRouter); fa-IR is a documented Gemini TTS
    // locale. See VOICE_POOLS in lib/voices.ts (`fa: [...GEMINI_CORE]`).
    ttsProvider: 'gemini',
    // Perso-Arabic script — romanized locally via `@sindresorhus/transliterate`
    // (handles the Persian-specific letters پ/چ/ژ/گ that the Arabic library
    // mangles). Note it's a consonant-skeleton transliteration: Persian script
    // omits short vowels, so they're absent from the output (سلام → "slam").
    // Wired in convex/lib/localRomanization.ts. Google v3 isn't an option here
    // (its romanizeText 400s on `fa`).
    needsRomanization: true,
    romanizationBackend: 'local',
    // Non-Latin script — karaoke highlighting off (matches Arabic/Hebrew).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'sw',
    displayCode: 'sw-KE',
    regionLabel: 'Kenya',
    geminiBcp47: 'sw-KE',
    azureSttLocale: 'sw-KE',
    compareLocale: 'sw-KE',
    displayNameOverrides: { en: 'Swahili (Kenya)', de: 'Swahili (Kenia)' },
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
    regionLabel: 'Tanzania',
    geminiBcp47: 'sw-KE',
    azureSttLocale: 'sw-TZ',
    googleTranslateCode: 'sw',
    compareLocale: 'sw-TZ',
    displayNameOverrides: { en: 'Swahili (Tanzania)', de: 'Swahili (Tansania)' },
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

// displayCode → region label, derived from each Language's `regionLabel` field.
// Consumed by `regionLabelFromDisplayCode` above. Languages without a
// `regionLabel` (en, es_mixed) are absent here and fall through to the
// dash-split default.
const DISPLAY_CODE_TO_REGION: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.filter((l) => l.regionLabel).map((l) => [
    l.displayCode,
    l.regionLabel as string,
  ]),
);

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
// Content versioning — per-language method/setup versions.
//
// Each version defaults to 1. Bumping a language's `translationVersion` (a new
// model/prompt) or `ttsVersion` (a new voice pool / Gemini prompt / provider)
// in SUPPORTED_LANGUAGES makes `scheduleMissingContent` treat already-stored
// rows whose stamped version is strictly LOWER than the current value as stale
// and regenerate them lazily on next view. The stamp is "undefined === current"
// at the comparison sites (only a number strictly < current is stale), so rows
// written before the field existed never mass-regenerate — the one-time
// `backfillContentVersions` migration stamps them explicitly. See convex/schema.ts.
// ---------------------------------------------------------------------------

/** Baseline version for both translation and TTS when a Language omits it. */
export const DEFAULT_CONTENT_VERSION = 1;

/** Current translation-method version for a language (1 when unset). */
export function getCurrentTranslationVersion(code: string): number {
  return getLanguageByCode(code)?.translationVersion ?? DEFAULT_CONTENT_VERSION;
}

/** Current TTS-setup version for a language (1 when unset). */
export function getCurrentTtsVersion(code: string): number {
  return getLanguageByCode(code)?.ttsVersion ?? DEFAULT_CONTENT_VERSION;
}

/**
 * Whether a stored content row is STALE versus the current config version, and
 * should be regenerated. The single source of truth for the comparison so the
 * translation and TTS regen sweeps can't drift apart.
 *
 * Treats `undefined` (a row written before the version field existed, or never
 * backfilled) as "current/unknown — NOT stale". Only a concrete number strictly
 * below `current` is stale. This is what prevents a database-wide regeneration
 * storm the first time a card is viewed after the feature ships — the deciding
 * detail of the whole versioning system.
 */
export function isContentVersionStale(
  stamped: number | undefined,
  current: number,
): boolean {
  return stamped !== undefined && stamped < current;
}

/** True iff this language's stored audio at `stampedVersion` is below the
 * current `ttsVersion` config and should be re-synthesized. */
export function isTtsVersionStale(
  code: string,
  stampedVersion: number | undefined,
): boolean {
  return isContentVersionStale(stampedVersion, getCurrentTtsVersion(code));
}

/** True iff this language's stored translation at `stampedVersion` is below the
 * current `translationVersion` config and should be re-translated. */
export function isTranslationVersionStale(
  code: string,
  stampedVersion: number | undefined,
): boolean {
  return isContentVersionStale(stampedVersion, getCurrentTranslationVersion(code));
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
  /** OpenRouter slug, e.g. `'google/gemini-3.1-flash-lite'`. */
  model: string;
  /**
   * Reasoning / thinking effort. `undefined` = no thinking. `'minimal'` is
   * Gemini-3-specific — OpenRouter maps it to Google's `thinkingLevel:
   * 'minimal'`, strictly below `'low'`. The `@openrouter/ai-sdk-provider`
   * types only enumerate `'low' | 'medium' | 'high'`; the cast lives in
   * `translateTextWithLLM`.
   */
  reasoning?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Per-stage cap on response tokens. Tuned so reasoning-heavy stages have
   * the headroom their thinking traces need (DeepSeek V4 Flash with `high`
   * effort can consume 3–6K tokens of thinking before any visible output)
   * while no-reasoning stages stay tight on cost. `translateTextWithLLM`
   * applies the constant `DEFAULT_MAX_OUTPUT_TOKENS` when this is unset.
   */
  maxOutputTokens?: number;
};

/**
 * Stable identifier for the legacy Google Translate v2 path. Used as the
 * `translationSource` on rows produced by `processTranslationForCard` —
 * the fallback path the LLM queue schedules when every model stage fails.
 */
export const GOOGLE_TRANSLATE_SOURCE = 'google-translate-v2';

/**
 * Stable identifier for translations the user typed manually (no model
 * involved). Used on `createCustomText` insertions when the corresponding
 * entry didn't come from autofill.
 */
export const USER_PROVIDED_TRANSLATION_SOURCE = 'user-provided';

/**
 * Build the `translationSource` string for an LLM translation from the
 * model slug and reasoning level. Persisted on each translation row so a
 * future strategy swap can find + regenerate rows produced by the old
 * method via `translationSource != currentSource`.
 *
 * Format: `<model-slug>-<reasoning|none>`. The bare-`none` suffix keeps
 * the two no-reasoning vs low-reasoning Gemini variants distinct as
 * separate strings, so the character-rule split is reflected in the tag.
 */
export function getTranslationSource(
  model: string,
  reasoning?: 'minimal' | 'low' | 'medium' | 'high',
): string {
  return `${model}-${reasoning ?? 'none'}`;
}

/**
 * Same as `getTranslationSource` but accepts a `ModelStage`. Convenience
 * for the LLM queue worker, which already carries the stage object.
 */
export function getTranslationSourceFromStage(stage: ModelStage): string {
  return getTranslationSource(stage.model, stage.reasoning);
}

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

// Gemini 3 Flash preview with `minimal` reasoning — primary AND fallback
// for `default_hybrid`. Used for the initial LLM translation of premade
// curriculum sentences and placement-test material. `effort: 'minimal'`
// maps to Gemini's `thinkingLevel: 'minimal'` (strictly lower than
// `'low'`) — the cheapest reasoning tier OpenRouter exposes for Gemini 3.
// Used as the fallback too so the worker still gets a real LLM retry on
// transient HTTP errors before dropping to the Google safety net.
const GEMINI_3_FLASH_MINIMAL: ModelStage = {
  model: 'google/gemini-3-flash-preview',
  reasoning: 'minimal',
  maxOutputTokens: 4_000,
};
// Gemini 3.1 Flash Lite with `minimal` reasoning — primary for
// `retranslation_custom` (flagged retranslations of user-created texts).
// Kept on the cheaper Flash Lite tier (vs. Pro Medium for curriculum) on
// the assumption that custom texts are mostly the user's own content where
// a heavyweight cross-model second opinion adds less value than on curated
// material. Minimal thinking still gives the retranslation a brief shot at
// catching what the user flagged.
const GEMINI_FLASH_LITE_MINIMAL: ModelStage = {
  model: 'google/gemini-3.1-flash-lite',
  reasoning: 'minimal',
  maxOutputTokens: 4_000,
};
// Gemini 3.1 Pro with medium reasoning — primary for `retranslation_high`
// (first-flag retranslations of curriculum / premade-dataset texts). A
// heavier *different* model than the default Flash tier so a flagged row
// gets a genuine cross-model second opinion. Medium reasoning is the
// sweet spot between cost and Pro's larger base capacity; 8k output
// tokens leaves comfortable headroom for the reasoning trace before
// truncation forces a Google fallback.
const GEMINI_PRO_MEDIUM: ModelStage = {
  model: 'google/gemini-3.1-pro-preview',
  reasoning: 'medium',
  maxOutputTokens: 8_000,
};

/**
 * Maximum number of auto-retranslations triggered by user flags on a single
 * translation row. The first flag enqueues a retranslation via
 * `retranslation_high` / `retranslation_custom`; the second flag (and
 * beyond) only increments `flagCount` for admin triage — at that point the
 * row has already had its one shot at automatic recovery, so further
 * complaints surface as "Flagged" rather than retriggering the pipeline.
 * Surfaced here (rather than inline in `flagTranslation`) so the card
 * queries can also use it to decide between the "Retranslating" pill
 * (under-cap, in flight) and the "Flagged" pill (over-cap, no
 * auto-retranslation will happen).
 */
export const FLAG_AUTO_RETRANSLATION_MAX = 1;

export const TRANSLATION_RULES = {
  /**
   * Default for every language without an explicit `translationRule`. Used
   * for the initial LLM translation of premade curriculum sentences and
   * placement-test material. Single branch — length-hybrid branching was
   * retired so the model + reasoning level is identical regardless of
   * input length. One LLM fallback (cheap no-thinking Flash Lite) before
   * the Google safety net catches truncation / HTTP errors without forcing
   * an immediate drop to Google.
   */
  default_hybrid: {
    id: 'default_hybrid',
    label: 'Gemini 3 Flash (minimal) → Gemini 3 Flash (minimal, retry) → Google',
    branches: [
      {
        maxChars: Infinity,
        primary: GEMINI_3_FLASH_MINIMAL,
        // Same model + reasoning + cap as the primary — the fallback
        // exists only to retry once on transient HTTP errors before the
        // Google safety net kicks in. Truncation is rare at this thinking
        // level / token cap, so retrying the same config is cheap insurance.
        fallbacks: [GEMINI_3_FLASH_MINIMAL],
      },
    ],
  },
  /**
   * Triggered by `flagTranslation` for flagged retranslations of CURRICULUM
   * (premade-dataset) texts, on flag counts 1 through
   * `FLAG_AUTO_RETRANSLATION_MAX`. Routes through Gemini 3.1 Pro with
   * medium reasoning — a different (heavier) model than the default Flash
   * tier, so a flagged curriculum row genuinely gets a cross-model second
   * opinion. The worker also threads the previously-flagged translation
   * into the prompt as `<previous_translation>` context. Custom (user-
   * created) texts use `retranslation_custom` instead.
   */
  retranslation_high: {
    id: 'retranslation_high',
    label: 'Gemini 3.1 Pro (medium) — flagged curriculum retranslation',
    branches: [
      { maxChars: Infinity, primary: GEMINI_PRO_MEDIUM },
    ],
  },
  /**
   * Triggered by `flagTranslation` for flagged retranslations of CUSTOM
   * (user-created) texts. Routes through Gemini 3.1 Flash Lite with
   * `minimal` reasoning — kept on the cheaper Lite tier (vs. Pro Medium
   * for curriculum) on the assumption that custom texts are mostly the
   * user's own content where a heavyweight cross-model second opinion
   * adds less value than on curated material. Worker behavior
   * (previous-translation prompt block, `replaceExisting` write semantics)
   * matches `retranslation_high`.
   */
  retranslation_custom: {
    id: 'retranslation_custom',
    label: 'Gemini 3.1 Flash Lite (minimal) — flagged custom retranslation',
    branches: [
      { maxChars: Infinity, primary: GEMINI_FLASH_LITE_MINIMAL },
    ],
  },
} satisfies Record<string, TranslationRule>;

export type TranslationRuleId = keyof typeof TRANSLATION_RULES;

/**
 * Resolve the ordered stages the translation worker should try for a given
 * (language, source-text-length) pair. Returns `[primary, ...fallbacks]` from
 * the matching branch of the language's rule (or `default_hybrid` when the
 * language doesn't set one).
 *
 * `opts.ruleOverride` bypasses the per-language rule lookup — used by
 * `flagTranslation` to force the `retranslation_high` chain regardless of the
 * language's normal routing.
 */
export function resolveTranslationStages(
  code: string,
  sourceTextLength: number,
  opts?: { ruleOverride?: TranslationRuleId },
): ModelStage[] {
  const lang = getLanguageByCode(code);
  const ruleId: TranslationRuleId =
    opts?.ruleOverride ?? lang?.translationRule ?? 'default_hybrid';
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
    targetLangName: lang.translationName ?? lang.name,
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
// ("Mixed"). Derived from each Language's `displayNameOverrides` field, keyed
// by internal code. The Chinese entry's displayCode ('zh-CN') is also
// registered for back-compat with the historical
// `getLocalizedLanguageName('zh-CN', 'en')` contract.
const NAME_OVERRIDES: Record<string, Record<string, string>> = (() => {
  const out: Record<string, Record<string, string>> = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.displayNameOverrides) out[lang.code] = lang.displayNameOverrides;
  }
  const zh = SUPPORTED_LANGUAGES.find((l) => l.code === 'zh');
  if (zh?.displayNameOverrides) out['zh-CN'] = zh.displayNameOverrides;
  return out;
})();

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
// Derived from `SUPPORTED_LANGUAGES` so `needsRomanization` is the single
// source of truth: flipping the flag on a language entry above immediately
// removes it from every scheduling decision (decks.ts / llmTranslationQueue.ts
// / translation.ts) and from every query response (cardContent.ts), and the
// UI stops rendering stored romanization even for rows that were written
// while the flag was still on.
export const ROMANIZATION_LANGUAGES = new Set<string>(
  SUPPORTED_LANGUAGES.filter((l) => l.needsRomanization).map((l) => l.code),
);

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
 * Variant suffixes recognised by `normalizeLanguageCode`, derived from the
 * suffixes actually present in `SUPPORTED_LANGUAGES` codes (the segment after
 * the first underscore, e.g. `es_latam` → `latam`). Adding a dialect variant
 * to the catalog auto-extends the pattern. Kept as a single union so a code
 * like "ar_iq" collapses to "ar" rather than passing through.
 */
const VARIANT_SUFFIXES = [
  ...new Set(
    SUPPORTED_LANGUAGES.map((l) => l.code.split('_')[1]).filter(
      (s): s is string => !!s,
    ),
  ),
];
const VARIANT_SUFFIX_RE = new RegExp(`_(${VARIANT_SUFFIXES.join('|')})$`);

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
> = Object.fromEntries(
  SUPPORTED_LANGUAGES.filter((l) => l.variants?.length).map((l) => [
    l.code,
    l.variants as ReadonlyArray<{ subCode: string; voiceLocalePrefix: string }>,
  ]),
);

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
  resolveCardSpeakerGenders,
} from './voices';
