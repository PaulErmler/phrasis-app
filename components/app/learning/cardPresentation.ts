import type { RefObject } from 'react';
import type { Id } from '@/convex/_generated/dataModel';
import type { MergedPlayback } from '@/hooks/use-active-cue';
import type { PinnableCardAction } from '@/lib/cardActions';
import type { CardOriginPill } from './cardOriginPill';
import type { CardActionsMenuProps } from './CardActionsMenu';
import type { CardTranslation, CardAudioRecording } from './types';

/**
 * The card-presentation bundle shared by the three card components
 * (`CardShell`, `LearningCardContent`, `FullReviewCardContent`): card
 * identity/content, display flags, annotation toggles, the action callbacks
 * and their quota state, and the merged-audio bundle. Built once per mount
 * site (LearningMode's mode ternary previously spelled ~30 of these twice;
 * the library builds one per row) and passed as a single `presentation`
 * prop. Mode-specific props (blur behavior, writing-mode wiring, per-mode
 * speed/highlight settings) stay explicit on each component.
 *
 * Deliberately a plain object built during render, not a memoized context
 * value: none of the card components are wrapped in `React.memo` (they
 * re-render with their parent regardless), and every internal `useMemo` /
 * `useEffect` keys on the leaf values, whose identities are exactly the ones
 * that were passed as individual props before.
 */
export interface CardPresentation {
  // ── Card identity / content ─────────────────────────────────────────────
  cardId?: Id<'cards'>;
  preReviewCount: number;
  /** When in FSRS phase, total reviews = preReviewCount + fsrsState.reps */
  schedulingPhase?: 'preReview' | 'review';
  fsrsState?: { reps: number } | null;
  /** Source-collection pill ("A1.2"); absent/null = hidden. */
  originPill?: CardOriginPill | null;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];

  // ── Card flags ──────────────────────────────────────────────────────────
  isFavorite: boolean;
  isMastered?: boolean;
  isHidden?: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  /** Client-only session flag: did the viewer click flag on this card? */
  flaggedInSession?: boolean;

  // ── Annotation toggles ──────────────────────────────────────────────────
  showRomanization?: boolean;
  /** IPA line toggle (from courseSettings.showIpa; default OFF). */
  showIpa?: boolean;
  /** Furigana ruby over kanji (courseSettings.showFurigana; default ON). */
  showFurigana?: boolean;

  // ── Action callbacks + quota state ──────────────────────────────────────
  onMaster: () => void;
  onHide: () => void;
  onFavorite: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onFlag?: () => void;
  onRegenerateAudio?: () => void;
  pinnedActions?: readonly string[];
  onUpdatePinnedActions?: (actions: PinnableCardAction[]) => void;
  /** Per-action quota state forwarded to CardActionsMenu. */
  quotaState?: CardActionsMenuProps['quotaState'];

  // ── Audio bundle ────────────────────────────────────────────────────────
  onAudioPlay?: () => void;
  /**
   * Merged-audio playback state from useAudioPlayer. Per-frame time lives in
   * `clock`, not React state. See useActiveCue.
   */
  mergedPlayback?: MergedPlayback;
  /** Per-card per-language override stored on the card. Absent = no override. */
  audioSpeedOverrides?: Record<string, number>;
  /** Cycle handler for a language's speed badge; null clears the override. */
  onSpeedCycle?: (language: string, next: number | null) => void;
  /** Merged-audio playback for the slim progress bar at the card's bottom edge. */
  audioRef?: RefObject<HTMLAudioElement | null>;
  durationSec?: number;
  isPlaying?: boolean;
  isMerging?: boolean;
  onSeek?: (seconds: number) => void;
  showProgressBar?: boolean;

  // ── Shortcut signals ────────────────────────────────────────────────────
  /** Restart-card signal: any change resets per-card view state. */
  resetSignal?: number;
  /** Replay-target signal (T shortcut): any change replays the first target clip. */
  replayTargetSignal?: number;
}
