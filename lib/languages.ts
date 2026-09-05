/**
 * Language metadata for the Flexling app.
 *
 * This file owns:
 *   - The Language and TtsProvider types + SUPPORTED_LANGUAGES (pure
 *     metadata: no voices)
 *   - Language-metadata helpers: name lookup, short labels, romanization,
 *     text direction / RTL detection, and mixed-variant resolution
 *     (`resolveMixedVariant` for aggregate codes like `es_mixed`)
 *   - Per-language content versioning (`translationVersion` / `ttsVersion`
 *     and the staleness comparison that drives lazy regeneration)
 *   - The TRANSLATION_RULES pipelines (model × reasoning × fallback chains
 *     for the LLM translation worker) and translation post-processing
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
 * 'elevenlabs' and 'azure' are retired providers kept only as tombstones so
 * historical stored `ttsProvider` values still validate, no language routes
 * to them and neither is dispatchable (see convex/lib/tts/index.ts). Do
 * not remove either from this array without first migrating any stored rows
 * that use it.
 */
export const TTS_PROVIDERS = [
  'google',
  'elevenlabs',
  'azure',
  'gemini',
  'minimax',
] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

/** Identifier for which translation backend a target language currently uses. */
export type TranslationProvider = 'google' | 'openrouter';

/**
 * Which speech-to-text backend transcribes a language (convex/lib/stt).
 * 'mai-transcribe-2' (the default) returns word timings; 'gemini-flash-lite'
 * is the text-only fallback for languages MAI does not cover.
 */
export type SttBackend = 'mai-transcribe-2' | 'gemini-flash-lite';

/**
 * BCP-47-ish region label used in the LLM translation prompt's <context>.
 * Tells the model whether to lean Spanish-Spain vs Spanish-LatAm,
 * Portuguese-Brazil vs Portuguese-Portugal, etc.
 *
 * Derived from each Language's `regionLabel` field (keyed by displayCode; see
 * `DISPLAY_CODE_TO_REGION` below). Falls back to the region segment of the
 * displayCode, or the bare tag when there's no dash, so a language without an
 * explicit `regionLabel` (e.g. `en`) renders its code rather than a blank.
 */
function regionLabelFromDisplayCode(displayCode: string): string {
  const mapped = DISPLAY_CODE_TO_REGION[displayCode];
  if (mapped) return mapped;
  const dash = displayCode.indexOf('-');
  return dash >= 0 ? displayCode.slice(dash + 1) : displayCode;
}

/**
 * Coarse grouping for the grouped language picker. Groupings are a UX
 * compromise between linguistics and geography: 'baltic' bundles Estonian
 * (Uralic) with Lithuanian/Latvian because learners look for it next to its
 * neighbours, and 'south-asian' collects the Indic + Dravidian languages
 * (hi/bn/ta/te) that previously drowned in 'other'.
 */
export type LanguageCategory =
  | 'germanic'
  | 'romance'
  | 'slavic'
  | 'baltic'
  | 'asian-east'
  | 'asian-southeast'
  | 'south-asian'
  | 'semitic'
  | 'african'
  | 'other';

/** Whether tier-1 LLMs reliably handle this language for translation/teaching. */
export type LlmSupportTier = 'tier1' | 'tier2';

/**
 * Script conversion applied to a speech-to-text transcript of a language
 * (convex/lib/stt/scriptNormalize.ts), see `Language.sttScriptFix`.
 */
export type SttScriptFix =
  | 'latinToCyrillic'
  | 'simplifiedToTraditional'
  | 'traditionalToSimplified';

/**
 * Prompt hints for a `Language.accentRewrite`. Everything here is
 * interpolated into `buildAccentRewritePrompt` as examples of what MAY
 * change; the prompt itself carries the freeze list (names, units,
 * punctuation, no slang).
 */
