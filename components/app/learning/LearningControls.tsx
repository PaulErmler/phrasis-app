'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  ChevronRight,
  Eye,
  Loader2,
  Undo2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { KeyChips } from '@/components/app/learning/KeyChips';
import { isEditableTarget } from '@/hooks/use-ime-safe-enter';
import { useMediaQuery } from '@/hooks/use-media-query';
import { COACHMARK_ANCHORS, TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import type { ReviewRating } from '@/lib/scheduling';

interface LearningControlsProps {
  validRatings: ReviewRating[];
  activeRating: ReviewRating;
  ratingIntervals: Record<string, string>;
  onSelectRating: (rating: ReviewRating) => void;
  onPlay: () => void;
  onPause: () => void;
  isPlaying: boolean;
  isMerging: boolean;
  durationSec: number;
  onSeek: (seconds: number) => void;
  /** Pass `ratingOverride` when advancing in the same tick as a rating pick (instant proceed). */
  onNext: (ratingOverride?: ReviewRating) => void;
  /** Undo the last review and bring its card back. */
  onUndo: () => void;
  /** True when the undo stack is empty or an undo/review is in flight. */
  undoDisabled: boolean;
  /**
   * Stepwise back (Left Arrow): revert the last submitted translation if any,
   * otherwise undo the last review. Returns whether anything was taken back.
   * The shortcut only consumes the keypress when it acts. The Undo button
   * itself stays `onUndo`.
   */
  onBack?: () => boolean;
  /** Restart the current card from scratch (Shift+R + the restart button). */
  onRestartCard?: () => void;
  /** Replay the target-language clip (T). */
  onReplayTarget?: () => void;
  isReviewing: boolean;
  instantProceed?: boolean;
  isFullReview?: boolean;
  fullReviewRevealed?: boolean;
  onReveal?: () => void;
  /** When true, window shortcuts (Space, Enter, arrows, letters, rating keys) are disabled, e.g. settings or edit dialog open. */
  shortcutsDisabled?: boolean;
  /** Audio review: Enter / ArrowRight reveal all blurred targets, then the same keys advance to the next card. */
  isAudioReview?: boolean;
  /** When false and `isAudioReview`, Enter / ArrowRight reveal targets instead of advancing. */
  audioAllTargetsRevealed?: boolean;
  onRevealAllAudioTargets?: () => void;
}

export function LearningControls({
  validRatings,
  activeRating,
  ratingIntervals,
  onSelectRating,
  onPlay,
  onPause,
  isPlaying,
  isMerging,
  durationSec,
  onSeek,
  onNext,
  onUndo,
  undoDisabled,
  onBack,
  onRestartCard,
  onReplayTarget,
  isReviewing,
  instantProceed = false,
  isFullReview = false,
  fullReviewRevealed = false,
  onReveal,
  shortcutsDisabled = false,
  isAudioReview = false,
  audioAllTargetsRevealed = true,
  onRevealAllAudioTargets,
}: LearningControlsProps) {
  const t = useTranslations('LearningMode');
  // Key-hint tooltips only make sense where a physical keyboard is likely;
  // touch devices keep the plain buttons (a tap-tooltip would eat the tap).
  const showKeyHints = useMediaQuery('(hover: hover) and (pointer: fine)');

  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!isReviewing) {
      setShowSpinner(false);
      return;
    }
    const id = setTimeout(() => setShowSpinner(true), 300);
    return () => clearTimeout(id);
  }, [isReviewing]);

  /**
   * Restart the card's audio from the top. Shared by the `R` shortcut and the
   * restart-audio button, which the KeyHint labels as `R`. They must not
   * diverge. Seeking alone leaves a paused card silent at 0:00, so resume too.
   */
  const restartAudio = useCallback(() => {
    if (isMerging || durationSec === 0) return;
    onSeek(0);
    if (!isPlaying) onPlay();
  }, [isMerging, durationSec, onSeek, isPlaying, onPlay]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shortcutsDisabled) return;
      const target = e.target;
      if (isEditableTarget(target)) return;
      // Overlays own the keyboard. Radix traps focus inside dialogs and
      // menus, so containment catches the help dialog, the card-actions
      // menu, and any future overlay without each one having to be wired
      // into `shortcutsDisabled`. The driver.js tour has no focus trap.
      // It's detected via the body class it sets while active (its own
      // arrow-key navigation keeps working; ← must not also undo a review
      // behind the overlay).
      if (document.body.classList.contains('driver-active')) return;
      if (
        target instanceof HTMLElement &&
        target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }
      // No session shortcut is a modifier chord, so none of them may shadow a
      // browser/system one. Cmd+R (reload), Alt+← / Alt+→ (back/forward),
      // Ctrl+Enter, and so on. Guarded once here so it covers Space,
      // Enter/→, ← and the letter/digit shortcuts alike; Shift is excluded
      // because Shift+R (restart card) is a real shortcut.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.code === 'Space') {
        // Let Space activate focused interactive controls so keyboard
        // navigation and accessibility are not broken.
        if (
          target instanceof HTMLElement &&
          target.closest(
            'button, a, select, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="tab"]',
          )
        ) {
          return;
        }
        if (e.repeat || isMerging || durationSec === 0) return;
        e.preventDefault();
        if (isPlaying) {
          onPause();
        } else {
          onPlay();
        }
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        // Held keys auto-repeat ~30×/s, without this guard a held Enter
        // races through reveal + next across several cards.
        if (e.repeat) return;
        if (
          target instanceof HTMLElement &&
          target.closest(
            'button, a, select, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="tab"]',
          )
        ) {
          return;
        }
        if (isFullReview && !fullReviewRevealed && onReveal) {
          e.preventDefault();
          onReveal();
        } else if (
          isAudioReview &&
          !audioAllTargetsRevealed &&
          onRevealAllAudioTargets
        ) {
          e.preventDefault();
          onRevealAllAudioTargets();
        } else if (!isReviewing) {
          e.preventDefault();
          onNext();
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (!onBack || e.repeat) return;
        // Only consume the key when back actually acts, on the first card
        // with nothing to undo, ← keeps its default behavior instead of
        // being silently swallowed.
        if (onBack()) e.preventDefault();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (e.repeat) return;
        if (e.shiftKey) {
          if (!onRestartCard) return;
          e.preventDefault();
          onRestartCard();
        } else {
          if (isMerging || durationSec === 0) return;
          e.preventDefault();
          restartAudio();
        }
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        if (e.repeat || !onReplayTarget) return;
        e.preventDefault();
        onReplayTarget();
        return;
      }
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < validRatings.length) {
        // A held number key must rate exactly one card, not one per repeat.
        if (e.repeat) return;
        const chosen = validRatings[idx];
        onSelectRating(chosen);
        if (instantProceed) onNext(chosen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    shortcutsDisabled,
    validRatings,
    onSelectRating,
    instantProceed,
    onNext,
    isFullReview,
    fullReviewRevealed,
    onReveal,
    isReviewing,
    isMerging,
    durationSec,
    isPlaying,
    onPause,
    onPlay,
    onSeek,
    restartAudio,
    onBack,
    onRestartCard,
    onReplayTarget,
    isAudioReview,
    audioAllTargetsRevealed,
    onRevealAllAudioTargets,
  ]);

  return (
    <div className="relative pb-[max(1rem,var(--safe-bottom))]">
      <div className="hidden lg:block pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[100vw] border-t border-border" />

      <div className="border-t lg:border-t-0">
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          {/* Rating buttons */}
          {validRatings.length > 0 && (
            <div
              className="flex gap-2"
              data-tutorial={TUTORIAL_ANCHORS.ratingButtons}
              data-coachmark-anchor={COACHMARK_ANCHORS.ratingButtons}
            >
              {validRatings.map((rating, index) => (
                <div
                  key={rating}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <span className="text-[11px] text-muted-foreground">
                    {ratingIntervals[rating]}
                  </span>
                  <KeyHint
                    enabled={showKeyHints}
                    label={t(`ratings.${rating}`)}
                    keys={[String(index + 1)]}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onSelectRating(rating);
                        if (instantProceed) onNext(rating);
                      }}
                      data-testid={
                        rating === 'stillLearning'
                          ? 'learn-rating-still-learning'
                          : rating === 'understood'
                            ? 'learn-rating-understood'
                            : `learn-rating-${rating}`
                      }
                      className={`w-full ${
                        activeRating === rating
                          ? 'ring-2 ring-primary border-primary bg-primary/5'
                          : ''
                      }`}
                    >
                      {t(`ratings.${rating}`)}
                    </Button>
                  </KeyHint>
                </div>
              ))}
            </div>
          )}

          {/* Undo + Restart + Play + Next row */}
          <div
            className="flex gap-2"
            data-tutorial={TUTORIAL_ANCHORS.audioControls}
          >
            <div
              className="flex gap-2"
              data-tutorial={TUTORIAL_ANCHORS.undoRestart}
            >
              <KeyHint
                enabled={showKeyHints}
                label={t('actions.undo')}
                keys={['←']}
              >
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onUndo}
                  disabled={undoDisabled}
                  data-testid="learn-undo"
                  aria-label={t('actions.undo')}
                  // A disabled button emits no pointer events, so the KeyHint
                  // tooltip can't open. Fall back to the native title there.
                  title={
                    showKeyHints && !undoDisabled
                      ? undefined
                      : t('actions.undo')
                  }
                  className="h-9 w-9 shrink-0"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </KeyHint>
              {onRestartCard && (
                <KeyHint
                  enabled={showKeyHints}
                  label={t('actions.restartCard')}
                  keys={['Shift', 'R']}
                  join="+"
                >
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onRestartCard}
                    data-testid="learn-restart-card"
                    aria-label={t('actions.restartCard')}
                    title={showKeyHints ? undefined : t('actions.restartCard')}
                    className="h-9 w-9 shrink-0"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </KeyHint>
              )}
              <KeyHint
                enabled={showKeyHints}
                label={t('actions.restartAudio')}
                keys={['R']}
              >
                <Button
                  variant="outline"
                  size="icon"
                  onClick={restartAudio}
                  disabled={isMerging || durationSec === 0}
                  data-testid="learn-restart-audio"
                  aria-label={t('actions.restartAudio')}
                  title={
                    showKeyHints && !(isMerging || durationSec === 0)
                      ? undefined
                      : t('actions.restartAudio')
                  }
                  className="h-9 w-9 shrink-0"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
              </KeyHint>
            </div>
            <KeyHint
              enabled={showKeyHints}
              label={t(isPlaying ? 'actions.pause' : 'actions.play')}
              keys={['Space']}
            >
              <Button
                variant="outline"
                size="icon"
                onClick={isPlaying ? onPause : onPlay}
                disabled={isMerging || durationSec === 0}
                aria-label={t(isPlaying ? 'actions.pause' : 'actions.play')}
                title={
                  showKeyHints && !(isMerging || durationSec === 0)
                    ? undefined
                    : t(isPlaying ? 'actions.pause' : 'actions.play')
                }
                className="h-9 flex-[2] min-w-0"
                data-tutorial={TUTORIAL_ANCHORS.audioPlay}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </KeyHint>
            {/* One reveal button, two sources: Writing reveals the answer,
             * Shadowing reveals all blurred targets. Only the handler
             * differs. The ternary computes it so the JSX can't drift. */}
            {(() => {
              const revealHandler =
                isFullReview && !fullReviewRevealed && onReveal
                  ? onReveal
                  : isAudioReview &&
                      !audioAllTargetsRevealed &&
                      onRevealAllAudioTargets
                    ? onRevealAllAudioTargets
                    : null;
              return revealHandler ? (
                <KeyHint
                  enabled={showKeyHints}
                  label={t('actions.reveal')}
                  keys={['Enter']}
                >
                  <Button
                    size="sm"
                    onClick={revealHandler}
                    data-testid="learn-reveal"
                    className="flex-[1] gap-2"
                  >
                    {t('actions.reveal')}
                    <Eye className="h-4 w-4" />
                  </Button>
                </KeyHint>
              ) : (
                <KeyHint
                  enabled={showKeyHints}
                  label={t('actions.next')}
                  keys={['Enter']}
                >
                  <Button
                    size="sm"
                    onClick={() => onNext()}
                    disabled={isReviewing}
                    data-testid="learn-next"
                    className="flex-[1] gap-2"
                  >
                    {t('actions.next')}
                    {showSpinner ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </KeyHint>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps a control in a tooltip showing its action name + key chips. Disabled
 * (touch devices) it renders the child untouched. `join` separates multi-chip
 * hints: "+" for chords (Shift+R) vs. plain adjacency for alternatives.
 */
function KeyHint({
  enabled,
  label,
  keys,
  join,
  children,
}: {
  enabled: boolean;
  label: string;
  keys: string[];
  join?: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{label}</span>
        <KeyChips keys={keys} join={join} />
      </TooltipContent>
    </Tooltip>
  );
}
