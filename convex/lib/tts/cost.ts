/**
 * The cost figure a TTS synthesis event carries, and where it came from.
 *
 * Mirrors ../stt/cost.ts so the two legs of a clip's spend resolve the same
 * way, and so the three synthesis call sites (the pipeline validation loop,
 * writing alternatives, chat approval previews) can't drift apart.
 *
 * Two providers, two routes to a number:
 *
 *  - Google bills per character of input text, so the cost is derivable on the
 *    spot from a published rate.
 *  - Gemini and MiniMax go through OpenRouter's `/audio/speech`, which answers
 *    with audio bytes and no usage block. The charge is read back from the
 *    stats endpoint using the generation ids collected during synthesis.
 *
 * `source` says which, so a dashboard can tell an exact charge from a list
 * price, and `unavailable` from a genuine zero.
 */
import type { TtsProvider } from '../../types';
import { failedSynthesisGenerationIds } from './types';
import { costForCharacters } from '../../config/aiCosts';
import { generationCostUsd } from '../openrouterGeneration';

export type SynthCostSource =
  /** Derived from a published per-character rate (Google). */
  | 'rate_table'
  /** The exact charge OpenRouter billed, for every request the clip made. */
  | 'generation_api'
  /** Some of the clip's requests priced, others never returned a row. */
  | 'generation_api_partial'
  /** No figure. A zero here would be a lie, not a free call. */
  | 'unavailable';

export type SynthCost = {
  costUsd: number | undefined;
  source: SynthCostSource;
  /** How many billed requests the clip made. >1 means synthesis was retried. */
  billedRequests: number;
  /** How many of those returned a cost. Below `billedRequests` means a partial sum. */
  pricedRequests: number;
};

export async function synthCostForEvent(args: {
  provider: TtsProvider;
  /** Characters sent to the provider. Only used for the per-character rate. */
  characterCount: number;
  /** OpenRouter generation ids from `SpeakResult`. Empty for Google. */
  generationIds: readonly string[];
}): Promise<SynthCost> {
  if (args.provider === 'google') {
    return {
      costUsd: costForCharacters('googleTts', args.characterCount),
      source: 'rate_table',
      billedRequests: 1,
      pricedRequests: 1,
    };
  }

  const billedRequests = args.generationIds.length;
  const { costUsd, pricedIds } = await generationCostUsd(args.generationIds);
  if (costUsd === undefined) {
    return {
      costUsd: undefined,
      source: 'unavailable',
      billedRequests,
      pricedRequests: 0,
    };
  }
  return {
    costUsd,
    source:
      pricedIds === billedRequests
        ? 'generation_api'
        : 'generation_api_partial',
    billedRequests,
    pricedRequests: pricedIds,
  };
}

/**
 * Cost fields for a synthesis that threw.
 *
 * A failed synthesis has no character count worth pricing (Google bills for a
 * request that returned audio) but may well have billed OpenRouter for the
 * attempts it abandoned. Those ids ride on the error; see
 * `TtsSynthesisFailedError`.
 */
export async function synthesisFailureCost(
  provider: TtsProvider,
  err: unknown,
): Promise<{ costUsd?: number }> {
  if (provider === 'google') return {};
  const ids = failedSynthesisGenerationIds(err);
  const { costUsd } = await generationCostUsd(ids);
  return costUsd === undefined ? {} : { costUsd };
}