export type AccentRewriteConfig = {
  /** Adjective used in the prompt: 'British', 'Australian'. */
  name: string;
  /** Spelling examples, one comma-separated line. */
  spelling: string;
  /** Everyday-vocabulary examples, one comma-separated line. */
  vocabulary: string;
  /** Grammar/usage substitutions, `"american" -> "local"` pairs. */
  grammar: string;
};

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
   * to read, currently only Japanese. Click-to-explain popovers are still
   * rendered regardless.
   */
  supportsKaraoke: boolean;
  /**
   * Whether our STT backend (MAI-Transcribe-2 via OpenRouter, see
   * convex/lib/stt) can transcribe audio in this language. Gates two
   * downstream features: TTS validation roundtrips (synthesize → transcribe →
   * compare) and per-word audio timings. Karaoke highlighting depends on
   * timings, so `supportsKaraoke: true` only takes effect when this is also
   * true.
   *
   * True for every language in the catalogue as of Sep 2026 (Uzbek via
   * the Gemini backend, see `sttBackend`). MAI takes the bare ISO-639-1
   * code (`toSttLanguage` in convex/lib/stt/languages.ts); a new language
   * whose bare code is outside `MAI_TRANSCRIBE_2_LANGUAGES` fails the
   * exhaustiveness test in convex/tests/lib/stt/languages.test.ts, which is
   * the moment to probe it live and decide this flag or route it to the
   * Gemini backend.
   */
  supportsStt: boolean;
  /**
   * STT backend when `supportsStt` is true. Omit for MAI-Transcribe-2 (word
   * timings, karaoke). 'gemini-flash-lite' transcribes text only, so such a
   * language validates TTS and takes voice input but never gets word
   * timings (`languageSupportsWordTimings`).
   */
  sttBackend?: SttBackend;
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
   * on truncation. Defined in TRANSLATION_RULES below. Unset →
   * `gemini_35_flash_nitro_minimal` (Gemini 3.7 Flash Nitro, minimal
   * reasoning, one same-config retry). No language currently pins a rule.
   * Set one here only to route a language off the default.
   */
  translationRule?: TranslationRuleId;
  /**
   * Override for the language name that appears in the LLM translation
   * prompt's "English-to-X" line. Falls back to `name` when unset.
   *
   * Set wherever the bare `name` leaves register, dialect, or script
   * ambiguous: register pinning (Modern Hebrew, Standard Thai, Modern
   * Greek, Colloquial Cantonese), canonical dialect phrasing (the Arabic
   * dialects, Taiwanese Mandarin), script pinning (Serbian Cyrillic), and
   * training-data naming (Filipino → Tagalog). The UI continues to use
   * `name` because the qualifier is implicit in a contemporary
   * language-learning context.
   *
   * Consumed by both translation prompts: the single-sentence pipeline
   * (convex/features/translationLLM.ts) and the batch autofill
   * (convex/features/customTexts.ts).
   */
  translationName?: string;
  /**
   * Per-language requirements injected into the batch autofill translation
   * prompt (convex/features/customTexts.ts) on the line naming this
   * language. Register mappings, script constraints, and vocabulary
   * steering that don't fit in a language *name*. Only emitted when the
   * language is part of the request, so keep each note self-contained.
   * The single-sentence pipeline doesn't use this; it pins register/gender
   * via explicit prompt tags instead (see translationLLM.ts).
   */
  translationPromptNotes?: string;
  /**
   * Override for the language name used in the Gemini TTS prompt's "speak like
   * a native X" instruction (convex/lib/tts/gemini.ts). Defaults to `name` with
   * the region parenthetical stripped ("English (US)" → "English"), since the
   * accent is normally pinned by `geminiBcp47`. Set this when the dialect can't
   * be pinned by the locale and must be named in the prose instead, e.g.
   * Levantine Arabic, whose `geminiBcp47` collapses to `ar-001` (World Arabic),
   * shared with MSA/Saudi/Iraqi.
   */
  ttsPromptName?: string;
  /**
   * Extra sentence appended to the Gemini TTS delivery instruction for this
   * language (convex/lib/tts/gemini.ts), after the shared wording in
   * deliveryInstruction.ts. Steers delivery within the pinned accent, e.g.
   * how strong the accent should be. Resolved like `ttsPromptName`: the
   * language's own field first, then the language pinning the voice's
   * `@locale` for mixed pools. Prompt-only, so changing it regenerates
   * nothing without a `ttsVersion` bump on the audio-cache language.
   */
  ttsPromptNotes?: string;
  /**
   * Translation-method version (defaults to 1 via `getCurrentTranslationVersion`).
   * Bump when changing the model/prompt for this language to lazily regenerate
   * its existing non-custom translations (and their audio) on next view. The
   * regeneration happens in place: a card that already shows the old wording
   * keeps it (and its audio) as a superseded revision
   * (`translations.supersededAt`), only cards added
   * afterwards get the new one. See the content-versioning helpers below and
   * `translations.translationVersion` in convex/schema.ts. Last bumped for
   * every language in Sep 2026 with the switch to `SOL_MINIMAL`.
   */
  translationVersion?: number;
  /**
   * Post-processing step applied to MACHINE-GENERATED translation output
   * (LLM single-sentence, Google fallback, batch autofill, chat cards)
   * before storage, never to user-typed text. Unset ⇒ the `default` step
   * (strip trailing '_' runs). Set only to route a language onto a
   * different step; consumed via `postProcessTranslation` below.
   */
  translationPostProcess?: TranslationPostProcessId;
  /**
   * Script direction. Unset ⇒ 'ltr'. Drives the `dir` attribute on every
   * element that renders learner-facing sentence text (via
   * `getTextDirection` below): without an explicit direction, an RTL
   * sentence ending in a bidi-neutral mark (Latin `.`, `!`, `?`) renders
   * that mark at the visual START of the sentence under the page's LTR
   * base direction. Set on every entry of an RTL script family (each
   * Arabic dialect carries its own flag).
   */
  direction?: 'rtl';
  /**
   * TTS-setup version (defaults to 1 via `getCurrentTtsVersion`). Bump when
   * changing this language's voice pool, Gemini `ttsPromptName`, or provider so
   * existing audio regenerates lazily. Needed for prompt-only changes on an
   * already-Gemini language where the provider-mismatch regen wouldn't fire
   * (e.g. pt_pt). See `audioRecordings.ttsVersion` in convex/schema.ts.
   */
  ttsVersion?: number;
  /**
   * When `true`, this language is excluded from user-facing pickers in
   * onboarding / course creation / settings (`LanguageSelector` and
   * `DualLanguageEditor`). The entry remains in `SUPPORTED_LANGUAGES` so
   * voice lookups, `getLanguageByCode`, and existing course data referring
   * to the code keep working, only the *picker* surfaces hide it.
   *
   * Nothing sets it right now. It retired the English sub-variants
   * (`en_gb`, `en_us`, `en_au`) between 2026-05 and 2026-09; they are
   * pickable again as accent-only variants (see `sharesTextWith`).
   */
  hiddenFromPicker?: boolean;
  /**
   * Accent-only variant: courses on this code show the `sharesTextWith`
   * language's text verbatim instead of translating it; only the TTS side
   * (voice pool, locale, prompt) differs. `scheduleTranslationForLanguage`
   * writes a `source-verbatim` translation row for such a target whenever
   * the text's own language IS the shared one (an `en` curriculum sentence
   * on an `en_gb` course). When the text is in some other language (a user's
   * German custom sentence with an `en_gb` target) the normal translation
   * path runs and `translationPromptNotes` still apply.
   */
  sharesTextWith?: string;
  /**
   * Light-touch accent rewrite for an accent-only variant. When set, an
   * accent sibling's text (an `en` sentence on an `en_gb` course) is not
   * copied verbatim but sent through `ACCENT_REWRITE_STAGES` with
   * `buildAccentRewritePrompt` (convex/features/translationLLM.ts): only
   * spelling, everyday vocabulary and the odd American grammatical habit
   * change; names, units, currency, dates, punctuation and register stay.
   * A result identical to the source is stored as `source-verbatim`, so
   * the audio clip keeps being shared across accents. Unset on `en_us` (the
   * catalogue already reads American) and on `en` (the mixed course shows
   * the catalogue as is). Chosen by scripts/eval-translation-accents.ts
   * (2026-09-05): Luna passed every curated case, left neutral sentences
   * untouched and changed 5-7% of real catalogue sentences.
   */
  accentRewrite?: AccentRewriteConfig;
  /**
   * When `true`, picker surfaces (`LanguageSelector`) show a user-facing
   * "Experimental" badge next to this language. Independent of the
   * internal-only `llmSupportTier`. Set it on newly added languages while
   * translation/voice quality is still being tuned, and remove the flag once
   * the language has proven itself.
   */
  experimental?: true;

  // --- Provider locale codes + display overrides --------------------------
  // Single source of truth for the per-language data that used to live in
  // separate maps (REGION_MAP, toGeminiBcp47,
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
   * auto-detect from the text (Cantonese), the code passes through unchanged.
   */
  geminiBcp47?: string;
  /**
   * Google Translate v2 / romanize-v3 code (`toGoogleTranslateCode`). Omit to
   * pass the internal code through unchanged.
   */
  googleTranslateCode?: string;
  /**
   * Script fix for speech-to-text transcripts (`scriptConverterFor` in
   * convex/lib/stt/scriptNormalize.ts). MAI-Transcribe-2 picks its own
   * script whatever the hint: Latin for Serbian, Simplified for Mandarin,
   * Traditional for Cantonese. Set when the catalogue script differs from
   * what the model writes, so the transcript matches the stored wording
   * before the TTS validation comparator or the writing grader see it. Omit
   * when the two agree.
   */
  sttScriptFix?: SttScriptFix;
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
   * espeak-ng voice identifier used to derive an IPA transcription
   * (`convex/features/ipa.ts`). Presence doubles as the opt-in flag: a
   * language without `ipaVoice` never gets IPA scheduled, stored rows stop
   * being served, and the UI hides the toggle (mirrors `needsRomanization`).
   * Omitted only for `ja` (espeak reads kana, garbles kanji) and `fil`
   * (no espeak voice).
   */
  ipaVoice?: string;
  /**
   * Opt-in flag for furigana: the kana reading rendered above each kanji run
   * (`convex/features/furigana.ts`). Same role as `ipaVoice` for IPA — a
   * language without it never gets furigana scheduled, stored rows stop being
   * served, and the settings toggle hides.
   *
   * Japanese only today. The pipeline itself is script-agnostic, so a future
   * ruby-annotated language (pinyin over hanzi) sets this flag and supplies an
   * engine branch rather than growing a second annotation kind.
   */
  supportsFurigana?: true;
  /**
   * Locale-keyed display-name overrides (e.g. { de: 'Spanisch (Spanien)' })
   * for codes where Intl.DisplayNames is ambiguous. The `en` value is derived
   * from `name` when the override map is built. Resolution falls back to the
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
    // Pickers show "English (Mixed)" (explicit `en` override, the picker
    // label is localized through NAME_OVERRIDES) while `name` and
    // `nativeName` stay plain "English": they feed LLM prompts ("reply in
    // English", the autofill prompt's "name (nativeName)" form), course
    // names and admin emails, none of which should say "(Mixed)".
    displayNameOverrides: { en: 'English (Mixed)', de: 'Englisch (Gemischt)' },
    // Mixed accents: the voice pool tags the four Gemini voices with en-US,
    // en-GB and en-AU locales (lib/voices.ts); each text gets one accent
    // deterministically (`pickAccentForText`) and the accent is named in the
    // TTS prompt from the picked voice's locale (`getTtsPromptNameForLocale`),
    // since the locale alone drifts toward American. The dialect codes below
    // pin one accent.
    name: 'English',
    nativeName: 'English',
    flag: '🌎',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'en-us',
    supportsKaraoke: true,
    supportsStt: true,
    // A card on this course stores the accent its text speaks in
    // (`cards.accentLanguage`, picked by `pickAccentVariantForText`) and
    // reads the en_gb / en_au rewrite for it; cards from before that field
    // existed keep the source wording.
    translationPromptNotes: 'No strong British or American spelling bias.',
  },
  {
    code: 'en_gb',
    displayCode: 'en-GB',
    regionLabel: 'United Kingdom',
    geminiBcp47: 'en-GB',
    googleTranslateCode: 'en',
    compareLocale: 'en-GB',
    displayNameOverrides: { de: 'Englisch (UK)' },
    name: 'English (UK)',
    nativeName: 'English (UK)',
    flag: '🇬🇧',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // Pin the accent in the prompt too. `geminiBcp47: 'en-GB'` alone can drift
    // toward Gemini's default American English. No `ttsVersion` here: audio
    // for accent variants is cached under `en` (`getAudioAssetLanguage`), so
    // `en`'s version is the one that counts.
    ttsPromptName: 'British English',
    needsRomanization: false,
    ipaVoice: 'en-gb',
    supportsKaraoke: true,
    supportsStt: true,
    sharesTextWith: 'en',
    // v3: rows are light-touch British rewrites of the `en` text
    // (`accentRewrite`, generated on view like every other translation).
    // v2 were verbatim copies, v1 the earlier full LLM rewrites; the bump
    // lazily replaces both.
    translationVersion: 3,
    accentRewrite: {
      name: 'British',
      spelling:
        'colour, centre, organise, travelling, tyre, cheque; "programme" for TV and events but "program" for computers',
      vocabulary:
        'lift, flat, holiday, queue, pavement, lorry, sweets, aubergine, mobile phone, car park',
      grammar:
        '"gotten" -> "got", "on the weekend" -> "at the weekend", "in the hospital" -> "in hospital", "Monday through Friday" -> "Monday to Friday", "I just ate" -> "I\'ve just eaten", "write me" -> "write to me"',
    },
    translationPromptNotes:
      'British spelling and vocabulary (colour, lift, queue).',
  },
  {
    code: 'en_us',
    displayCode: 'en-US',
    regionLabel: 'United States',
    geminiBcp47: 'en-US',
    googleTranslateCode: 'en',
    compareLocale: 'en-US',
    displayNameOverrides: { de: 'Englisch (USA)' },
    name: 'English (US)',
    nativeName: 'English (US)',
    flag: '🇺🇸',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // Named so the mixed `en` pool's `@en-US` voices get an explicit accent
    // in the prompt too (`getTtsPromptNameForLocale`). No ttsVersion bump:
    // existing en_us audio was already American.
    ttsPromptName: 'American English',
    needsRomanization: false,
    ipaVoice: 'en-us',
    supportsKaraoke: true,
    supportsStt: true,
    sharesTextWith: 'en',
    // v2: verbatim copies of the `en` text, see en_gb.
    translationVersion: 2,
    translationPromptNotes:
      'American spelling and vocabulary (color, elevator, line).',
  },
  {
    code: 'en_au',
    displayCode: 'en-AU',
    regionLabel: 'Australia',
    geminiBcp47: 'en-AU',
    googleTranslateCode: 'en',
    compareLocale: 'en-AU',
    displayNameOverrides: { de: 'Englisch (Australien)' },
    name: 'English (Australia)',
    nativeName: 'English (Australia)',
    flag: '🇦🇺',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // Pin the accent in the prompt too. `geminiBcp47: 'en-AU'` alone can drift
    // toward Gemini's default American English. No `ttsVersion`: cached under
    // `en`, see en_gb.
    ttsPromptName: 'Australian English',
    // Sep 2026 listening test (three sets of ten clips, side by side): the
    // bare instruction came out broader than wanted, and this five-word
    // clause tones it down as well as a longer "newsreader" description did.
    // Gemini has no other accent-strength control.
    ttsPromptNotes: 'Keep the Australian accent mild.',
    needsRomanization: false,
    ipaVoice: 'en',
    supportsKaraoke: true,
    supportsStt: true,
    sharesTextWith: 'en',
    // v3: light-touch Australian rewrites of the `en` text, see en_gb.
    translationVersion: 3,
    accentRewrite: {
      name: 'Australian',
      spelling:
        'colour, centre, organise, travelling, tyre, cheque; "programme" for TV and events but "program" for computers',
      vocabulary:
        'lift, flat, holiday, queue, footpath, truck, lollies, eggplant, capsicum, mobile phone, car park',
      grammar:
        '"gotten" -> "got", "in the hospital" -> "in hospital", "Monday through Friday" -> "Monday to Friday", "I just ate" -> "I\'ve just eaten", "write me" -> "write to me"',
    },
    translationPromptNotes:
      'Closer to British spelling; Australian vocabulary where natural.',
  },
  {
    code: 'es',
    displayCode: 'es-ES',
    regionLabel: 'Spain',
    geminiBcp47: 'es-ES',
    displayNameOverrides: { de: 'Spanisch (Spanien)' },
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
    ipaVoice: 'es',
    supportsKaraoke: true,
    supportsStt: true,
    translationPromptNotes:
      'vosotros for the informal plural, peninsular vocabulary.',
    translationVersion: 3,
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
    googleTranslateCode: 'es',
    compareLocale: 'es-419',
    displayNameOverrides: { de: 'Spanisch (Lateinamerika)' },
    name: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
    flag: '🇲🇽',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    ttsPromptName: 'Latin American Spanish',
    needsRomanization: false,
    ipaVoice: 'es-419',
    supportsKaraoke: true,
    supportsStt: true,
    translationPromptNotes:
      'ustedes for the plural, regionally neutral Latin American vocabulary.',
    translationVersion: 3,
  },
  {
    code: 'es_mixed',
    // Sentinel displayCode. The LLM-prompt/STT/voice paths special-case `es_mixed`
    // and expand to es-ES + es-419/es-MX as needed; Intl.DisplayNames is overridden
    // for this code so the displayCode value itself is never user-facing.
    displayCode: 'es',
    geminiBcp47: 'es-ES',
    googleTranslateCode: 'es',
    compareLocale: 'es',
    displayNameOverrides: { de: 'Spanisch (Gemischt)' },
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
    // single `ttsPromptName` applies here. The TTS prompt names the accent
    // from that locale via `getTtsPromptNameForLocale` (es / es_latam's
    // `ttsPromptName`); the locale alone drifted toward Latin American.
    ttsProvider: 'gemini',
    // v2 (2026-09-04): prompt-only change (accent named per voice locale +
    // the no-performing instruction), so existing clips must be re-spoken
    // by a version bump; the provider-mismatch regen wouldn't fire.
    ttsVersion: 2,
    needsRomanization: false,
    ipaVoice: 'es-419',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'fr',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
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
    ipaVoice: 'de',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'it',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'pt',
    displayCode: 'pt',
    regionLabel: 'Brazil',
    geminiBcp47: 'pt-BR',
    displayNameOverrides: { de: 'Portugiesisch (Brasilien)' },
    name: 'Portuguese (Brazil)',
    nativeName: 'Português',
    flag: '🇧🇷',
    category: 'romance',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'pt-br',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'pt_pt',
    displayCode: 'pt-PT',
    regionLabel: 'Portugal',
    geminiBcp47: 'pt-PT',
    googleTranslateCode: 'pt-PT',
    compareLocale: 'pt-PT',
    displayNameOverrides: { de: 'Portugiesisch (Portugal)' },
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
    translationPromptNotes:
      'European Portuguese vocabulary, spelling, and phonetics.',
    translationVersion: 3,
    needsRomanization: false,
    ipaVoice: 'pt-pt',
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'ro',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'ca',
    displayCode: 'ca',
    regionLabel: 'Catalonia',
    geminiBcp47: 'ca-ES',
    name: 'Catalan',
    nativeName: 'Català',
    // Catalonia has no emoji flag; Andorra's flag is the conventional stand-in
    // (Catalan is Andorra's sole official language).
    flag: '🇦🇩',
    category: 'romance',
    llmSupportTier: 'tier1',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'ca',
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
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'ru',
    // Cyrillic. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    translationVersion: 3,
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'pl',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'sk',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'cs',
    displayCode: 'cs',
    regionLabel: 'Czechia',
    geminiBcp47: 'cs-CZ',
    name: 'Czech',
    nativeName: 'Čeština',
    flag: '🇨🇿',
    category: 'slavic',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'cs',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'hr',
    displayCode: 'hr',
    regionLabel: 'Croatia',
    geminiBcp47: 'hr-HR',
    name: 'Croatian',
    nativeName: 'Hrvatski',
    flag: '🇭🇷',
    category: 'slavic',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'hr',
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'sl',
    displayCode: 'sl',
    regionLabel: 'Slovenia',
    geminiBcp47: 'sl-SI',
    name: 'Slovenian',
    nativeName: 'Slovenščina',
    flag: '🇸🇮',
    category: 'slavic',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'sl',
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'uk',
    displayCode: 'uk',
    regionLabel: 'Ukraine',
    geminiBcp47: 'uk-UA',
    romanizationBackend: 'google-v3',
    name: 'Ukrainian',
    nativeName: 'Українська',
    flag: '🇺🇦',
    category: 'slavic',
    llmSupportTier: 'tier1',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'uk',
    // Cyrillic. Karaoke off (non-Latin script policy, matches Russian).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'sr',
    displayCode: 'sr',
    regionLabel: 'Serbia',
    geminiBcp47: 'sr-RS',
    romanizationBackend: 'google-v3',
    // Cyrillic-script Serbian: the catalog standard is Cyrillic (Google
    // romanize-v3's `sr` expects it, and romanization gives learners the
    // Latin rendering anyway). STT returns Latin whatever hint it gets.
    sttScriptFix: 'latinToCyrillic',
    name: 'Serbian',
    nativeName: 'Српски',
    flag: '🇷🇸',
    category: 'slavic',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'sr',
    // Cyrillic. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    // Serbian is bidigraphic and Latin script dominates web training data.
    // Pin Cyrillic in the prompt, since the whole pipeline (STT locale,
    // romanization, catalog standard above) assumes Cyrillic output.
    translationName: 'Serbian (Cyrillic script)',
    translationPromptNotes:
      'Use Cyrillic (ћирилица) exclusively; never the Latin alphabet.',
    // v2: prompt pins Cyrillic. Regenerate pre-existing (possibly
    // Latin-script) translations.
    translationVersion: 3,
  },
  {
    code: 'bg',
    displayCode: 'bg',
    regionLabel: 'Bulgaria',
    geminiBcp47: 'bg-BG',
    romanizationBackend: 'local',
    name: 'Bulgarian',
    nativeName: 'Български',
    flag: '🇧🇬',
    category: 'slavic',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'bg',
    // Cyrillic. Google v3 romanizeText has no `bg` (ru/uk/sr/be only), so
    // the 2009 Streamlined System is produced locally in
    // convex/lib/bulgarianTranslit.ts. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    experimental: true,
  },
  {
    code: 'lt',
    displayCode: 'lt',
    regionLabel: 'Lithuania',
    geminiBcp47: 'lt-LT',
    name: 'Lithuanian',
    nativeName: 'Lietuvių',
    flag: '🇱🇹',
    category: 'baltic',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'lt',
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'lv',
    displayCode: 'lv',
    regionLabel: 'Latvia',
    geminiBcp47: 'lv-LV',
    name: 'Latvian',
    nativeName: 'Latviešu',
    flag: '🇱🇻',
    category: 'baltic',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'lv',
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'et',
    displayCode: 'et',
    regionLabel: 'Estonia',
    geminiBcp47: 'et-EE',
    name: 'Estonian',
    nativeName: 'Eesti',
    flag: '🇪🇪',
    // Uralic linguistically (like Finnish), but grouped with its Baltic
    // neighbours in the picker. Learners look for it next to lt/lv.
    category: 'baltic',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'et',
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'nl',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'sv',
    displayCode: 'sv',
    regionLabel: 'Sweden',
    geminiBcp47: 'sv-SE',
    name: 'Swedish',
    nativeName: 'Svenska',
    flag: '🇸🇪',
    category: 'germanic',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'sv',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    // Re-enabled Jul 2026 on Gemini TTS (the pre-staged entry was Google-era).
    code: 'nb',
    displayCode: 'nb',
    regionLabel: 'Norway',
    geminiBcp47: 'nb-NO',
    googleTranslateCode: 'no',
    name: 'Norwegian (Bokmål)',
    nativeName: 'Norsk bokmål',
    flag: '🇳🇴',
    category: 'germanic',
    llmSupportTier: 'tier1',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'nb',
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'da',
    displayCode: 'da',
    regionLabel: 'Denmark',
    geminiBcp47: 'da-DK',
    name: 'Danish',
    nativeName: 'Dansk',
    flag: '🇩🇰',
    category: 'germanic',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'da',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'is',
    displayCode: 'is',
    regionLabel: 'Iceland',
    // `is-IS` is a documented Gemini TTS locale (Preview stage as of Jul 2026).
    geminiBcp47: 'is-IS',
    name: 'Icelandic',
    nativeName: 'Íslenska',
    flag: '🇮🇸',
    category: 'germanic',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'is',
    supportsKaraoke: true,
    supportsStt: true,
    // Bumped 1 → 2 with the Aug 2026 switch to the Luna best-of-3 pipeline:
    // native-speaker feedback flagged systematic errors in the existing
    // Icelandic rows (archaic register, wrong imperatives), so Icelandic,
    // and only Icelandic. Lazily regenerates its existing translations
    // through the new rule.
    translationVersion: 3,
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'fi',
    supportsKaraoke: true,
    supportsStt: true,
    translationPromptNotes:
      'The formal/informal distinction is minimal; focus on naturalness.',
    translationVersion: 3,
  },
  {
    code: 'el',
    displayCode: 'el',
    regionLabel: 'Greece',
    geminiBcp47: 'el-GR',
    romanizationBackend: 'local',
    name: 'Greek',
    nativeName: 'Ελληνικά',
    flag: '🇬🇷',
    category: 'other',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'el',
    supportsKaraoke: true,
    // STT-off until Sep 2026 (Azure had no el-GR); MAI-Transcribe-2 covers
    // Greek, verified live on the repo's Greek samples.
    supportsStt: true,
    // Disambiguates from Ancient/Koine Greek in the translation prompt
    // (same rationale as Hebrew's 'Modern Hebrew').
    translationName: 'Modern Greek',
    translationVersion: 3,
  },
  {
    code: 'hi',
    displayCode: 'hi',
    regionLabel: 'India',
    geminiBcp47: 'hi-IN',
    romanizationBackend: 'google-v3',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    category: 'south-asian',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'hi',
    // Devanagari. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    translationPromptNotes: 'Informal → तुम form; formal → आप form.',
    translationVersion: 3,
  },
  {
    code: 'bn',
    displayCode: 'bn',
    regionLabel: 'Bangladesh',
    geminiBcp47: 'bn-BD',
    romanizationBackend: 'google-v3',
    name: 'Bengali',
    nativeName: 'বাংলা',
    // Flag is India, not Bangladesh: a holdover from the Azure STT era, when
    // bn-IN was the only Bengali locale it transcribed. Left alone so the
    // picker doesn't churn for existing learners.
    flag: '🇮🇳',
    category: 'south-asian',
    llmSupportTier: 'tier2',
    // Gemini 3.1 Flash TTS supports Bengali (`geminiBcp47: 'bn-BD'`).
    // Switching off Google triggers the provider-mismatch regen for existing
    // audio; the Chirp3 bn-IN pool stays listed dormant for a one-line revert.
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'bn',
    // Bengali script. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'ta',
    displayCode: 'ta',
    regionLabel: 'India',
    geminiBcp47: 'ta-IN',
    romanizationBackend: 'google-v3',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    flag: '🇮🇳',
    category: 'south-asian',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'ta',
    // Tamil script. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
  },
  {
    code: 'te',
    displayCode: 'te',
    regionLabel: 'India',
    geminiBcp47: 'te-IN',
    romanizationBackend: 'local',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    flag: '🇮🇳',
    category: 'south-asian',
    llmSupportTier: 'tier2',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    // Telugu script. Google v3 romanizeText 400s on `te` ("Source language
    // is unsupported") despite still listing it in the docs table; ISO 15919
    // is produced locally via sanscript in convex/lib/localRomanization.ts.
    // Karaoke off (non-Latin script policy).
    needsRomanization: true,
    ipaVoice: 'te',
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'tr',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'uz',
    displayCode: 'uz',
    regionLabel: 'Uzbekistan',
    // Not on Gemini TTS's documented list (Sep 2026), but the locale is
    // accepted and the clips came back as clean standard Uzbek in the
    // 2026-09-05 probe (.scratch/uzbek/). Gemini is the only pool.
    geminiBcp47: 'uz-UZ',
    name: 'Uzbek',
    nativeName: 'Oʻzbekcha',
    flag: '🇺🇿',
    category: 'other',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    // Latin script (official since 1995), so no romanization. Uzbek is
    // bidigraphic and Cyrillic is still common in training data, so the
    // prompt pins Latin the way Serbian pins Cyrillic. Sol produced Latin
    // throughout the probe but mixed its apostrophes (‘ / ʻ / ʼ), hence the
    // canonicalising post-process step.
    needsRomanization: false,
    translationPostProcess: 'uzbekLatin',
    // Added after the Sep 2026 Sol switch, so it starts at the post-switch
    // baseline every other language was bumped to.
    translationVersion: 2,
    ipaVoice: 'uz',
    // MAI-Transcribe-2 has no Uzbek: a pinned `uz` hint 400s and auto-detect
    // returns Russian/Azerbaijani-flavoured garbage (2026-09-05 probe).
    // Gemini 3.1 Flash Lite transcribed the same clips verbatim, so STT
    // runs there. That backend has no word timings, hence no karaoke.
    supportsKaraoke: false,
    supportsStt: true,
    sttBackend: 'gemini-flash-lite',
    translationName: 'Uzbek (Latin script)',
    translationPromptNotes:
      'Use the official Latin alphabet exclusively; never Cyrillic.',
    experimental: true,
  },
  {
    code: 'hu',
    displayCode: 'hu',
    regionLabel: 'Hungary',
    geminiBcp47: 'hu-HU',
    name: 'Hungarian',
    nativeName: 'Magyar',
    flag: '🇭🇺',
    // Uralic (like Finnish), but no clean cluster of Uralic learners yet.
    // Grouped with 'other' rather than forced into Germanic.
    category: 'other',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'hu',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'zh',
    displayCode: 'zh-CN',
    regionLabel: 'Mainland China',
    geminiBcp47: 'cmn-CN',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Chinesisch (Vereinfacht)' },
    name: 'Chinese (Simplified)',
    nativeName: '中文（简体）',
    flag: '🇨🇳',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'cmn',
    // Disabled along with other CJK + Thai languages: word-level segmentation
    // produces per-character tokens that flicker too fast to read. Revisit
    // when we have a learner-grade segmenter.
    supportsKaraoke: false,
    supportsStt: true,
    translationPromptNotes:
      'Simplified Chinese characters, Mainland Mandarin vocabulary.',
    translationVersion: 3,
  },
  {
    code: 'zh_traditional',
    displayCode: 'zh-TW',
    regionLabel: 'Taiwan',
    geminiBcp47: 'cmn-TW',
    googleTranslateCode: 'zh-TW',
    compareLocale: 'zh-TW',
    // STT writes Mandarin in Simplified characters whatever the hint.
    sttScriptFix: 'simplifiedToTraditional',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Chinesisch (Traditionell)' },
    name: 'Chinese (Traditional)',
    nativeName: '中文（繁體）',
    flag: '🇹🇼',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    // Gemini 3.1 Flash TTS supports Mandarin; its docs list the bare `cmn`
    // code (no Taiwan regional variant), so the Taiwanese accent is pinned in
    // the prompt via `ttsPromptName` alongside `geminiBcp47: 'cmn-TW'`.
    // Switching off the (now-retired) Azure provider triggers the
    // provider-mismatch regen for existing audio.
    ttsProvider: 'gemini',
    ttsPromptName: 'Taiwanese Mandarin',
    needsRomanization: true,
    ipaVoice: 'cmn',
    supportsKaraoke: false,
    supportsStt: true,
    // Traditional script is also Hong Kong's. Name Taiwanese Mandarin
    // outright so Taiwan-specific vocabulary (軟體, not 软件/軟件 HK-style)
    // is cued, mirroring ttsPromptName.
    translationName: 'Taiwanese Mandarin (Traditional characters)',
    // v3: prompt pins Taiwanese Mandarin. Regenerate translations made under
    // the bare "Chinese (Traditional)" label.
    translationVersion: 4,
  },
  {
    code: 'yue',
    displayCode: 'yue-Hans-HK',
    regionLabel: 'Hong Kong (simplified script)',
    compareLocale: 'yue-Hans-HK',
    // STT writes Cantonese in Traditional characters whatever the hint.
    sttScriptFix: 'traditionalToSimplified',
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Kantonesisch (Vereinfacht)' },
    name: 'Cantonese (Simplified)',
    nativeName: '粵語（简体）',
    flag: '🇭🇰',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    // MiniMax Speech 2.8 Turbo via OpenRouter. Native Cantonese system
    // voices (Gemini has none; Chirp3-HD misread 唔). See
    // convex/lib/tts/minimax.ts.
    ttsProvider: 'minimax',
    // v2: Chirp3 → MiniMax switch. Regenerate all existing Cantonese audio
    // (the asset cache key contains neither provider nor voice).
    ttsVersion: 2,
    // Jyutping via to-jyutping (rime-cantonese data), which covers simplified
    // script as well as traditional. See convex/lib/localRomanization.ts.
    needsRomanization: true,
    ipaVoice: 'yue',
    supportsKaraoke: false,
    supportsStt: true,
    // Pins BOTH the register (spoken vernacular, 係/唔/嘅, not Standard
    // Written Chinese) and the script; a bare "Cantonese" often yields
    // written Chinese that is effectively Mandarin.
    translationName: 'Cantonese (written in Simplified Chinese characters)',
    translationPromptNotes:
      'Written as one would read it aloud in Cantonese (spoken vernacular), not Standard Written Chinese.',
    // v3: prompt pins the spoken-vernacular register. Regenerate
    // translations made under the bare "Cantonese" label.
    translationVersion: 4,
  },
  {
    code: 'yue_traditional',
    displayCode: 'yue-Hant-HK',
    regionLabel: 'Hong Kong (traditional script)',
    googleTranslateCode: 'yue',
    compareLocale: 'yue-Hant-HK',
    // No `sttScriptFix`: STT already writes Cantonese in Traditional
    // characters (verified live, 2026-09-04). A Simplified→Traditional pass
    // over Traditional text is not safe either: 后, 干, 里, 只 are both a
    // Simplified form and a Traditional character in their own right, and
    // the converter would rewrite them.
    hasWordBoundaries: false,
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Kantonesisch (Traditionell)' },
    name: 'Cantonese (Traditional)',
    nativeName: '粵語（繁體）',
    flag: '🇭🇰',
    category: 'asian-east',
    llmSupportTier: 'tier2',
    // MiniMax Speech 2.8 Turbo via OpenRouter. Native Cantonese system
    // voices (Gemini has none; Chirp3-HD misread 唔). See
    // convex/lib/tts/minimax.ts.
    ttsProvider: 'minimax',
    // v2: Chirp3 → MiniMax switch. Regenerate all existing Cantonese audio
    // (the asset cache key contains neither provider nor voice).
    ttsVersion: 2,
    needsRomanization: true,
    ipaVoice: 'yue',
    supportsKaraoke: false,
    supportsStt: true,
    // Pins BOTH the register (spoken vernacular, 係/唔/嘅, not Standard
    // Written Chinese) and the script; a bare "Cantonese" often yields
    // written Chinese that is effectively Mandarin.
    translationName: 'Cantonese (written in Traditional Chinese characters)',
    translationPromptNotes:
      'Written as one would read it aloud in Cantonese (spoken vernacular), not Standard Written Chinese.',
    // v3: prompt pins the spoken-vernacular register. Regenerate
    // translations made under the bare "Cantonese" label.
    translationVersion: 4,
  },
  {
    code: 'ja',
    displayCode: 'ja',
    regionLabel: 'Japan',
    geminiBcp47: 'ja-JP',
    hasWordBoundaries: false,
    romanizationBackend: 'google-v3',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: true,
    // No ipaVoice: espeak-ng only reads kana, so kanji sentences would
    // come out with gaps/garbage. Revisit if a kanji-aware G2P shows up.
    // Furigana covers the same need better here: it puts the reading on the
    // kanji itself rather than transcribing the sentence to a second line.
    supportsFurigana: true,
    // Japanese tokenizes per-morpheme; karaoke flickers too fast to read.
    // Click-to-explain popovers still work, only the current-word colour
    // is gated off.
    supportsKaraoke: false,
    supportsStt: true,
    translationPromptNotes:
      'Match the source formality: informal → plain form (だ／する), formal → polite form (です／ます).',
    translationVersion: 3,
  },
  {
    code: 'ko',
    displayCode: 'ko',
    regionLabel: 'South Korea',
    geminiBcp47: 'ko-KR',
    romanizationBackend: 'local',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    category: 'asian-east',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    needsRomanization: true,
    ipaVoice: 'ko',
    // Hangul. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    translationPromptNotes:
      'Informal → 반말; formal → 해요체 or 합쇼체 as appropriate.',
    translationVersion: 3,
  },
  {
    code: 'vi',
    displayCode: 'vi',
    regionLabel: 'Vietnam',
    geminiBcp47: 'vi-VN',
    displayNameOverrides: { de: 'Vietnamesisch (Nord)' },
    name: 'Vietnamese (Northern)',
    nativeName: 'Tiếng Việt (miền Bắc)',
    flag: '🇻🇳',
    category: 'asian-southeast',
    llmSupportTier: 'tier1',
    ttsProvider: 'gemini',
    // `vi-VN` can't pin the dialect, so it's named in the prompt. Must be set
    // explicitly: the default strips the "(Northern)" parenthetical from
    // `name` and would fall back to unpinned "Vietnamese".
    ttsPromptName: 'Northern Vietnamese',
    needsRomanization: false,
    ipaVoice: 'vi',
    supportsKaraoke: true,
    supportsStt: true,
    // Canonical dialect name for the translation prompt (mirrors ttsPromptName)
    // so the model produces Northern vocabulary/particles, not a regionless mix.
    translationName: 'Northern Vietnamese',
    translationPromptNotes:
      'Northern (Hanoi) Vietnamese vocabulary and particles.',
    translationVersion: 3,
  },
  {
    code: 'vi_south',
    displayCode: 'vi-VN',
    regionLabel: 'Southern Vietnam',
    // Gemini has no southern-specific locale. `vi-VN` is the only Vietnamese
    // tag it takes, so the dialect is named in the prompt via `ttsPromptName`
    // (the ar_lev / sw_tz pattern). STT takes the bare `vi` code and
    // transcribes southern speech fine, so STT stays on.
    geminiBcp47: 'vi-VN',
    googleTranslateCode: 'vi',
    // Explicit: the default would be the internal code `vi_south`, which is not
    // a valid Intl locale for the answer comparator's segmenter.
    compareLocale: 'vi-VN',
    displayNameOverrides: { de: 'Vietnamesisch (Süd)' },
    name: 'Vietnamese (Southern)',
    nativeName: 'Tiếng Việt (miền Nam)',
    flag: '🇻🇳',
    category: 'asian-southeast',
    llmSupportTier: 'tier1',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    ttsPromptName: 'Southern Vietnamese',
    needsRomanization: false,
    ipaVoice: 'vi-vn-x-south',
    supportsKaraoke: true,
    supportsStt: true,
    // Canonical dialect name for the translation prompt (mirrors ttsPromptName)
    // so the model produces Southern vocabulary/particles, not a regionless mix.
    translationName: 'Southern Vietnamese',
    translationPromptNotes:
      'Southern (Saigon) Vietnamese vocabulary and particles.',
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
    ttsProvider: 'gemini',
    // Romanization disabled. Google v3 doesn't support Thai, and the
    // available pure-JS Thai libraries have not yet been evaluated for
    // learner-grade quality. Re-enable once a good lib is wired up.
    needsRomanization: false,
    ipaVoice: 'th',
    // No spaces between words; per-character karaoke flickers. Disabled
    // alongside CJK; revisit with a learner-grade Thai segmenter.
    supportsKaraoke: false,
    supportsStt: true,
    // Disambiguates from regional/colloquial Thai in the translation prompt.
    translationName: 'Standard Thai',
    translationPromptNotes:
      'Polite particles (ครับ/ค่ะ) only when the source register is formal.',
    translationVersion: 4,
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
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'id',
    supportsKaraoke: true,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'ms',
    displayCode: 'ms',
    regionLabel: 'Malaysia',
    geminiBcp47: 'ms-MY',
    name: 'Malay',
    nativeName: 'Bahasa Melayu',
    flag: '🇲🇾',
    category: 'asian-southeast',
    llmSupportTier: 'tier1',
    // Stamped with the Sep 2026 Sol switch so existing rows (v1) regenerate.
    translationVersion: 2,
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'ms',
    supportsKaraoke: true,
    supportsStt: true,
  },
  {
    code: 'fil',
    displayCode: 'fil',
    regionLabel: 'the Philippines',
    geminiBcp47: 'fil-PH',
    // Google Translate v2 (the legacy fallback path) catalogs Filipino under
    // the Tagalog code `tl`; `fil` isn't in /v2/languages.
    googleTranslateCode: 'tl',
    name: 'Filipino',
    nativeName: 'Filipino',
    flag: '🇵🇭',
    category: 'asian-southeast',
    llmSupportTier: 'tier1',
    // Gemini TTS (fil-PH). See VOICE_POOLS in lib/voices.ts
    // (`fil: [...GEMINI_CORE]`). Latin script, so no romanization; the STT
    // model lists `fil`, so STT + karaoke stay on.
    ttsProvider: 'gemini',
    needsRomanization: false,
    // No ipaVoice: espeak-ng has no Filipino/Tagalog voice.
    supportsKaraoke: true,
    supportsStt: true,
    // Models index far more data under "Tagalog" than "Filipino", same
    // collapse the legacy path does via `googleTranslateCode: 'tl'`.
    translationName: 'Filipino (Tagalog)',
    translationVersion: 3,
  },
  {
    code: 'ar',
    direction: 'rtl',
    displayCode: 'ar',
    regionLabel: 'the Arab world',
    geminiBcp47: 'ar-001',
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Arabisch (Hocharabisch)' },
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
    ipaVoice: 'ar',
    // Karaoke disabled for Arabic: ligatures + clitics don't align to STT
    // word timings, producing flickery/mis-positioned per-word highlights.
    supportsKaraoke: false,
    supportsStt: true,
    // Canonical name in the translation prompt. "Arabic (Modern Standard)"
    // is a UI label, not how the register appears in training data.
    translationName: 'Modern Standard Arabic',
    translationPromptNotes:
      'MSA grammar; when the source does not specify gender, pick a grammatically valid form without letting that choice influence any gender metadata.',
    translationVersion: 3,
  },
  {
    code: 'ar_sa',
    direction: 'rtl',
    displayCode: 'ar-SA',
    regionLabel: 'Saudi Arabia',
    geminiBcp47: 'ar-001',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-SA',
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Arabisch (Saudisch)' },
    name: 'Arabic (Saudi)',
    nativeName: 'العربية (السعودية)',
    flag: '🇸🇦',
    category: 'semitic',
    llmSupportTier: 'tier2',
    // Runs on Gemini global Arabic (`ar-001`); Saudi dialect named in the prompt.
    ttsProvider: 'gemini',
    ttsPromptName: 'Saudi Arabic',
    needsRomanization: true,
    ipaVoice: 'ar',
    supportsKaraoke: false,
    supportsStt: true,
    // Canonical dialect name for the translation prompt (mirrors ttsPromptName)
    // so the model produces actual dialect, not MSA with a region hint.
    translationName: 'Saudi Arabic',
    translationPromptNotes:
      'MSA-leaning but with Hejazi/Najdi colloquial markers where natural.',
    translationVersion: 3,
  },
  {
    code: 'ar_eg',
    direction: 'rtl',
    displayCode: 'ar-EG',
    regionLabel: 'Egypt',
    geminiBcp47: 'ar-EG',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-EG',
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Arabisch (Ägyptisch)' },
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
    ipaVoice: 'ar',
    supportsKaraoke: false,
    supportsStt: true,
    // Canonical dialect name for the translation prompt (mirrors ttsPromptName)
    // so the model produces actual dialect, not MSA with a region hint.
    translationName: 'Egyptian Arabic',
    translationPromptNotes: 'Colloquial Cairene Arabic, not MSA.',
    translationVersion: 3,
  },
  {
    code: 'ar_iq',
    direction: 'rtl',
    displayCode: 'ar-IQ',
    regionLabel: 'Iraq',
    geminiBcp47: 'ar-001',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-IQ',
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Arabisch (Irakisch)' },
    name: 'Arabic (Iraqi)',
    nativeName: 'العربية (العراقية)',
    flag: '🇮🇶',
    category: 'semitic',
    llmSupportTier: 'tier2',
    // Runs on Gemini global Arabic (`ar-001`); Iraqi dialect named in the prompt.
    ttsProvider: 'gemini',
    ttsPromptName: 'Iraqi Arabic',
    needsRomanization: true,
    ipaVoice: 'ar',
    supportsKaraoke: false,
    supportsStt: true,
    // Canonical dialect name for the translation prompt (mirrors ttsPromptName)
    // so the model produces actual dialect, not MSA with a region hint.
    translationName: 'Iraqi Arabic',
    translationPromptNotes: 'Colloquial Iraqi Arabic, not MSA.',
    translationVersion: 3,
  },
  {
    code: 'ar_lev',
    direction: 'rtl',
    displayCode: 'ar-LB',
    regionLabel: 'the Levant (Lebanon, Syria, Palestine, Jordan)',
    geminiBcp47: 'ar-001',
    googleTranslateCode: 'ar',
    compareLocale: 'ar-LB',
    romanizationBackend: 'local',
    displayNameOverrides: { de: 'Arabisch (Levantinisch)' },
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
    ipaVoice: 'ar',
    supportsKaraoke: false,
    supportsStt: true,
    // Canonical dialect name for the translation prompt (mirrors ttsPromptName)
    // so the model produces actual dialect, not MSA with a region hint.
    translationName: 'Levantine Arabic',
    translationPromptNotes: 'Colloquial register, not MSA.',
    translationVersion: 3,
  },
  {
    code: 'he',
    direction: 'rtl',
    displayCode: 'he',
    regionLabel: 'Israel',
    geminiBcp47: 'he-IL',
    romanizationBackend: 'local',
    name: 'Hebrew',
    nativeName: 'עברית',
    flag: '🌎',
    category: 'semitic',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    // Romanization via the `hebrew-transliteration` package (SBL Academic
    // style), wired in convex/lib/localRomanization.ts.
    needsRomanization: true,
    ipaVoice: 'he',
    // Hebrew script. Karaoke off (non-Latin script policy).
    supportsKaraoke: false,
    supportsStt: true,
    // Disambiguates from Biblical Hebrew in the translation prompt.
    translationName: 'Modern Hebrew',
    translationPromptNotes: 'Match speaker gender to the verb form.',
    translationVersion: 3,
  },
  {
    code: 'fa',
    direction: 'rtl',
    displayCode: 'fa',
    regionLabel: 'Iran',
    geminiBcp47: 'fa-IR',
    name: 'Persian',
    nativeName: 'فارسی',
    flag: '🇮🇷',
    category: 'other',
    llmSupportTier: 'tier1',
    // Gemini 3 Flash TTS (via OpenRouter); fa-IR is a documented Gemini TTS
    // locale. See VOICE_POOLS in lib/voices.ts (`fa: [...GEMINI_CORE]`).
    ttsProvider: 'gemini',
    // Perso-Arabic script. Romanized locally via `@sindresorhus/transliterate`
    // (handles the Persian-specific letters پ/چ/ژ/گ that the Arabic library
    // mangles). Note it's a consonant-skeleton transliteration: Persian script
    // omits short vowels, so they're absent from the output (سلام → "slam").
    // Wired in convex/lib/localRomanization.ts. Google v3 isn't an option here
    // (its romanizeText 400s on `fa`).
    needsRomanization: true,
    ipaVoice: 'fa',
    romanizationBackend: 'local',
    // Non-Latin script. Karaoke highlighting off (matches Arabic/Hebrew).
    supportsKaraoke: false,
    supportsStt: true,
    translationVersion: 3,
  },
  {
    code: 'sw',
    displayCode: 'sw-KE',
    regionLabel: 'Kenya',
    geminiBcp47: 'sw-KE',
    compareLocale: 'sw-KE',
    displayNameOverrides: { de: 'Swahili (Kenia)' },
    name: 'Swahili (Kenya)',
    nativeName: 'Kiswahili (Kenya)',
    flag: '🇰🇪',
    category: 'african',
    llmSupportTier: 'tier2',
    ttsProvider: 'gemini',
    needsRomanization: false,
    ipaVoice: 'sw',
    supportsKaraoke: true,
    supportsStt: true,
    translationPromptNotes:
      'Standard Kiswahili as spoken in Kenya, Sheng-free.',
    translationVersion: 3,
  },
  {
    code: 'sw_tz',
    displayCode: 'sw-TZ',
    regionLabel: 'Tanzania',
    geminiBcp47: 'sw-KE',
    googleTranslateCode: 'sw',
    compareLocale: 'sw-TZ',
    displayNameOverrides: { de: 'Swahili (Tansania)' },
    name: 'Swahili (Tanzania)',
    nativeName: 'Kiswahili (Tanzania)',
    flag: '🇹🇿',
    category: 'african',
    llmSupportTier: 'tier2',
    // Gemini 3.1 Flash TTS supports Swahili at the language level only, and
    // Gemini has no sw-TZ locale (`geminiBcp47` collapses to sw-KE), so the
    // Tanzanian dialect is named in the prompt via `ttsPromptName` (the
    // ar_lev pattern). Switching off the (now-retired) Azure provider
    // triggers the provider-mismatch regen for existing audio.
    ttsProvider: 'gemini',
    ttsPromptName: 'Tanzanian Swahili',
    needsRomanization: false,
    ipaVoice: 'sw',
    // Karaoke and STT were both off while Azure rejected sw-TZ (the flag
    // existed only because no timings could be produced). MAI-Transcribe-2
    // takes the bare `sw` code and transcribed a Swahili sample correctly
    // (Sep 2026), so both follow Kenyan Swahili now.
    supportsKaraoke: true,
    supportsStt: true,
    translationPromptNotes: 'Standard Kiswahili sanifu, Tanzanian vocabulary.',
    translationVersion: 3,
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

// Internal code → Language. `getLanguageByCode` runs on hot per-card paths,
// so the lookup is a prebuilt Map rather than an array scan (codes are unique).
const LANGUAGE_BY_CODE = new Map(
  SUPPORTED_LANGUAGES.map((lang) => [lang.code, lang] as const),
);

// ---------------------------------------------------------------------------
// Language-metadata helpers
// ---------------------------------------------------------------------------

/** Get a language by its internal code (e.g. "es", "es_latam", "zh"). */
export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGE_BY_CODE.get(code);
}

