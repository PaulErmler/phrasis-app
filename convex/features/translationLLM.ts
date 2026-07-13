/**
 * LLM-based translation helper. Sibling to translation.ts which keeps the
 * Google Translate v2 path. Called from llmTranslationQueue.ts's worker.
 *
 * Uses Vercel's `ai` SDK with `@openrouter/ai-sdk-provider` so error mapping,
 * usage accounting, and reasoning-effort wiring stay consistent with the rest
 * of the Convex codebase (sentenceMetadata.ts, customTexts.ts).
 *
 * Prompt = the XML-structured Prompt B that won the eval (see
 * data_preparation/translation_eval/prompts.py).
 *
 * Reasoning level is decided by the caller (the translation rule's matching
 * `ModelStage` in `lib/languages.ts → TRANSLATION_RULES`). This function
 * just passes the provided `reasoning?: 'low' | 'medium' | 'high'` through
 * to OpenRouter verbatim; if the caller omits it, no reasoning field is
 * sent.
 *
 * Truncation handling: if OpenRouter returns finishReason === 'length' (the
 * call hit MAX_OUTPUT_TOKENS — typically because reasoning ate the whole
 * budget) or the visible content is empty after stripping reasoning, the
 * function returns `{ ok: false, reason }` instead of throwing. Callers use
 * that signal to fall back to Google Translate so the user still gets a
 * translation rather than a missing/truncated row.
 */

import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

/**
 * Default cap on tokens per response when the caller doesn't supply a
 * per-stage override. Sized to comfortably accommodate Gemini Flash Lite at
 * `reasoning: 'low'` translation output. Reasoning-heavy stages (e.g.
 * DeepSeek V4 Flash with `high` effort) declare their own larger cap via
 * `ModelStage.maxOutputTokens` in `lib/languages.ts`. On
 * `finishReason === 'length'` the queue advances to the next fallback stage
 * of the rule (see `llmTranslationQueue.processLlmTranslationForCard` and
 * `lib/languages.ts → TRANSLATION_RULES`).
 */
export const MAX_OUTPUT_TOKENS = 5_000;

/**
 * OpenRouter's documented reasoning-effort levels. The
 * `@openrouter/ai-sdk-provider@1.5.4` types only enumerate
 * `'high' | 'medium' | 'low'`, but OpenRouter itself accepts `'minimal'`
 * (and `'none'` / `'xhigh'`) at runtime — for Gemini 3 / 3.1 it maps
 * `effort: 'minimal'` to Google's `thinkingLevel: 'minimal'`, which is
 * strictly lower than `'low'`. We allow `'minimal'` here and cast at the
 * SDK boundary in `translateTextWithLLM` below.
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type LlmTranslationFailure =
  | { ok: false; reason: 'truncated'; detail?: string }
  | { ok: false; reason: 'empty'; detail?: string }
  | { ok: false; reason: 'http_error'; detail?: string };

export type LlmTranslationResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number }
  | LlmTranslationFailure;

/**
 * Prompt B (XML-structured) — extended with a <referent_gender> tag.
 *
 * Conditional rendering (handled in `buildPrompt` below):
 *   - `<speaker_gender>`   — always emitted; falls back to 'unspecified'.
 *   - `<referent_gender>`  — always emitted; 'male' or 'female'.
 *   - `<addressee_gender>` and `<register>` — only emitted when
 *     `addressesSomeone === true`. Descriptive sentences omit them entirely.
 *
 * 'neutral' register is intentionally treated as informal in the instructions
 * so German doesn't default to Sie, French to vous, etc.
 */
const PROMPT_B_INSTRUCTIONS = `Use the supplied speaker, referent, and (if present) addressee gender for any grammatical agreement (verb conjugation, adjective inflection, pronoun choice, gendered noun forms) the target language requires. The referent_gender drives third-party noun forms like German Übersetzer/-in, French traducteur/-rice, Spanish profesor/-a. Use the requested register: 'informal' and 'neutral' both mean the casual T-form (du/tú/tu/おまえ); only 'formal' means the polite V-form or honorific (Sie/usted/vous/敬語 ます-form). DO NOT default to the polite form when the register is neutral. If the target language does not grammatically encode a given feature, translate naturally and ignore it. Do not output any field as a literal word. Only return one translation. Do not return multiple alternative translations or explanations — when several renderings are possible, silently pick the single most natural one.`;

