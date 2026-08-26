'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AudioButton } from './AudioButton';
import { AudioProgressBar } from './AudioProgressBar';
import { CardActionsMenu, type CardActionsMenuProps } from './CardActionsMenu';
import { CardSpeedBadge } from './CardSpeedBadge';
import { ClickableWords } from './ClickableWords';
import { AnnotationLines } from './AnnotationLines';
import type { CardOriginPill } from './cardOriginPill';
import type { CardTranslation, CardAudioRecording } from './types';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import type { LanguageCue } from '@/lib/audio/mergeAudio';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import type { PinnableCardAction } from '@/lib/cardActions';

interface CardShellProps {
  /** Denser paddings + smaller sentence text for list contexts (library),
   *  where the review-screen sizing looks oversized. */
  compact?: boolean;
  reviewCount: number;
  /** Source-collection pill ("A1.2", "Custom") shown next to the
   *  review-count badge, tinted with the collection's CEFR color. Absent/null
   *  = pill hidden (setting off, or the collection couldn't be resolved). */
  originPill?: CardOriginPill | null;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  isFavorite: boolean;
  isMastered?: boolean;
  isHidden?: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  onMaster: () => void;
  onHide: () => void;
  onFavorite: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onFlag?: () => void;
  onRegenerateAudio?: () => void;
  pinnedActions?: readonly string[];
  onUpdatePinnedActions?: (actions: PinnableCardAction[]) => void;
  /** Per-action quota state for the action menu (Edit / Regenerate / Flag). */
  quotaState?: CardActionsMenuProps['quotaState'];
  onAudioPlay?: () => void;
  bare?: boolean;
  showRomanization?: boolean;
  /** IPA line toggle (from courseSettings.showIpa; default OFF). */
  showIpa?: boolean;
  /** Furigana ruby over kanji (courseSettings.showFurigana; default ON). */
  showFurigana?: boolean;
  /** Karaoke word highlighting toggle (from courseSettings). */
  highlightEnabled?: boolean;
  /** Active per-language playback from an AudioButton; null when none. */
  activeClip?: ButtonPlaybackActive | null;
  /**
   * Frame-rate word-position source for merged playback. Passed to the
   * active row's karaoke leaf so highlights tick without re-rendering the
   * card (see useKaraokeIndex).
   */
  clockBinding?: ClockBinding;
  /** AudioButton time callback; plumbed from the parent's useButtonPlayback. */
  onButtonTimeUpdate?: (language: string, localTime: number) => void;
  /** AudioButton stop callback. */
  onButtonStop?: (language: string) => void;
  /** Course-level per-language general speed (e.g. { "en": 1.0, "es": 0.8 }). */
  languagePlaybackSpeeds?: Record<string, number>;
  /** Per-card per-language override stored on the card. Absent = no override. */
  audioSpeedOverrides?: Record<string, number>;
  /** Cycle handler for a language's speed badge; null clears the override. */
  onSpeedCycle?: (language: string, next: number | null) => void;
  /** Badge behavior. `ephemeral` hides the null/default slot and greys 1.0. */
  speedBadgeVariant?: 'persistent' | 'ephemeral';
  /**
   * Client-only session state: did the viewer click the flag action on this
   * card during the current view? Set on click, cleared when navigating
   * away. Drives the warning-color "Flagged" pill. A per-session signal
   * scoped to the flagger, NOT a global server-derived state (which would
   * leak the flag to other users). Wins visually over the server-driven
   * "Retranslating" pill when both apply.
   */
  flaggedInSession?: boolean;
  /** Merged-audio playback for the slim progress bar at the card's bottom edge. */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  durationSec?: number;
  isPlaying?: boolean;
  isMerging?: boolean;
  onSeek?: (seconds: number) => void;
  showProgressBar?: boolean;
  /** Cue boundaries (per-language start times) for the progress bar's hover ticks. */
  languageCues?: ReadonlyArray<LanguageCue>;
  /** Blur base-language text by default ("Hide base languages"). */
  hideBaseLanguages?: boolean;
  /** Un-blur a base language when its audio starts playing. */
  autoRevealBaseLanguages?: boolean;
  /** Languages revealed by audio playback (from useAudioPlayer). */
  revealedLanguages?: ReadonlySet<string>;
  /** Languages the viewer manually revealed by tapping the blurred text. */
  manuallyRevealedLanguages?: ReadonlySet<string>;
  /** Reveal a language on tap (shared with the parent's target-reveal state). */
  onRevealLanguage?: (language: string) => void;
  /** When set, tag the longest word of the FIRST base-language row with this
   *  `data-coachmark-anchor` so the word-tap tip has something to point at.
   *  Writing mode renders no target-language `ClickableWords` before submit,
   *  so the base row is the only clickable sentence on screen; audio mode
   *  anchors its target row instead (see LearningCardContent). Skipped while
   *  the row is blurred. A hidden word is not a tap target. */
  baseCoachmarkAnchorForLongestWord?: string;
  children: (ctx: {
    baseTranslations: CardTranslation[];
    targetTranslations: CardTranslation[];
  }) => ReactNode;
}