/** English display name for a code, falling back to the code itself. */
export function languageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code;
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
// Content versioning. Per-language method/setup versions.
//
// Each version defaults to 1. Bumping a language's `translationVersion` (a new
// model/prompt) or `ttsVersion` (a new voice pool / Gemini prompt / provider)
// in SUPPORTED_LANGUAGES makes `scheduleMissingContent` treat already-stored
// rows whose stamped version is strictly LOWER than the current value as stale
// and regenerate them lazily on next view. The stamp is "undefined === current"
// at the comparison sites (only a number strictly < current is stale), so rows
// written before the field existed never mass-regenerate. A one-time backfill
// stamped them explicitly. See convex/schema.ts.
// ---------------------------------------------------------------------------

/** Baseline version for both translation and TTS when a Language omits it. */
export const DEFAULT_CONTENT_VERSION = 1;

/** Current translation-method version for a language (1 when unset). */
export function getCurrentTranslationVersion(code: string): number {
  return getLanguageByCode(code)?.translationVersion ?? DEFAULT_CONTENT_VERSION;
}

/**
 * Post-processing steps for machine-generated translation output. Every
 * language runs one (unset `translationPostProcess` ⇒ 'default'); the
 * per-language field exists as the override hook for future steps.
 */
export type TranslationPostProcessId = 'default' | 'uzbekLatin';