export type TranslationPromptArgs = {
  text: string;
  sourceLang: string;        // 'en'
  targetLang: string;        // internal code, e.g. 'de'
  targetLangName: string;    // English language name, e.g. 'German'
  /**
   * Native-script language name (e.g. 'Deutsch', '中文（简体）', 'العربية').
   * Always emitted alongside `targetLangName` in the prompt so the model gets
   * the canonical name in the script it's being asked to produce, which
   * measurably reduces wrong-language outputs on tier-2 dialects. Falls back
   * to `targetLangName` when a language has no separate native form (e.g.
   * English variants share the script).
   */
  targetLangNativeName: string;
  targetRegion: string;      // region label for the prompt, e.g. 'Germany'
  addressesSomeone: boolean;
  speakerGender?: 'male' | 'female' | 'neutral';
  addresseeGender?: 'male' | 'female';
  formality?: 'formal' | 'informal' | 'neutral';
  referentGender: 'male' | 'female';
  /**
   * OGTE arc sliding-window context: up to 5 sentences immediately preceding
   * `text` in the same thematic arc, and up to 3 immediately following.
   * Emitted as an `<arc_context>` block before `<source>` so the model can
   * use the surrounding discourse for pronoun/gender/register consistency
   * without translating anything but the `<source>` payload. Undefined for
   * single-sentence arcs, custom/chat texts, and legacy rows without arcId.
   */
  arcContext?: {
    preceding: string[];
    following: string[];
  };
  /**
   * Previous (flagged) translation, when this call is a retranslation
   * triggered by `flagTranslation`. Surfaced to the model so it can see
   * what the user rejected. The prompt is careful to note the previous
   * translation might still be correct — we want the model to reconsider
   * rather than feel pressured to differ.
   */
  previousTranslation?: string;
};

/** Build the user-message string for one translation call. */
export function buildPrompt(args: TranslationPromptArgs): string {
  const speakerLine = `  <speaker_gender>${args.speakerGender ?? 'unspecified'}</speaker_gender>`;
  const referentLine = `  <referent_gender>${args.referentGender}</referent_gender>`;
  const contextLines: string[] = [speakerLine, referentLine];
  if (args.addressesSomeone) {
    contextLines.push(
      `  <addressee_gender>${args.addresseeGender ?? 'unspecified'}</addressee_gender>`,
    );
    contextLines.push(
      `  <register>${args.formality ?? 'neutral'}</register>`,
    );
  }
  // If the native name matches the English name (English variants, romance
  // languages already in Latin script with same spelling), drop the parens to
  // avoid a redundant "German (German)".
  const fullName =
    args.targetLangNativeName && args.targetLangNativeName !== args.targetLangName
      ? `${args.targetLangName} (${args.targetLangNativeName})`
      : args.targetLangName;

  // Optional arc-context block. Only emitted when at least one neighbor was
  // returned by the worker's sliding-window query; the model still translates
  // only the `<source>` payload (see the closing instruction).
  const arc = args.arcContext;
  const arcBlock =
    arc && (arc.preceding.length > 0 || arc.following.length > 0)
      ? [
        ``,
        `<arc_context>`,
        `  The sentence to translate appears in this sequence of related sentences (up to 5 immediately preceding it and up to 3 immediately following it within the same thematic arc). Use the surrounding sentences only to inform consistency of register, pronouns, gender agreement, and discourse flow. Translate ONLY the sentence wrapped in <target>.`,
        ...arc.preceding.map((s) => `  <sentence>${s}</sentence>`),
        `  <target>${args.text}</target>`,
        ...arc.following.map((s) => `  <sentence>${s}</sentence>`),
        `</arc_context>`,
      ]
      : [];

  // Optional previous-translation block. Surfaces what the user flagged so
  // the model can reconsider — explicitly leaving open that the prior was
  // correct, so the model isn't forced to change its answer just to look
  // different from a translation that might already be right.
  const prevBlock = args.previousTranslation
    ? [
      ``,
      `<previous_translation>`,
      `  This sentence was previously translated as <prior>${args.previousTranslation}</prior>. The user flagged that translation as wrong, but there is a chance it was correct anyway. Reconsider it: if you genuinely agree the prior is the best rendering, you may produce the same translation; otherwise output the translation you actually stand behind.`,
      `</previous_translation>`,
    ]
    : [];

  return [
    `You are a professional English-to-${fullName} translator. Translate the text inside <source> tags into ${fullName} (${args.targetLang}), suitable for ${args.targetRegion}.`,
    ``,
    `<context>`,
    ...contextLines,
    `</context>`,
    ...arcBlock,
    ...prevBlock,
    ``,
    `<instructions>`,
    PROMPT_B_INSTRUCTIONS,
    `</instructions>`,
    ``,
    `<source>${args.text}</source>`,
    ``,
    `Output only the ${fullName} translation of the text inside <source>, as exactly ONE translation. No commentary, no explanations, no tags, no quotation marks, no alternative renderings.`,
  ].join('\n');
}

