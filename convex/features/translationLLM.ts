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

/** Hard cap on tokens per response. Anything more is a bug. */
export const MAX_OUTPUT_TOKENS = 5_000;

/** Source-length threshold for the hybrid reasoning rule. */
export const HYBRID_LENGTH_THRESHOLD = 30;

export type ReasoningEffort = 'low' | 'medium' | 'high';

/** Pick the reasoning effort: explicit override wins, else hybrid length-based default. */
export function pickReasoning(
  text: string,
  override?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (override) return override;
  return text.length < HYBRID_LENGTH_THRESHOLD ? undefined : 'low';
}

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
  targetLangName: string;    // English language name for the prompt, e.g. 'German'
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
  return [
    `You are a professional English-to-${args.targetLangName} translator. Translate the text inside <source> tags into ${args.targetLangName} (${args.targetLang}), suitable for ${args.targetRegion}.`,
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
    `Output only the ${args.targetLangName} translation of the text inside <source>. No commentary, no tags, no quotation marks, no alternatives.`,
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
  const effort = pickReasoning(args.text, args.reasoning);

  const openrouter = createOpenRouter({ apiKey });

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: openrouter(args.model),
      prompt,
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
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
