'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CircleCheck, EyeOff } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AudioButton } from './AudioButton';
import type { SchedulingPhase } from '@/lib/scheduling';
import type { CardTranslation, CardAudioRecording } from './types';

interface LearningCardContentProps {
  phase: SchedulingPhase;
  preReviewCount: number;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  onMaster: () => void;
  onHide: () => void;
}

export function LearningCardContent({
  phase,
  preReviewCount,
  sourceText,
  translations,
  audioRecordings,
  onMaster,
  onHide,
}: LearningCardContentProps) {
  const t = useTranslations('LearningMode');
  const baseTranslations = translations.filter((tr) => tr.isBaseLanguage);
  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="card-surface">
          {/* Card top bar: metadata left, actions right */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {t(`phase.${phase}`)}
              </Badge>
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
                    onClick={onMaster}
                    className="h-8 w-8 text-muted-foreground hover:text-success hover:bg-green-50 dark:hover:bg-green-950/30"
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
                    className="h-8 w-8 text-muted-foreground hover:text-warning hover:bg-orange-50 dark:hover:bg-orange-950/30"
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
                return (
                  <div
                    key={translation.language}
                    className="flex items-start gap-2"
                  >
                    <p className="flex-1 body-large">
                      {translation.text || '...'}
                    </p>
                    <AudioButton
                      url={audio?.url ?? null}
                      language={translation.language.toUpperCase()}
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
