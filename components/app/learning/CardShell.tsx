'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AudioButton } from './AudioButton';
import { CardActionsMenu, type CardActionsMenuProps } from './CardActionsMenu';
import { CardSpeedBadge } from './CardSpeedBadge';
import { ClickableWords } from './ClickableWords';
import type { CardTranslation, CardAudioRecording } from './types';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import type { PinnableCardAction } from '@/lib/cardActions';

interface CardShellProps {
  reviewCount: number;
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
  /** Karaoke word highlighting toggle (from courseSettings). */
  highlightEnabled?: boolean;
  /** Active per-language playback from an AudioButton; null when none. */
  activeClip?: ButtonPlaybackActive | null;
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
  /** Badge behavior — `ephemeral` hides the null/default slot and greys 1.0. */
  speedBadgeVariant?: 'persistent' | 'ephemeral';
  children: (ctx: {
    baseTranslations: CardTranslation[];
    targetTranslations: CardTranslation[];
  }) => ReactNode;
}

export function CardShell({
  reviewCount,
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
  highlightEnabled = false,
  activeClip = null,
  onButtonTimeUpdate,
  onButtonStop,
  languagePlaybackSpeeds,
  audioSpeedOverrides,
  onSpeedCycle,
  speedBadgeVariant,
  children,
}: CardShellProps) {
  const t = useTranslations('LearningMode');
  const baseTranslations = translations.filter((tr) => tr.isBaseLanguage);
  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);
  const masterActive = isMastered || isPendingMaster;
  const hideActive = isHidden || isPendingHide;

  const cardSurface = (
    <div className="card-surface" data-tutorial="card-flashcard">
      {/* Card top bar: metadata left, actions right */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {t('reviewCount', { count: reviewCount })}
          </Badge>
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
      <div className="px-6 pb-6 space-y-4">
        {/* Base language texts */}
        <div className="space-y-2" data-tutorial="base-languages">
          {baseTranslations.map((translation) => {
            const audio = audioRecordings.find(
              (a) => a.language === translation.language,
            );
            const isActive = activeClip?.language === translation.language;
            const override = audioSpeedOverrides?.[translation.language];
            const isEphemeral = speedBadgeVariant === 'ephemeral';
            // Ephemeral surfaces ignore the course-level general speed — the
            // resting state is always 1.0, same as what the badge renders.
            const generalSpeed = isEphemeral
              ? DEFAULT_PLAYBACK_SPEED
              : (languagePlaybackSpeeds?.[translation.language] ??
                DEFAULT_PLAYBACK_SPEED);
            const effectiveSpeed = override ?? generalSpeed;
            return (
              <div
                key={translation.language}
                className="flex items-start gap-2"
              >
                <div className="flex-1">
                  <ClickableWords
                    text={translation.text || '...'}
                    language={translation.language}
                    wordTimings={audio?.wordTimings ?? null}
                    localTime={activeClip?.localTime ?? 0}
                    isActive={!!isActive}
                    enabled={highlightEnabled}
                    className={bare ? 'body-large' : 'body-large font-medium'}
                  />
                  {showRomanization && translation.romanization && (
                    <p className="text-romanization">
                      {translation.romanization}
                    </p>
                  )}
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
            <p className={bare ? 'body-large' : 'body-large font-medium'}>
              {sourceText}
            </p>
          )}
        </div>

        <Separator />

        {children({ baseTranslations, targetTranslations })}
      </div>
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
