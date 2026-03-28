'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, Plus, Loader2, CheckCircle2, Lock } from 'lucide-react';
import { getCollectionDescription } from './CollectionCarouselUI';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { getLanguageShortLabel } from '@/lib/languages';
import { useTranslations } from 'next-intl';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { FEATURE_IDS } from '@/convex/features/featureIds';

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
}: CollectionDetailDialogProps) {
  const t = useTranslations('AppPage.collections.carousel.detail');
  const tDesc = useTranslations('AppPage.collections.carousel.descriptions');

  if (!collectionName) return null;

  const progress = totalTexts > 0 ? (cardsAdded / totalTexts) * 100 : 0;
  const description = getCollectionDescription(collectionName, (key) =>
    tDesc(key),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden" data-tutorial="collection-detail">
        {/* Static header section */}
        <div className="flex-shrink-0 p-6 pb-4 space-y-4">
          <DialogHeader>
            <DialogTitle className="heading-dialog">{collectionName}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>

          <Separator />

          <div className="flex items-center gap-3">
            <div className="flex-1 content-box space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-sm">{t('progress')}</span>
                <span className="text-sm font-bold">
                  {cardsAdded} / {totalTexts}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {!isComplete && (
              <Button
                variant={isActive ? 'secondary' : 'outline'}
                className="shrink-0 w-28 justify-center"
                onClick={onSelect}
              >
                {isActive && <Check className="h-4 w-4" />}
                {isActive ? t('selected') : t('select')}
              </Button>
            )}
            {isComplete && (
              <div className="flex items-center gap-1.5 text-sm text-success font-medium shrink-0 px-3">
                <CheckCircle2 className="h-5 w-5" />
                {t('done')}
              </div>
            )}
          </div>

          {!isComplete && !hideAddCards && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-semibold">
                    {t('nextSentences')}
                  </h4>
                  {sentencesRemaining !== undefined && (
                    <FeatureBadge featureId={FEATURE_IDS.SENTENCES} />
                  )}
                </div>
                {texts.length > 0 && (
                  sentencesRemaining === 0 ? (
                    <Button
                      size="sm"
                      onClick={onUpgrade}
                      className="justify-center gap-1.5"
                    >
                      <Lock className="h-4 w-4" />
                      Upgrade
                    </Button>
                  ) : (
                    <Button
                      size="sm"
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
                            count:
                              sentencesRemaining != null
                                ? Math.min(texts.length, sentencesRemaining)
                                : texts.length,
                          })}
                        </>
                      )}
                    </Button>
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* Scrollable sentences section */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isComplete ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
              <p className="text-sm font-medium">{t('allCardsAdded')}</p>
            </div>
          ) : (
            <>
              <Separator className="mb-4" />
              {isLoadingTexts ? (
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
                                    <p className="text-xs text-muted-foreground leading-tight mt-0.5">
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
                                    <p className="text-xs text-muted-foreground leading-tight mt-0.5">
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
