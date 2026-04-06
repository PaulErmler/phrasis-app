'use client';

import { type ReactNode } from 'react';
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
import { LandingAudioButton } from '@/components/landing/LandingAudioButton';
import { getLanguageShortLabel } from '@/lib/languages';
import type { CardTranslation, CardAudioRecording } from '@/components/app/learning/types';

interface LandingCardShellProps {
  reviewCount: number;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  isFavorite: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  onMaster: () => void;
  onHide: () => void;
  onFavorite: () => void;
  bare?: boolean;
  showRomanization?: boolean;
  children: (ctx: {
    baseTranslations: CardTranslation[];
    targetTranslations: CardTranslation[];
  }) => ReactNode;
}

export function LandingCardShell({
  reviewCount,
  sourceText,
  translations,
  audioRecordings: _audioRecordings,
  isFavorite,
  isPendingMaster,
  isPendingHide,
  onMaster,
  onHide,
  onFavorite,
  bare = false,
  showRomanization = true,
  children,
}: LandingCardShellProps) {
  const t = useTranslations('LearningMode');
  const baseTranslations = translations.filter((tr) => tr.isBaseLanguage);
  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);

  const cardSurface = (
    <div className="card-surface" data-tutorial="card-flashcard">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {t('reviewCount', { count: reviewCount })}
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
            <TooltipContent side="bottom">{t('actions.favorite')}</TooltipContent>
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
            <TooltipContent side="bottom">{t('actions.master')}</TooltipContent>
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
            <TooltipContent side="bottom">{t('actions.hide')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="px-6 pb-6 space-y-4">
        <div className="space-y-2" data-tutorial="base-languages">
          {baseTranslations.map((translation) => {
            return (
              <div key={translation.language} className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="body-large font-medium">{translation.text || '...'}</p>
                  {showRomanization && translation.romanization && (
                    <p className="text-romanization">
                      {translation.romanization}
                    </p>
                  )}
                </div>
                <LandingAudioButton language={getLanguageShortLabel(translation.language)} />
              </div>
            );
          })}
          {baseTranslations.length === 0 && (
            <p className="body-large font-medium">{sourceText}</p>
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
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">{cardSurface}</div>
    </main>
  );
}
