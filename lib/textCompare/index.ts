export { normalize } from './normalize';
export type { NormalizeOptions } from './normalize';
export { segmentGraphemes, segmentWords } from './segment';
export { damerauLevenshtein } from './editDistance';
export { charDiff } from './charDiff';
export type {
  CharChunk,
  CharChunkKind,
  CharDiffResult,
  CharDiffOptions,
} from './charDiff';
export { alignWords } from './wordAlign';
export type {
  AlignedWord,
  AlignedKind,
  WordTag,
  WordAlignResult,
  WordAlignOptions,
} from './wordAlign';
export { scoreWordAlignment } from './score';
export { getCompareConfig, toDiffOptions } from './languageConfig';
export type { CompareConfig, DiffOptions } from './languageConfig';
