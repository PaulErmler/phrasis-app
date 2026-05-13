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
 * Reasoning level = the hybrid length-based rule by default
 *   - src_len < 30 chars → no reasoning field (minimal/fastest path)
 *   - src_len >= 30 chars → `reasoning: { effort: 'low' }`
 * unless the per-language override `translationReasoning` is set on the
 * Language config in lib/languages.ts (e.g. 'medium' for a tricky language).
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

export type ReasoningEffort = 'low' | 'medium' | 'high';

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
const PROMPT_B_INSTRUCTIONS = `Use the supplied speaker, referent, and (if present) addressee gender for any grammatical agreement (verb conjugation, adjective inflection, pronoun choice, gendered noun forms) the target language requires. The referent_gender drives third-party noun forms like German Übersetzer/-in, French traducteur/-rice, Spanish profesor/-a. Use the requested register: 'informal' and 'neutral' both mean the casual T-form (du/tú/tu/おまえ); only 'formal' means the polite V-form or honorific (Sie/usted/vous/敬語 ます-form). DO NOT default to the polite form when the register is neutral. If the target language does not grammatically encode a given feature, translate naturally and ignore it. Do not output any field as a literal word.`;

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
  return [
    `You are a professional English-to-${fullName} translator. Translate the text inside <source> tags into ${fullName} (${args.targetLang}), suitable for ${args.targetRegion}.`,
    ``,
    `<context>`,
    ...contextLines,
    `</context>`,
    ``,
    `<instructions>`,
    PROMPT_B_INSTRUCTIONS,
    `</instructions>`,
    ``,
    `<source>${args.text}</source>`,
    ``,
    `Output only the ${fullName} translation of the text inside <source>. No commentary, no tags, no quotation marks, no alternatives.`,
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
      ...(effort
        ? { providerOptions: { openrouter: { reasoning: { effort } } } }
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