/**
 * Artifacts a model leaves on an otherwise correct answer: a literal
 * `<final>` / `</final>` wrapper (GPT-5.6 Sol on the `:floor` endpoint
 * appended one to 3 of 344 short answers in the 2026-09-05 accent bench;
 * never seen from the standard endpoint) and trailing underscores or
 * whitespace (observed on Arabic: "…متأسفة._", where the Buckwalter-style
 * romanization then carried the same "_"). Interior underscores are kept:
 * they can be a deliberate blank.
 */
const stripModelArtifacts = (text: string): string =>
  text
    .replace(/<\/?final>/giu, '')
    .replace(/[\s_]+$/u, '')
    .trimStart();

/**
 * Every character models and keyboards use where Uzbek Latin wants a
 * modifier letter: ASCII apostrophe, the curly single quotes, grave/acute
 * accents, the modifier apostrophes themselves (so the step is idempotent)
 * and the modifier reversed comma.
 */
const UZBEK_APOSTROPHE_LIKE = "['‘’ʻʼʽ`´]";

/**
 * Canonicalise Uzbek Latin apostrophes. The alphabet has two: the letters
 * oʻ / gʻ take the modifier letter turned comma (ʻ, U+02BB) and the tutuq
 * belgisi (glottal stop, as in taʼkid) takes the modifier apostrophe (ʼ,
 * U+02BC). Sol writes all three of ‘ / ʻ / ʼ for either within one run, and
 * the FLORES references use ASCII ', so stored text would otherwise mix
 * four variants of the same letter. Typed answers still arrive with ASCII '
 * (the only key learners have); `lib/textCompare/normalize.ts` folds every
 * variant back to ASCII on both sides before comparing.
 */
