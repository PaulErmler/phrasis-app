import { generateText } from 'ai';
import type { ActionCtx } from '../_generated/server';
import { OPENROUTER_MODELS } from '../config/aiModels';
import { getOpenRouter } from '../lib/openrouter';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import { trackException } from '../analytics';
import {
  buildRenderingClassifierPrompt,
  buildRenderingClassifierUserPrompt,
  parseRenderingClassifications,
  renderingAxesFor,
  type RenderingClassification,
} from '../lib/renderingClassifier';
import { axisOf, parseRenderingKey } from '../../lib/preferenceResolution';

/**
 * The rendering classifier as a VERIFIER: does a freshly generated wording
 * carry the voice its rendering key asked for? Called by the LLM worker
 * right after generation (docs/architecture/rendering-keys.md); the key is
 * the truth about the row, and this is the check that the model honoured
 * it. Prompt and parser live in convex/lib/renderingClassifier.ts.
 *
 * The verdict is `ok` when the wording agrees with the key, `mismatch` when
 * it contradicts it, and `unknown` when the model gave no usable answer
 * (the row is then stored unverified rather than rejected: a classifier
 * hiccup must not block a translation).
 */
export type RenderingVerdict = 'ok' | 'mismatch' | 'unknown';

export function verdictForClassification(
  language: string,
  key: string,
  classification: RenderingClassification | null,
): RenderingVerdict {
  if (classification === null) return 'unknown';
  const axes = renderingAxesFor(language);
  const { voice } = parseRenderingKey(key);
  // 'unmarked' is fine: the sentence has no first-person form to disagree
  // with the voice ("It is raining").
  const genderOk =
    !axes.gender ||
    classification.gender === 'unmarked' ||
    classification.gender === axisOf(voice);
  return genderOk ? 'ok' : 'mismatch';
}

/**
 * Verify one wording against its rendering key with one classifier call.
 * A language whose wording does not change with the speaker is `ok`
 * without a call.
 */
export async function verifyRendering(
  ctx: ActionCtx,
  args: {
    sentence: string;
    /** The concrete classifier language (`classificationLanguageForRow`). */
    language: string;
    key: string;
    /** Attribution for the cost event; absent = the content-pipeline bucket. */
    userId?: string;
  },
): Promise<{
  verdict: RenderingVerdict;
  classification: RenderingClassification | null;
}> {
  if (!renderingAxesFor(args.language).gender) {
    return { verdict: 'ok', classification: null };
  }
  try {
    const openrouter = getOpenRouter();
    const startedAt = Date.now();
    const { text, usage, providerMetadata } = await generateText({
      model: openrouter(OPENROUTER_MODELS.renderingClassifier),
      system: buildRenderingClassifierPrompt(args.language),
      prompt: buildRenderingClassifierUserPrompt([args.sentence]),
      temperature: 0,
    });
    await captureGeneration(ctx, {
      distinctId: args.userId,
      feature: 'rendering_classifier',
      model: OPENROUTER_MODELS.renderingClassifier,
      provider: 'openrouter',
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: openrouterCostUsd(providerMetadata),
      traceId: openrouterGenerationId(providerMetadata),
      sharedContent: true,
      extra: { language: args.language, key: args.key },
    });
    const [classification] = parseRenderingClassifications(
      args.language,
      text,
      1,
    );
    return {
      verdict: verdictForClassification(
        args.language,
        args.key,
        classification,
      ),
      classification,
    };
  } catch (error) {
    // A verification failure is not a translation failure: report it and
    // let the row land unverified. The worker never retries the
    // translation over a classifier outage.
    await trackException(ctx, error, args.userId, {
      source: 'verifyRendering',
      language: args.language,
      key: args.key,
    });
    return { verdict: 'unknown', classification: null };
  }
}
