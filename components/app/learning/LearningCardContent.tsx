'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CircleCheck, EyeOff, Star } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AudioButton } from './AudioButton';
import type { CardTranslation, CardAudioRecording } from './types';

interface LearningCardContentProps {
  preReviewCount: number;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  isFavorite: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  onMaster: () => void;
  onHide: () => void;
  onFavorite: () => void;
  onAudioPlay?: () => void;
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
  revealedLanguages?: ReadonlySet<string>;
}

export function LearningCardContent({
  preReviewCount,
  sourceText,
  translations,
  audioRecordings,
  isFavorite,
  isPendingMaster,
  isPendingHide,
  onMaster,
  onHide,
  onFavorite,
  onAudioPlay,
  hideTargetLanguages = false,
  autoRevealLanguages = false,
  revealedLanguages,
}: LearningCardContentProps) {
  const t = useTranslations('LearningMode');
  const baseTranslations = translations.filter((tr) => tr.isBaseLanguage);
  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);

  const [manuallyRevealed, setManuallyRevealed] = useState<Set<string>>(new Set());

  // Reset manual reveals when the card changes
  const translationKey = translations.map((tr) => tr.language + tr.text).join('|');
  const [prevTranslationKey, setPrevTranslationKey] = useState(translationKey);
  if (translationKey !== prevTranslationKey) {
    setPrevTranslationKey(translationKey);
    setManuallyRevealed(new Set());
  }

  const handleReveal = (language: string) => {
    setManuallyRevealed((prev) => {
      const next = new Set(prev);
      next.add(language);
      return next;
    });
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="card-surface">
          {/* Card top bar: metadata left, actions right */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {t('reviewCount', { count: preReviewCount })}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onFavorite}
                    className={`h-8 w-8 hover:bg-favorite/10 ${isFavorite ? 'text-favorite hover:text-favorite/80' : 'text-muted-foreground hover:text-favorite'}`}
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('actions.favorite')}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onMaster}
                    className={`h-8 w-8 hover:bg-success/10 ${isPendingMaster ? 'text-success hover:text-success/80' : 'text-muted-foreground hover:text-success'}`}
                  >
                    <CircleCheck className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('actions.master')}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onHide}
                    className={`h-8 w-8 hover:bg-destructive/10 ${isPendingHide ? 'text-destructive hover:text-destructive/80' : 'text-muted-foreground hover:text-destructive'}`}
                  >
                    <EyeOff className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('actions.hide')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Card text content */}
          <div className="px-6 pb-6 space-y-4">
            {/* Base language texts */}
            <div className="space-y-2">
              {baseTranslations.map((translation) => {
                const audio = audioRecordings.find(
                  (a) => a.language === translation.language,
                );
                return (
                  <div
                    key={translation.language}
                    className="flex items-start gap-2"
                  >
                    <p className="flex-1 body-large font-medium">
                      {translation.text || '...'}
                    </p>
                    <AudioButton
                      url={audio?.url ?? null}
                      language={translation.language.toUpperCase()}
                      onPlay={onAudioPlay}
                    />
                  </div>
                );
              })}
              {baseTranslations.length === 0 && (
                <p className="body-large font-medium">{sourceText}</p>
              )}
            </div>

            <Separator />

            {/* Target language texts */}
            <div className="space-y-2">
              {targetTranslations.map((translation) => {
                const audio = audioRecordings.find(
                  (a) => a.language === translation.language,
                );
                const isAudioRevealed = autoRevealLanguages && (revealedLanguages?.has(translation.language) ?? false);
                const isBlurred = hideTargetLanguages && !isAudioRevealed && !manuallyRevealed.has(translation.language);
                return (
                  <div
                    key={translation.language}
                    className="flex items-start gap-2"
                  >
                    <p
                      className={`flex-1 body-large ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                      onClick={isBlurred ? () => handleReveal(translation.language) : undefined}
                    >
                      {translation.text || '...'}
                    </p>
                    <AudioButton
                      url={audio?.url ?? null}
                      language={translation.language.toUpperCase()}
                      onPlay={onAudioPlay}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