export function canonicalizeUzbekApostrophes(text: string): string {
  return text.replace(UZBEK_OKINA_RE, '$1ʻ').replace(UZBEK_TUTUQ_RE, 'ʼ');
}

/**
 * oʻ / gʻ: an apostrophe-like after o/g and before a letter (so a closing
 * quote after a word ending in o or g, as in ‘Hugo’, is left alone).
 */
const UZBEK_OKINA_RE = new RegExp(
  `([oOgG])${UZBEK_APOSTROPHE_LIKE}(?=\\p{L})`,
  'gu',
);
/** The tutuq belgisi: an apostrophe-like between two letters, not after o/g. */
const UZBEK_TUTUQ_RE = new RegExp(
  `(?<=\\p{L})(?<![oOgG])${UZBEK_APOSTROPHE_LIKE}(?=\\p{L})`,
  'gu',
);

const TRANSLATION_POST_PROCESSORS: Record<
  TranslationPostProcessId,
  (text: string) => string
> = {
  default: stripModelArtifacts,
  uzbekLatin: (text) => canonicalizeUzbekApostrophes(stripModelArtifacts(text)),
};

/**
 * Apply the language's post-processing step to machine-generated translation
 * output. Also applied to the derived `romanizedText` (it inherits the same
 * artifacts) and by the `stripTrailingUnderscores` backfill migration.
 * Idempotent. Safe to run at both the producer and the storage choke point.
 */