/** Strip a wrapping quote pair if present (some models still wrap despite instructions). */
function stripWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  const pairs = new Set(['"', "'", '“', '”', '‘', '’', '«', '»']);
  if (first === last && pairs.has(first)) return s.slice(1, -1).trim();
  return s;
}

/**
 * Call OpenRouter to translate one sentence. Returns a tagged result so the
 * caller can fall back to Google Translate on truncation/empty/HTTP failure
 * without losing the user's translation.
 */
export async function translateTextWithLLM(
  args: TranslationPromptArgs & {
    model: string;
    reasoning?: ReasoningEffort;
    /**
     * Per-call cap on response tokens. Set by the queue worker from the
     * matching `ModelStage.maxOutputTokens` so reasoning-heavy stages get the
     * extra headroom their thinking trace needs. Falls back to
     * `MAX_OUTPUT_TOKENS` when omitted.
     */
    maxOutputTokens?: number;
  },
): Promise<LlmTranslationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: 'http_error',
      detail: 'OPENROUTER_API_KEY not configured',
    };
  }

  const prompt = buildPrompt(args);
  // Reasoning is decided by the caller (translation rule). Pass through
  // verbatim — no length-based hybrid in this layer.
  const effort = args.reasoning;
  const maxOutputTokens = args.maxOutputTokens ?? MAX_OUTPUT_TOKENS;

  const openrouter = createOpenRouter({ apiKey });

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: openrouter(args.model),
      prompt,
      temperature: 0,
      maxOutputTokens,
      // Cast: the SDK provider's typed enum is `'high' | 'medium' | 'low'`
      // but OpenRouter accepts `'minimal'` at runtime (mapped to Gemini's
      // `thinkingLevel: 'minimal'`). See the `ReasoningEffort` type above.
      ...(effort
        ? {
          providerOptions: {
            openrouter: {
              reasoning: { effort: effort as 'low' | 'medium' | 'high' },
            },
          },
        }
        : {}),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[translationLLM] OpenRouter error', {
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      model: args.model,
      effort,
      detail: detail.slice(0, 500),
    });
    return {
      ok: false,
      reason: 'http_error',
      detail: detail.slice(0, 200),
    };
  }

  const elapsedMs = Date.now() - startedAt;
  const finishReason = result.finishReason;
  const mt = stripWrappingQuotes(result.text.trim());
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;

  // Truncation: the model hit maxOutputTokens. Visible content may or may
  // not be present, but we don't trust it — for reasoning-on calls, hitting
  // the cap usually means thinking ate the budget. Fall back to Google.
  if (finishReason === 'length') {
    console.warn('[translationLLM] truncated by max_tokens', {
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      model: args.model,
      effort,
      inputTokens,
      outputTokens,
      sourcePreview: args.text.slice(0, 120),
    });
    return {
      ok: false,
      reason: 'truncated',
      detail: `finishReason=length, output_tokens=${outputTokens}`,
    };
  }

  if (mt.length === 0) {
    console.warn('[translationLLM] empty response', {
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      model: args.model,
      effort,
      finishReason,
      outputTokens,
    });
    return { ok: false, reason: 'empty', detail: `finishReason=${finishReason}` };
  }

  console.log('[translationLLM] ok', {
    sourceLang: args.sourceLang,
    targetLang: args.targetLang,
    model: args.model,
    effort,
    elapsedMs,
    inputTokens,
    outputTokens,
    srcLen: args.text.length,
    mtLen: mt.length,
  });

  return { ok: true, text: mt, inputTokens, outputTokens };
}
