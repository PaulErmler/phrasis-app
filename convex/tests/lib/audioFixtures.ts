import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { sha256Hex } from '../../lib/sha256';

export interface AudioFixtureArgs {
  textId: Id<'texts'>;
  language: string;
  storageId: Id<'_storage'>;
  /** Defaults to a per-language placeholder. Pass the real string when the test exercises cache lookups. */
  spokenText?: string;
  voiceName?: string;
  voiceGender?: 'male' | 'female';
  ttsQuality?: 'unknown' | 'validated' | 'unvalidated' | 'unchecked';
  ttsProvider?: Doc<'audioAssets'>['ttsProvider'];
  speed?: number;
  wordTimings?: { word: string; start: number; end: number }[];
  ttsVersion?: number;
  regionVariant?: string;
  /** Point the row at an existing asset instead of creating one (shared-asset scenarios). */
  assetId?: Id<'audioAssets'>;
}

/**
 * Test fixture for "this text has audio": inserts an `audioAssets` row owning
 * the blob plus the `(textId, language)` pointer row. The shape every audio
 * row has since the audioAssets narrow.
 */
export async function insertAudioFixture(
  ctx: MutationCtx,
  args: AudioFixtureArgs,
): Promise<{ assetId: Id<'audioAssets'>; rowId: Id<'audioRecordings'> }> {
  const spokenText = args.spokenText ?? `spoken-${args.language}`;
  const assetId =
    args.assetId ??
    (await ctx.db.insert('audioAssets', {
      language: args.language,
      voiceGender: args.voiceGender ?? 'female',
      ...(args.regionVariant !== undefined
        ? { regionVariant: args.regionVariant }
        : {}),
      spokenTextHash: sha256Hex(spokenText),
      spokenText,
      storageId: args.storageId,
      voiceName: args.voiceName ?? 'Leda',
      ttsQuality: args.ttsQuality,
      ttsProvider: args.ttsProvider,
      speed: args.speed ?? 1,
      wordTimings: args.wordTimings,
      ttsVersion: args.ttsVersion,
    }));
  const rowId = await ctx.db.insert('audioRecordings', {
    textId: args.textId,
    language: args.language,
    assetId,
  });
  return { assetId, rowId };
}
