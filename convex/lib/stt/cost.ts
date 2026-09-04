import { costForAudioMs } from '../../config/aiCosts';

export type SttCostSource = 'usage' | 'rate_table' | 'unavailable';

/**
 * The cost figure an STT cost event carries, and where it came from.
 *
 * OpenRouter reports the exact charge in `usage.cost`. When a response comes
 * back without it, the rate table prices the billed seconds (the figure the
 * charge is based on), and failing that the measured duration. `source`
 * says which, so a dashboard can tell exact spend from an estimate. Shared
 * by every STT cost event (chat voice input, the TTS validation leg, the
 * word-timing backfill) so the three can't drift.
 */
export function sttCostForEvent(stt: {
  costUsd?: number;
  billedSeconds?: number;
  audioDurationMs?: number;
}): { costUsd: number | undefined; source: SttCostSource } {
  if (stt.costUsd !== undefined) {
    return { costUsd: stt.costUsd, source: 'usage' };
  }
  const ms =
    stt.billedSeconds !== undefined
      ? stt.billedSeconds * 1000
      : stt.audioDurationMs;
  if (ms === undefined) return { costUsd: undefined, source: 'unavailable' };
  return { costUsd: costForAudioMs('openrouterStt', ms), source: 'rate_table' };
}