export function postProcessTranslation(code: string, text: string): string {
  const id = getLanguageByCode(code)?.translationPostProcess ?? 'default';
  return TRANSLATION_POST_PROCESSORS[id](text);
}

/**
 * The language code an `audioAssets` row is keyed under. Accent-only
 * variants (`en_gb`, `en_us`, `en_au`) share one cache with their text
 * language (`en`): the accent lives in the asset's `regionVariant` (the
 * voice locale, `en-GB`), so a British clip synthesized for a mixed-English
 * course serves an English (UK) course and vice versa. Identity for every
 * other code.
 */
export function getAudioAssetLanguage(code: string): string {
  return getSharedTextLanguage(code) ?? code;
}

/**
 * Current TTS-setup version for a language (1 when unset). Resolved on the
 * audio-cache language (`getAudioAssetLanguage`): an accent variant's
 * assets are `en` assets, so they carry and are checked against `en`'s
 * version. A `ttsVersion` on `en_gb` itself would be ignored; bump `en` to
 * regenerate English audio in every accent.
 */
export function getCurrentTtsVersion(code: string): number {
  return (
    getLanguageByCode(getAudioAssetLanguage(code))?.ttsVersion ??
    DEFAULT_CONTENT_VERSION
  );
}

/**
 * Whether a stored content row is STALE versus the current config version, and
 * should be regenerated. The single source of truth for the comparison so the
 * translation and TTS regen sweeps can't drift apart.
 *
 * Treats `undefined` (a row written before the version field existed, or never
 * backfilled) as "current/unknown, NOT stale". Only a concrete number strictly
 * below `current` is stale. This is what prevents a database-wide regeneration
 * storm the first time a card is viewed after the feature ships. The deciding
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
  return isContentVersionStale(
    stampedVersion,
    getCurrentTranslationVersion(code),
  );
}

// ---------------------------------------------------------------------------
// Translation rules. Named (model × reasoning × fallback) pipelines.
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
//   3. If a language has no `translationRule` (currently: all of them), it
//      falls back to `sol_minimal`.
// ---------------------------------------------------------------------------

/**
 * Reasoning / thinking effort for a translation stage. `undefined` = send no
 * reasoning field at all. `'none'` = explicitly disable thinking
 * (`reasoning: { enabled: false }` on the wire), required for models like
 * GPT-5.6 Luna where omitting the field is NOT the same as disabling
 * (standard mode reasons adaptively on some inputs). `'minimal'` is
 * Gemini-3-specific. OpenRouter maps it to Google's `thinkingLevel:
 * 'minimal'`, strictly below `'low'`. The `@openrouter/ai-sdk-provider`
 * types only enumerate `'low' | 'medium' | 'high'`; the cast lives in
 * `translateTextWithLLM`.
 */
export type StageReasoning =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/**
 * OpenRouter provider-routing constraints for a stage. `max_price.completion`
 * caps routing at $N per million output tokens. Used to pin promo-priced
 * models (Luna) to their cheap endpoints and exclude expensive variants
 * (Azure serves Luna at $6.00–6.60/M out and was observed burning ~1k hidden
 * reasoning tokens per call, ~10× the request cost).
 */
export type StageProviderConstraints = {
  max_price?: { completion: number };
  /**
   * OpenRouter `provider.order`. Try these slugs first. With the default
   * `allow_fallbacks: true`, later endpoints still serve if the preferred
   * ones are down or don't support the request.
   */
  order?: string[];
  /**
   * OpenRouter `provider.require_parameters`. Only route to endpoints that
   * support every parameter in the request. Set it when a parameter is
   * load-bearing rather than advisory — a `response_format` schema silently
   * dropped by a fallback endpoint yields prose where the caller expects
   * JSON.
   */
  require_parameters?: boolean;
};

/** One leg of a translation rule. An OpenRouter model + optional reasoning. */
export type ModelStage = {
  /** OpenRouter slug, e.g. `'google/gemini-3.1-flash-lite'`. */
  model: string;
  /** See {@link StageReasoning}. */
  reasoning?: StageReasoning;
  /**
   * Per-stage cap on response tokens. Tuned so reasoning-heavy stages have
   * the headroom their thinking traces need (DeepSeek V4 Flash with `high`
   * effort can consume 3–6K tokens of thinking before any visible output)
   * while no-reasoning stages stay tight on cost. `translateTextWithLLM`
   * applies the constant `DEFAULT_MAX_OUTPUT_TOKENS` when this is unset.
   */
  maxOutputTokens?: number;
  /** See {@link StageProviderConstraints}. */
  provider?: StageProviderConstraints;
  /**
   * Best-of-N sampling. When set, the stage runs `total` candidate calls in
   * parallel. Candidate #1 at temperature 0 (this stage's own config), the
   * remaining `total - 1` at `extraTemperature`. Deduplicates the outputs,
   * and (only when >1 unique candidate survives) asks `judge` to pick.
   * Candidate calls fail independently: the stage succeeds as long as one
   * candidate returns usable text; only a full wipe-out advances the rule to
   * the next fallback stage. A stage without `samples` is a single call,
   * byte-for-byte as before this field existed.
   */
  samples?: { total: number; extraTemperature: number };
  /**
   * Judge configuration for `samples` stages. The judge sees the same
   * `<context>` block as the translation prompt plus the shuffled unique
   * candidates and returns the id of the best one. Transport failures are
   * retried up to `maxRetries` extra times; exhausted retries or an
   * unparseable verdict fall back to the temp-0 candidate. The stage still
   * succeeds. Ignored when `samples` is unset.
   */
  judge?: {
    model: string;
    reasoning?: StageReasoning;
    provider?: StageProviderConstraints;
    maxRetries?: number;
  };
};

// Translation provenance. The source slugs (`google-translate-v2`,
// `user-provided`, `curated-manual`) and the guards that decide whether an
// automated pass may touch a row. Lives in `lib/translationProvenance.ts`.
// Import from there, not from here. Only the tag *format* below stays with the
// model config.

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
  reasoning?: StageReasoning,
): string {
  return `${model}-${reasoning ?? 'none'}`;
}

/**
 * Same as `getTranslationSource` but accepts a `ModelStage`. Convenience
 * for the LLM queue worker, which already carries the stage object.
 * Best-of-N stages get a `-bo<total>` marker so rows written by the sampled
 * pipeline are distinguishable from single-call rows of the same model.
 */
