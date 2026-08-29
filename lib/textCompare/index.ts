export { normalize, isPunctuationOnly, PUNCTUATION_RE } from './normalize';
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
export type { ScoreOptions } from './score';
export { computeAccuracy, computeAccuracyPair } from './accuracy';
export type { AccuracyPair } from './accuracy';
export { getCompareConfig, toDiffOptions } from './languageConfig';
export type {
  CompareConfig,
  CompareOverrides,
  DiffOptions,
} from './languageConfig';
export {
  answerCandidates,
  answersMatchExactly,
  bestCandidate,
} from './bestMatch';
export type { BestCandidate } from './bestMatch';
export { normalizeForComparison } from './normalize';
