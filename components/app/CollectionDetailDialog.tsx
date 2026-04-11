'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, Plus, Loader2, CheckCircle2, Lock, Layers, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCollectionDescription } from './CollectionCarouselUI';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { getLanguageShortLabel } from '@/lib/languages';
import { useTranslations } from 'next-intl';

interface Translation {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
}

interface AudioRecording {
  language: string;
  voiceName: string | null;
  url: string | null;
}

export interface PreviewText {
  _id: string;
  text: string;
  sourceLanguage: string;
  translations: Translation[];
  audioRecordings: AudioRecording[];
}

interface CollectionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string | null;
  totalTexts: number;
  cardsAdded: number;
  isActive: boolean;
  isComplete: boolean;
  texts: PreviewText[];
  isLoadingTexts: boolean;
  isAdding: boolean;
  onSelect: () => void;
  onAddCards: () => void;
  /** When true, hides the "Add N Cards" button and next sentences header */
  hideAddCards?: boolean;
  /** Remaining sentences quota. null means unlimited. */
  sentencesRemaining?: number | null;
  /** Called when the user clicks the upgrade button (limit reached). */
  onUpgrade?: () => void;
  /** When true, show toggle button even when collection is complete (for custom collections) */
  showToggleWhenComplete?: boolean;
}

export function CollectionDetailDialog({
  open,
  onOpenChange,
  collectionName,
  totalTexts,
  cardsAdded,
  isActive,
  isComplete,
  texts,
  isLoadingTexts,
  isAdding,
  onSelect,
  onAddCards,
  hideAddCards = false,
  sentencesRemaining,
  onUpgrade,
  showToggleWhenComplete = false,
}: CollectionDetailDialogProps) {
  const t = useTranslations('AppPage.collections.carousel.detail');
  const tDesc = useTranslations('AppPage.collections.carousel.descriptions');

  if (!collectionName) return null;

  const progress = totalTexts > 0 ? (cardsAdded / totalTexts) * 100 : 0;
  const remaining = totalTexts - cardsAdded;
  const isCompleteProgress = cardsAdded >= totalTexts && totalTexts > 0;
  const description = getCollectionDescription(collectionName, (key) =>
    tDesc(key),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden" data-tutorial="collection-detail">
        {/* Progress accent bar */}
        <div className="h-1.5 bg-muted rounded-t-lg overflow-hidden">
          <div
            className={cn(
              'h-full transition-all',
              isCompleteProgress ? 'bg-green-500' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Static header section */}
        <div className="flex-shrink-0 p-6 pb-4 space-y-4">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="heading-dialog">{collectionName}</DialogTitle>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {cardsAdded} / {totalTexts} {t('sentences')}
              </span>
            </div>
            <DialogDescription className="text-sm leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>

          {/* Stats row */}
          <div className="flex gap-3 text-xs">
            <div className="flex items-center gap-1">
              <Layers className="h-3 w-3 text-muted-foreground" />
              <span>{cardsAdded} {t('added')}</span>
            </div>
            <div className="flex items-center gap-1">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
              <span>{remaining} {t('remaining')}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            {(!isComplete || showToggleWhenComplete) ? (
              <Button
                variant={isActive ? 'secondary' : 'outline'}
                className="justify-center"
                onClick={onSelect}
              >
                {isActive && <Check className="h-4 w-4" />}
                {isActive ? t('selected') : t('select')}
              </Button>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-sm text-success font-medium">
                <CheckCircle2 className="h-5 w-5" />
                {t('done')}
              </div>
            )}
            {!isComplete && !hideAddCards && (
              sentencesRemaining === 0 ? (
                <Button
                  onClick={onUpgrade}
                  className="justify-center gap-1.5"
                >
                  <Lock className="h-4 w-4" />
                  Upgrade
                </Button>
              ) : (
                <Button
                  disabled={isAdding}
                  onClick={onAddCards}
                  className="justify-center min-w-[7.5rem] transition-colors"
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('adding')}
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      {t('addN', {
                        count: Math.min(
                          texts.length,
                          Math.max(0, totalTexts - cardsAdded),
                          ...(sentencesRemaining != null ? [sentencesRemaining] : []),
                        ),
                      })}
                    </>
                  )}
                </Button>
              )
            )}
          </div>
        </div>

        {/* Scrollable sentences section */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isComplete ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
              <p className="text-sm font-medium">{t('allCardsAdded')}</p>
            </div>
          ) : isLoadingTexts ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="content-box p-4 space-y-2">
                  <Skeleton className="h-5 w-3/4 rounded" />
                  <Separator />
                  <Skeleton className="h-5 w-2/3 rounded" />
                </div>
              ))}
            </div>
          ) : texts.length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
              <p className="text-sm font-medium">{t('noMoreCards')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {texts.map((text) => {
                const baseTranslations = text.translations.filter(
                  (tr) => tr.isBaseLanguage,
                );
                const targetTranslations = text.translations.filter(
                  (tr) => tr.isTargetLanguage,
                );

                return (
                  <div
                    key={text._id}
                    className="content-box p-4 space-y-2"
                  >
                    {/* Base language translations */}
                    <div className="space-y-1">
                      {baseTranslations.map((translation) => {
                        const audio = text.audioRecordings.find(
                          (a) => a.language === translation.language,
                        );
                        return (
                          <div
                            key={translation.language}
                            className="flex items-start gap-2"
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium leading-relaxed">
                                {translation.text || '...'}
                              </p>
                              {translation.romanization && (
                                <p className="text-romanization">
                                  {translation.romanization}
                                </p>
                              )}
                            </div>
                            <AudioButton
                              url={audio?.url ?? null}
                              language={getLanguageShortLabel(translation.language)}
                            />
                          </div>
                        );
                      })}
                      {baseTranslations.length === 0 && (
                        <p className="text-sm font-medium leading-relaxed">
                          {text.text}
                        </p>
                      )}
                    </div>

                    <Separator />

                    {/* Target language translations */}
                    <div className="space-y-1">
                      {targetTranslations.map((translation) => {
                        const audio = text.audioRecordings.find(
                          (a) => a.language === translation.language,
                        );
                        return (
                          <div
                            key={translation.language}
                            className="flex items-start gap-2"
                          >
                            <div className="flex-1">
                              <p className="text-sm leading-relaxed">
                                {translation.text || '...'}
                              </p>
                              {translation.romanization && (
                                <p className="text-romanization">
                                  {translation.romanization}
                                </p>
                              )}
                            </div>
                            <AudioButton
                              url={audio?.url ?? null}
                              language={getLanguageShortLabel(translation.language)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