export function CardShell({
  compact = false,
  reviewCount,
  originPill,
  sourceText,
  translations,
  audioRecordings,
  isFavorite,
  isMastered = false,
  isHidden = false,
  isPendingMaster,
  isPendingHide,
  onMaster,
  onHide,
  onFavorite,
  onEdit,
  onDelete,
  onFlag,
  onRegenerateAudio,
  pinnedActions,
  onUpdatePinnedActions,
  quotaState,
  onAudioPlay,
  bare = false,
  showRomanization = true,
  showIpa = false,
  showFurigana = true,
  highlightEnabled = false,
  activeClip = null,
  clockBinding,
  onButtonTimeUpdate,
  onButtonStop,
  languagePlaybackSpeeds,
  audioSpeedOverrides,
  onSpeedCycle,
  speedBadgeVariant,
  flaggedInSession = false,
  audioRef,
  durationSec,
  isPlaying,
  isMerging,
  onSeek,
  showProgressBar = false,
  languageCues,
  hideBaseLanguages = false,
  autoRevealBaseLanguages = false,
  revealedLanguages,
  manuallyRevealedLanguages,
  onRevealLanguage,
  baseCoachmarkAnchorForLongestWord,
  children,
}: CardShellProps) {
  const t = useTranslations('LearningMode');
  const baseTranslations = translations.filter((tr) => tr.isBaseLanguage);
  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);
  const masterActive = isMastered || isPendingMaster;
  const hideActive = isHidden || isPendingHide;

  // Translation-state pill, single source for the card header.
  // - "Retranslating" (server-driven, global): an LLM retranslation is in
  //   flight for at least one target language. Doesn't fire on "regenerate
  //   audio" (no LLM phase, no claim). Shown to everyone, including the
  //   flagger, so they get the live "in progress" signal.
  // - "Flagged" (client-only, session-scoped): the viewer clicked the flag
  //   action on this card. Persists after the LLM lands (or shows
  //   immediately for over-cap flags that don't enqueue an LLM job),
  //   purely client state: NOT leaked to other users.
  // Retranslating wins while the work is actively happening; Flagged
  // takes over once the retranslation finishes (or never started).
  const anyTargetRetranslating = targetTranslations.some(
    (tr) => tr.retranslating === true,
  );
  const translationStatePill = anyTargetRetranslating
    ? { key: 'retranslating' as const, label: t('retranslating') }
    : flaggedInSession
      ? { key: 'flagged' as const, label: t('flagged') }
      : null;

  const cardSurface = (
    <div className="card-surface overflow-hidden" data-tutorial={TUTORIAL_ANCHORS.cardFlashcard}>
      {/* Card top bar: metadata left, actions right */}
      <div className={compact ? 'flex items-center justify-between px-3 pt-3 pb-1.5' : 'flex items-center justify-between px-4 pt-4 pb-2'}>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {t('reviewCount', { count: reviewCount })}
          </Badge>
          {originPill && (
            <Badge
              variant="outline"
              className="font-mono text-xs"
              // CEFR-tinted like the home-screen level chips: transparent
              // fill of the tier color, tier-colored text. Custom/chat pills
              // carry no color and keep the neutral outline look.
              style={
                originPill.color
                  ? {
                      borderColor: 'transparent',
                      backgroundColor: `color-mix(in oklch, ${originPill.color} 15%, transparent)`,
                      color: originPill.color,
                    }
                  : undefined
              }
            >
              {originPill.label}
            </Badge>
          )}
          {translationStatePill && (
            <Badge
              // Transparent warning fill (15% alpha of theme's --color-warning).
              // aria-live announces transitions (retranslating → flagged, or
              // cleared) without grabbing focus.
              className="border-transparent bg-warning/15 text-warning text-xs"
              aria-live="polite"
            >
              {translationStatePill.label}
            </Badge>
          )}
        </div>
        <CardActionsMenu
          isFavorite={isFavorite}
          isMastered={masterActive}
          isHidden={hideActive}
          onFavorite={onFavorite}
          onMaster={onMaster}
          onHide={onHide}
          onEdit={onEdit}
          onDelete={onDelete}
          onFlag={onFlag}
          onRegenerateAudio={onRegenerateAudio}
          pinnedActions={pinnedActions}
          onUpdatePinnedActions={onUpdatePinnedActions}
          quotaState={quotaState}
        />
      </div>

      {/* Card text content */}
      <div className={compact ? 'px-4 pb-4 space-y-3' : 'px-6 pb-6 space-y-4'}>
        {/* Base language texts */}
        <div className="space-y-2" data-tutorial={TUTORIAL_ANCHORS.baseLanguages}>
          {baseTranslations.map((translation, index) => {
            const audio = audioRecordings.find(
              (a) => a.language === translation.language,
            );
            const isActive = activeClip?.language === translation.language;
            const override = audioSpeedOverrides?.[translation.language];
            const isEphemeral = speedBadgeVariant === 'ephemeral';
            // Ephemeral surfaces ignore the course-level general speed. The
            // resting state is always 1.0, same as what the badge renders.
            const generalSpeed = isEphemeral
              ? DEFAULT_PLAYBACK_SPEED
              : (languagePlaybackSpeeds?.[translation.language] ??
                DEFAULT_PLAYBACK_SPEED);
            const effectiveSpeed = override ?? generalSpeed;
            // Base-language blur mirrors the target-language behavior: hidden by
            // default when enabled, un-blurred when its audio plays (auto-reveal)
            // or when tapped.
            const isAudioRevealed =
              autoRevealBaseLanguages &&
              (revealedLanguages?.has(translation.language) ?? false);
            const isBlurred =
              hideBaseLanguages &&
              !isAudioRevealed &&
              !(manuallyRevealedLanguages?.has(translation.language) ?? false);
            // Base text matches the target rows' weight/size, no bolding.
            const baseTextClass = compact ? 'text-base leading-relaxed' : 'body-large';
            return (
              <div
                key={translation.language}
                className="flex items-start gap-2"
              >
                <div
                  className="flex-1"
                  onClick={
                    isBlurred
                      ? () => onRevealLanguage?.(translation.language)
                      : undefined
                  }
                >
                  <ClickableWords
                    text={translation.text || '...'}
                    language={translation.language}
                    wordTimings={audio?.wordTimings ?? null}
                    localTime={activeClip?.localTime ?? 0}
                    clockBinding={isActive ? clockBinding : undefined}
                    isActive={!!isActive}
                    enabled={highlightEnabled}
                    furigana={showFurigana ? translation.furigana : undefined}
                    interactive={!isBlurred}
                    className={`${baseTextClass} ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                    coachmarkAnchorForLongestWord={
                      index === 0 && !isBlurred
                        ? baseCoachmarkAnchorForLongestWord
                        : undefined
                    }
                  />
                  <AnnotationLines
                    romanization={translation.romanization}
                    ipa={translation.ipa}
                    showRomanization={showRomanization}
                    showIpa={showIpa}
                    className={isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}
                  />
                </div>
                <div className="flex items-center">
                  <AudioButton
                    url={audio?.url ?? null}
                    language={translation.language}
                    onPlay={onAudioPlay}
                    onTimeUpdate={onButtonTimeUpdate}
                    onStop={onButtonStop}
                    speed={effectiveSpeed}
                  />
                  {onSpeedCycle && (
                    <CardSpeedBadge
                      override={override ?? null}
                      generalSpeed={generalSpeed}
                      onCycle={(next) =>
                        onSpeedCycle(translation.language, next)
                      }
                      variant={speedBadgeVariant}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {baseTranslations.length === 0 && (
            // dir="auto": no language code in scope for the raw source text;
            // first-strong-character detection handles RTL sources.
            // text-left keeps RTL sources flush with the LTR layout.
            <p dir="auto" className={compact ? 'text-base leading-relaxed text-left' : 'body-large text-left'}>{sourceText}</p>
          )}
        </div>

        <Separator />

        {children({ baseTranslations, targetTranslations })}
      </div>

      {showProgressBar && audioRef && onSeek && (
        <AudioProgressBar
          audioRef={audioRef}
          durationSec={durationSec ?? 0}
          isPlaying={isPlaying ?? false}
          onSeek={onSeek}
          isMerging={isMerging ?? false}
          languageCues={languageCues}
        />
      )}
    </div>
  );

  if (bare) return cardSurface;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16 lg:pb-6 space-y-4">
        {cardSurface}
      </div>
    </main>
  );
}