export function getTranslationSourceFromStage(stage: ModelStage): string {
  const base = getTranslationSource(stage.model, stage.reasoning);
  return stage.samples ? `${base}-bo${stage.samples.total}` : base;
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

// Gemini 3.5 Flash Lite with `minimal` reasoning. Primary for
// `retranslation_custom` (flagged retranslations of user-created texts).
// Kept on the Flash Lite tier (vs. Pro Medium for curriculum) on the
// assumption that custom texts are mostly the user's own content where a
// heavyweight cross-model second opinion adds less value than on curated
// material. Minimal thinking still gives the retranslation a brief shot at
// catching what the user flagged. Moved off 3.1 Flash Lite in Jul 2026:
// 3.5 is a tier up in price ($0.30/$2.50 per M vs $0.25/$1.50, ~27% more
// per retranslation at identical token counts) but this stage only fires
// on a row the user has explicitly flagged as wrong, so it is both rare
// and the one place where a better second opinion is worth paying for.
const GEMINI_FLASH_LITE_MINIMAL: ModelStage = {
  model: 'google/gemini-3.5-flash-lite',
  reasoning: 'minimal',
  maxOutputTokens: 4_000,
};
// Gemini 3.1 Pro with medium reasoning. Primary for `retranslation_high`
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
// Gemini 3.7 Flash via OpenRouter Nitro routing with `minimal` reasoning.
// The translation workhorse: primary + retry for
// `gemini_35_flash_nitro_minimal`, the default rule for every language.
// Nitro prioritizes throughput/latency; minimal thinking keeps quality on
// par with `low` at much lower cost/latency.
// Exported so the batch-autofill pipeline (convex/config/aiModels.ts +
// convex/features/customTexts.ts) stays on the same model + effort as the
// single-sentence pipeline by construction rather than by comment.
export const GEMINI_35_FLASH_NITRO_MINIMAL: ModelStage = {
  model: 'google/gemini-3.7-flash:nitro',
  reasoning: 'minimal',
  maxOutputTokens: 4_000,
};

/**
 * OpenRouter routing shared by every Luna call in the app (translation,
 * autofill, chat).
 *
 * `order` prefers Amazon Bedrock us-east-1 (OpenRouter slug
 * `amazon-bedrock/us-east-1`; supports tools + reasoning_effort, $1.32/M
 * out as of 2026-08-15). Fallbacks stay on so a Bedrock outage degrades to
 * other endpoints under the price cap rather than failing the request.
 *
 * `max_price.completion` never routes to an endpoint charging more than $2
 * per million output tokens. Originally added to exclude Azure variants
 * that were $6.00–6.60/M and silently burning ~1k hidden reasoning tokens
 * per call during the Aug 2026 eval; kept as a ceiling if those prices
 * return.
 */
export const LUNA_PROVIDER_CONSTRAINTS: StageProviderConstraints = {
  max_price: { completion: 2 },
  order: ['amazon-bedrock/us-east-1'],
};

// GPT-5.6 Luna best-of-3. The translation workhorse Aug–Sep 2026, now a
// fallback of `sol_minimal` and the revert rule.
// Selected by a multi-round eval (FLORES de/is, native-speaker feedback set,
// 500 Tatoeba EN→IS with COMET-22 + blind ratings): no-thinking Luna beat
// Gemini 3.6 Flash minimal on every signal at ~6% of its cost, and the
// temp-0 + 2× temp-1 + Luna-judge variant was the strongest configuration
// (blind raters strictly preferred it over the old default ~2.2:1).
// `reasoning: 'none'` is load-bearing: Luna reasons adaptively unless
// thinking is explicitly disabled, and hidden reasoning tokens are billed.
export const LUNA_BO3: ModelStage = {
  model: 'openai/gpt-5.6-luna:nitro',
  reasoning: 'none',
  maxOutputTokens: 4_000,
  provider: LUNA_PROVIDER_CONSTRAINTS,
  samples: { total: 3, extraTemperature: 1 },
  judge: {
    model: 'openai/gpt-5.6-luna:nitro',
    reasoning: 'none',
    provider: LUNA_PROVIDER_CONSTRAINTS,
    maxRetries: 2,
  },
};

/**
 * GPT-5.6 Terra, single call, no thinking. Evaluated 2026-09-03 as a
 * replacement for `LUNA_BO3` by scripts/eval-translation-pragmatics.ts and
 * NOT wired into any rule: it tied the Luna best-of-3 pipeline overall
 * (9.24 vs 9.12 on the judge, 20 wins / 18 losses over 180 items) at ~3x
 * the cost, lost on Icelandic and on formal register, and Sol-minimal beat
 * it at the same per-sentence price. Kept so the bench keeps measuring the
 * exact stage that was rejected. Standard endpoint pricing is $2/M in,
 * $12/M out; `max_price` keeps the $24/M "fast" endpoint out while still
 * allowing Bedrock/Azure at $13.2. `reasoning: 'none'` is load-bearing for
 * the same reason as Luna's.
 */
export const TERRA_SINGLE: ModelStage = {
  model: 'openai/gpt-5.6-terra',
  reasoning: 'none',
  maxOutputTokens: 4_000,
  provider: { max_price: { completion: 13.2 } },
};

/**
 * GPT-5.6 Sol, one call, `minimal` thinking, cheapest endpoint first. The
 * translation workhorse since Sep 2026, replacing `LUNA_BO3` on two benches:
 * FLORES (2026-09-01: 8.92 vs 8.48) and the speech-act / generality set in
 * scripts/eval-translation-pragmatics.ts (2026-09-03: 9.46 vs 9.12, best in
 * every category and in 7 of 9 languages, Arabic dialects included). Best-of-3
 * added nothing for Sol and `medium` thinking made it worse, so one call at
 * the `minimal` floor (Sol cannot disable thinking).
 *
 * Routing: `:floor` sorts endpoints by price AND opts into OpenAI's flex
 * service tier ($1/M in, $5/M out; base slugs never match flex), so the
 * cheapest endpoint is always tried first. When flex is unavailable the sort
 * falls through to standard ($10/M out), fast ($20) and Bedrock ($22). The
 * $22.1 ceiling admits all of those and excludes only Azure ($30 to $33).
 * Verified with the `sol-floor` bench condition on 2026-09-03: $0.00054 per
 * call against $0.00079 on the standard endpoint, median latency 1.6 s vs
 * 1.35 s, but 2 of 40 calls came back as HTTP errors that OpenRouter did
 * not route around, hence `SOL_MINIMAL_STANDARD` as the first fallback.
 */
export const SOL_MINIMAL: ModelStage = {
  model: 'openai/gpt-5.6-sol:floor',
  reasoning: 'minimal',
  maxOutputTokens: 6_000,
  provider: { max_price: { completion: 22.1 } },
};

/**
 * Same model and thinking as `SOL_MINIMAL` on the default-routed (standard,
 * $2/$10) endpoint: the first fallback of `sol_minimal`, so a flex-tier
 * refusal costs one retry at twice the price instead of dropping the
 * sentence to Luna. Zero failures in 220 bench calls on this routing.
 */
export const SOL_MINIMAL_STANDARD: ModelStage = {
  model: 'openai/gpt-5.6-sol',
  reasoning: 'minimal',
  maxOutputTokens: 6_000,
  provider: { max_price: { completion: 22.1 } },
};

/**
 * Maximum number of auto-retranslations a single translation row can accrue
 * from user complaints. Flags 1 and 2 enqueue a retranslation via
 * `retranslation_high` / `retranslation_custom`; flag 3 and beyond only
 * increment `flagCount` for admin triage. By then the row has had both of its
 * shots at automatic recovery, so further complaints surface as "Flagged"
 * rather than retriggering the pipeline.
 *
 * Two gestures share this counter and this cap, so the ceiling is per row and
 * not per trigger: the explicit Flag button (`flagTranslation`) and a manual
 * card edit of a curriculum translation, which flags the shared row and hands
 * the user's wording to the retranslation as a suggestion
 * (`suggestCurriculumFixesForEdit` in `convex/features/scheduling.ts`). Both
 * check the post-increment count against this constant.
 */
export const FLAG_AUTO_RETRANSLATION_MAX = 2;

export const TRANSLATION_RULES = {
  /**
   * Default for every language, no entry sets an explicit
   * `translationRule` anymore (set one only to route a language off this
   * default, e.g. if Sol regresses on it). Used for the initial LLM
   * translation of premade curriculum sentences and placement-test
   * material. Swapped in from `luna_bo3` in Sep 2026 on eval evidence (see
   * `SOL_MINIMAL`). Existing translations regenerate lazily once a
   * language's `translationVersion` is bumped, keeping their old wording
   * for the cards that already show it (see `supersededAt` in
   * convex/schema.ts). A flex-tier refusal retries on Sol's standard
   * endpoint; a Sol outage degrades to `LUNA_BO3`, then Gemini, then the
   * Google safety net.
   */
  sol_minimal: {
    id: 'sol_minimal',
    label:
      'Sol (minimal, cheapest endpoint) → Sol (minimal, standard) → Luna best-of-3 → Gemini 3.7 Flash Nitro (minimal) → Google',
    branches: [
      {
        maxChars: Infinity,
        primary: SOL_MINIMAL,
        fallbacks: [
          SOL_MINIMAL_STANDARD,
          LUNA_BO3,
          GEMINI_35_FLASH_NITRO_MINIMAL,
        ],
      },
    ],
  },
  /**
   * The Aug–Sep 2026 default, kept as the revert path and as a fallback
   * stage of `sol_minimal`. No language routes here by default anymore.
   * Selected in Aug 2026 on eval evidence (see `LUNA_BO3`).
   */
  luna_bo3: {
    id: 'luna_bo3',
    label:
      'Luna best-of-3 (no thinking, judge) → Gemini 3.7 Flash Nitro (minimal) → Google',
    branches: [
      {
        maxChars: Infinity,
        primary: LUNA_BO3,
        fallbacks: [GEMINI_35_FLASH_NITRO_MINIMAL],
      },
    ],
  },
  /**
   * The pre-Aug-2026 default, kept as the last LLM fallback stage of
   * `sol_minimal` and `luna_bo3`. No language routes here by default
   * anymore.
   */
  gemini_35_flash_nitro_minimal: {
    id: 'gemini_35_flash_nitro_minimal',
    label:
      'Gemini 3.7 Flash Nitro (minimal) → Gemini 3.7 Flash Nitro (minimal, retry) → Google',
    branches: [
      {
        maxChars: Infinity,
        primary: GEMINI_35_FLASH_NITRO_MINIMAL,
        // Same model + reasoning + cap as the primary. The fallback
        // exists only to retry once on transient HTTP errors before the
        // Google safety net kicks in. Truncation is rare at this thinking
        // level / token cap, so retrying the same config is cheap insurance.
        fallbacks: [GEMINI_35_FLASH_NITRO_MINIMAL],
      },
    ],
  },
  /**
   * Triggered by `flagTranslation` for flagged retranslations of CURRICULUM
   * (premade-dataset) texts, on flag counts 1 through
   * `FLAG_AUTO_RETRANSLATION_MAX`. Routes through Gemini 3.1 Pro with
   * medium reasoning. A different (heavier) model than the default Flash
   * tier, so a flagged curriculum row genuinely gets a cross-model second
   * opinion. The worker also threads the previously-flagged translation
   * into the prompt as `<previous_translation>` context. Custom (user-
   * created) texts use `retranslation_custom` instead.
   */
  retranslation_high: {
    id: 'retranslation_high',
    label: 'Gemini 3.1 Pro (medium) — flagged curriculum retranslation',
    branches: [{ maxChars: Infinity, primary: GEMINI_PRO_MEDIUM }],
  },
  /**
   * Triggered by `flagTranslation` for flagged retranslations of CUSTOM
   * (user-created) texts. Routes through Gemini 3.5 Flash Lite with
   * `minimal` reasoning. Kept on the Lite tier (vs. Pro Medium
   * for curriculum) on the assumption that custom texts are mostly the
   * user's own content where a heavyweight cross-model second opinion
   * adds less value than on curated material. Worker behavior
   * (previous-translation prompt block, `replaceExisting` write semantics)
   * matches `retranslation_high`.
   */
  retranslation_custom: {
    id: 'retranslation_custom',
    label: 'Gemini 3.5 Flash Lite (minimal) — flagged custom retranslation',
    branches: [{ maxChars: Infinity, primary: GEMINI_FLASH_LITE_MINIMAL }],
  },
} satisfies Record<string, TranslationRule>;

export type TranslationRuleId = keyof typeof TRANSLATION_RULES;

/**
 * Resolve the ordered stages the translation worker should try for a given
 * (language, source-text-length) pair. Returns `[primary, ...fallbacks]` from
 * the matching branch of the language's rule (or the `sol_minimal` default
 * when the language doesn't set one).
 *
 * `opts.ruleOverride` bypasses the per-language rule lookup. Used by
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
    opts?.ruleOverride ?? lang?.translationRule ?? 'sol_minimal';
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
 * Stage chain for `Language.accentRewrite` targets: one no-thinking Luna
 * call, Sol on the standard endpoint as the fallback, the source text
 * verbatim as the last resort (`onLlmTranslationComplete`). Picked by
 * scripts/eval-translation-accents.ts (2026-09-05): Luna scored 9.9 / 9.6
 * (GB / AU) on a 0-10 judge, passed 100% of the mechanical checks in both
 * accents and cost $0.0001 per sentence; Sol tied it at 4x the price and
 * renumbered "first floor" to "ground floor"; Gemini 3.5 Flash Lite turned
 * eggplant into capsicum. The output cap is tight because the answer is
 * one sentence and `reasoning: 'none'` keeps thinking out of the budget.
 */
export const ACCENT_REWRITE_STAGES: ModelStage[] = [
  {
    model: LUNA_BO3.model,
    reasoning: 'none',
    maxOutputTokens: 1_000,
    provider: LUNA_PROVIDER_CONSTRAINTS,
  },
  { ...SOL_MINIMAL_STANDARD, maxOutputTokens: 1_000 },
];

/**
 * Resolved per-language context for the LLM prompt. Drops `model`/`reasoning`
 * Those now come from `resolveTranslationStages` since they depend on
 * source-text length and may include a fallback chain.
 */
export type ResolvedTranslationConfig = {
  provider: TranslationProvider;
  targetRegion: string; // for the LLM prompt's <context>
  targetLangName: string; // English language name
  /**
   * Language name in its native script (e.g. 'Deutsch', '中文（简体）'). Always
   * injected alongside the English name in LLM prompts. See translationLLM.ts
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
  const provider: TranslationProvider =
    lang.translationProvider ?? 'openrouter';
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
  if (!language) return code.toUpperCase();
  // Accent-only variants (en_gb, en_us, en_au) badge as their shared text
  // language: "EN", never "EN_GB".
  return (language.sharesTextWith ?? language.code).toUpperCase();
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
    if (lang.displayNameOverrides) {
      // The `en` override is always the entry's canonical `name`, so it is
      // injected here instead of being repeated in every literal.
      out[lang.code] = { en: lang.name, ...lang.displayNameOverrides };
    }
  }
  if (out['zh']) out['zh-CN'] = out['zh'];
  return out;
})();

function localizedOverride(key: string, locale: string): string | undefined {
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
  // Hard-coded display-code overrides win first. Intl returns "Chinese
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
 * Whether the language's script is right-to-left, read from the
 * per-language `direction` field (see the `Language` interface for the
 * bidi rationale). Display-code variants (`ar-EG`) that aren't internal
 * codes fall back to their base code's entry.
 */
export function isRtlLanguage(code: string): boolean {
  const lang = getLanguageByCode(code);
  if (lang) return lang.direction === 'rtl';
  const base = code.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return getLanguageByCode(base)?.direction === 'rtl';
}

/** `dir` attribute value for text in the given language. */
export function getTextDirection(code: string): 'rtl' | 'ltr' {
  return isRtlLanguage(code) ? 'rtl' : 'ltr';
}

const RTL_SCRIPT_RE =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/gu;
const LETTER_RE = /\p{L}/gu;

/**
 * Base direction for free-form text with no language code (chat markdown).
 *
 * HTML `dir="auto"` keys on the FIRST strong character, which misfires on
 * the tutor's most common reply shape. An explanation that opens with a
 * target-language token («"وإنت" means "And you?" …» flips the entire
 * English paragraph to RTL, moving every period and colon to the wrong
 * side). Counting strong characters keys the base direction to the
 * dominant script instead; embedded runs of the other script are still
 * reordered correctly by the bidi algorithm within that base.
 */
export function dominantTextDirection(text: string): 'rtl' | 'ltr' {
  const rtl = text.match(RTL_SCRIPT_RE)?.length ?? 0;
  if (rtl === 0) return 'ltr';
  const letters = text.match(LETTER_RE)?.length ?? 0;
  return rtl > letters - rtl ? 'rtl' : 'ltr';
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
 *    yue, yue_traditional, ar (and dialects), fa, te, bg.
 *  - Google v3 romanizeText API: ru, hi, bn, ja, ta, uk, sr. Google's
 *    documented source-language set is am/ar/be/bn/gu/hi/ja/kn/my/ru/sr/ta/
 *    te/uk, but the live endpoint 400s "Source language is unsupported" for
 *    `te` (and historically `fa`); `bg` was never on the list. Those three
 *    are local instead.
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
 * Languages with a working IPA transcription (espeak-ng voice configured).
 * Derived from `ipaVoice` the same way ROMANIZATION_LANGUAGES is derived
 * from `needsRomanization`: dropping the field on an entry immediately stops
 * scheduling (decks.ts / collections.ts), drops stored `ipaText` from query
 * responses (cardContent.ts), and hides the settings toggle.
 */
export const IPA_LANGUAGES = new Set<string>(
  SUPPORTED_LANGUAGES.filter((l) => l.ipaVoice !== undefined).map(
    (l) => l.code,
  ),
);

export function languageNeedsIpa(code: string): boolean {
  return IPA_LANGUAGES.has(code);
}

/**
 * Languages that get furigana (kana readings over kanji runs). Derived from
 * `supportsFurigana` exactly as IPA_LANGUAGES is derived from `ipaVoice`:
 * dropping the flag stops scheduling (decks.ts / collections.ts), drops stored
 * `furiganaText` from query responses (cardContent.ts), and hides the toggle.
 */
export const FURIGANA_LANGUAGES = new Set<string>(
  SUPPORTED_LANGUAGES.filter((l) => l.supportsFurigana === true).map(
    (l) => l.code,
  ),
);

export function languageNeedsFurigana(code: string): boolean {
  return FURIGANA_LANGUAGES.has(code);
}

/**
 * espeak-ng voice for a language, or null when IPA is unsupported.
 * Consumed by the Node-runtime IPA action (convex/features/ipa.ts).
 */
export function getIpaVoice(code: string): string | null {
  return getLanguageByCode(code)?.ipaVoice ?? null;
}

/**
 * Whether per-word karaoke highlighting is enabled for the given language.
 * Karaoke requires word timings, so any language without STT support gets
 * `false` regardless of its declared `supportsKaraoke`. The field is a UX
 * preference that's only meaningful when timings exist.
 *
 * Defaults to true for unknown codes (so new languages get karaoke unless
 * explicitly opted out), but still gated by `languageSupportsStt`.
 */
export function languageSupportsKaraoke(code: string): boolean {
  if (!languageSupportsWordTimings(code)) return false;
  return getLanguageByCode(code)?.supportsKaraoke ?? true;
}

/** STT backend for a language; MAI-Transcribe-2 unless the entry routes elsewhere. */
export function getSttBackend(code: string): SttBackend {
  return getLanguageByCode(code)?.sttBackend ?? 'mai-transcribe-2';
}

/**
 * Whether STT for this language yields per-word timings. Only the MAI
 * backend does; the Gemini fallback returns text alone. Gates the
 * word-timing backfill and the missing-content check so a Gemini language
 * never schedules a backfill that can't produce anything.
 */
export function languageSupportsWordTimings(code: string): boolean {
  return (
    languageSupportsStt(code) && getSttBackend(code) === 'mai-transcribe-2'
  );
}

/**
 * Whether our STT backend can transcribe audio in this language. Single
 * source of truth gating both TTS validation roundtrips and per-word
 * timings. Defaults to false for unknown codes: an unsupported language
 * would spend an STT call on a transcript nobody can use, so not-trying is
 * the safe default.
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
 * Each entry's `variants` array is consumed in order. `resolveMixedVariant`
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
 * The language whose text an accent-only variant shows verbatim (`en` for
 * `en_gb`), or undefined for every other code. See `Language.sharesTextWith`.
 */
export function getSharedTextLanguage(code: string): string | undefined {
  return getLanguageByCode(code)?.sharesTextWith;
}

/**
 * True when `targetCode` and `textLanguage` are two accents of one language
 * (`en` and `en_gb`, `en_gb` and `en_us`), in either direction. False for
 * the same code on both sides (nothing to translate at all) and for
 * unrelated languages. The raw kinship test; `usesSourceTextVerbatim` and
 * `getAccentRewriteConfig` split it into "copy" and "rewrite".
 */
export function isAccentSiblingOf(
  targetCode: string,
  textLanguage: string,
): boolean {
  if (targetCode === textLanguage) return false;
  return (
    getAudioAssetLanguage(targetCode) === getAudioAssetLanguage(textLanguage)
  );
}

/**
 * The accent rewrite an accent sibling's text goes through on a `targetCode`
 * course (an `en` curriculum sentence on an `en_gb` course), or undefined
 * when the text is shown verbatim (`usesSourceTextVerbatim`) or translated
 * normally. Direction matters: a British custom sentence on a Mixed or US
 * English base is shown as typed, because those codes declare no rewrite.
 */
export function getAccentRewriteConfig(
  targetCode: string,
  textLanguage: string,
): AccentRewriteConfig | undefined {
  if (!isAccentSiblingOf(targetCode, textLanguage)) return undefined;
  return getLanguageByCode(targetCode)?.accentRewrite;
}

/**
 * True when a text written in `textLanguage` is served verbatim on a
 * `targetCode` course instead of being translated or rewritten: the two
 * codes are accents of one language and the target declares no
 * `accentRewrite`. A custom sentence typed on an English (UK) course is
 * stored as `en_gb` text, and a Mixed or US English base on that course
 * shows it verbatim, just as a US course shows an `en` curriculum sentence.
 * The translation path stores a `source-verbatim` row (same wording, own
 * voice pool) in that case. A UK or Australian course on an `en` sentence
 * is NOT verbatim: it takes the `getAccentRewriteConfig` path.
 */
export function usesSourceTextVerbatim(
  targetCode: string,
  textLanguage: string,
): boolean {
  return (
    isAccentSiblingOf(targetCode, textLanguage) &&
    getAccentRewriteConfig(targetCode, textLanguage) === undefined
  );
}

/**
 * The Gemini TTS prompt fields for a voice: the language's own
 * `ttsPromptName` / `ttsPromptNotes`, else those of the language that pins
 * the voice's `@locale` (a mixed pool's `Leda@en-GB` takes English (UK)'s
 * "British English" and its notes; `Leda@en-AU` Australian English's). The
 * name falls back to the language's region-stripped display name
 * ("English (US)" → "English"), or the raw code for an unknown language.
 */
export function resolveTtsPrompt(
  code: string,
  locale: string | undefined,
): { name: string; notes: string | undefined } {
  const lang = getLanguageByCode(code);
  return {
    name:
      lang?.ttsPromptName ??
      getTtsPromptNameForLocale(locale) ??
      (lang?.name ?? code).replace(/\s*\([^)]*\)\s*$/, ''),
    notes: lang?.ttsPromptNotes ?? getTtsPromptNotesForLocale(locale),
  };
}

function ttsPromptFieldForLocale(
  locale: string | undefined,
  field: 'ttsPromptName' | 'ttsPromptNotes',
): string | undefined {
  if (locale === undefined) return undefined;
  return SUPPORTED_LANGUAGES.find(
    (l) => l.geminiBcp47 === locale && l[field] !== undefined,
  )?.[field];
}

/** `ttsPromptName` of the language pinning a voice locale (`en-GB` → "British English"). */
export function getTtsPromptNameForLocale(
  locale: string | undefined,
): string | undefined {
  return ttsPromptFieldForLocale(locale, 'ttsPromptName');
}

/** `ttsPromptNotes` of the language pinning a voice locale (`en-AU` → the mild-accent note). */
export function getTtsPromptNotesForLocale(
  locale: string | undefined,
): string | undefined {
  return ttsPromptFieldForLocale(locale, 'ttsPromptNotes');
}

/**
 * Deterministic FNV-1a hash for short strings. Used to seed the per-text
 * variant pick for mixed-dialect languages. Re-running translation for the
 * same textId always lands on the same variant, so the persisted
 * `regionVariant` and the synthesized voice stay in agreement across retries.
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Resolve the concrete regional sub-variant for a mixed-dialect language.
 * Returns `null` when `code` is not a mixed language. Callers should fall
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
 * Look up a mixed-dialect language's variant by a previously persisted
 * `regionVariant` (voice-locale prefix, e.g. `'es-US'`). Regeneration paths
 * use this to pin a translation to the variant already stored on its row,
 * matching by locale prefix instead of re-hashing keeps the pick immune to
 * reordering or extension of the `variants` array. Returns `null` when `code`
 * isn't a mixed language or the prefix no longer exists; callers fall back to
 * `resolveMixedVariant`.
 */
export function getMixedVariantByRegion(
  code: string,
  regionVariant: string,
): { subCode: string; regionVariant: string } | null {
  const variants = MIXED_LANGUAGE_VARIANTS[code];
  if (!variants) return null;
  const match = variants.find((p) => p.voiceLocalePrefix === regionVariant);
  if (!match) return null;
  return { subCode: match.subCode, regionVariant: match.voiceLocalePrefix };
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
// Voice helpers. Re-exported from lib/voices.ts for backward compat.
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
  getVoiceForText,
  getVoiceGenderByApiCode,
  getProviderByApiCode,
  getLocaleFromApiCode,
  getLocalesByLanguageCode,
  getVoiceLocale,
  getVoiceLocalesForLanguage,
  accentRowLanguage,
  getMixedAccentTextLanguage,
  pickAccentForText,
  pickAccentVariantForText,
  resolveAudioSpeakerGender,
  resolveCardSpeakerGenders,
} from './voices';
