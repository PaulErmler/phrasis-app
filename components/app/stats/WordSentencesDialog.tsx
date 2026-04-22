'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePaginatedQuery, useMutation, usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import { HighlightedText } from '@/components/app/learning/HighlightedText';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { normalizeLanguageCode } from '@/lib/languages';
import { Badge } from '@/components/ui/badge';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { CardActionsMenu } from '@/components/app/learning/CardActionsMenu';
import { CardSpeedBadge } from '@/components/app/learning/CardSpeedBadge';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import type { CardTranslation } from '@/components/app/learning/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import { Loader2 } from 'lucide-react';
import { useEnsureContent } from '@/hooks/use-ensure-content';

export function WordSentencesDialog({
  word,
  displayWord,
  language,
  open,
  onOpenChange,
}: {
  word: string;
  displayWord: string;
  language: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('LearningMode');
  const { preloadedCourseSettings } = useAppData();
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const highlightEnabled = courseSettings?.highlightWords !== false;
  const buttonPlayback = useButtonPlayback();

  // Ephemeral per-card per-language speed overrides. This dialog is a
  // preview surface launched from the word cloud, so speed changes are not
  // persisted: they reset the next time the dialog opens. Keyed by cardId
  // with a nested language→speed map.
  const [ephemeralOverrides, setEphemeralOverrides] = useState<
    Record<string, Record<string, number>>
  >({});

  const handleSpeedCycle = useCallback(
    (cardId: Id<'cards'>, lang: string, next: number | null) => {
      setEphemeralOverrides((prev) => {
        const cardMap = { ...(prev[cardId] ?? {}) };
        if (next === null) delete cardMap[lang];
        else cardMap[lang] = next;
        return { ...prev, [cardId]: cardMap };
      });
    },
    [],
  );

  const { results, status, loadMore } = usePaginatedQuery(
    api.features.stats.getSentencesForWord,
    open ? { word, language } : 'skip',
    { initialNumItems: 10 },
  );

  // Trigger on-demand regeneration for any sentence whose card content is missing.
  useEnsureContent(
    open
      ? results.map((r) => ({
        textId: r.textId as string,
        hasMissingContent: r.hasMissingContent,
      }))
      : undefined,
  );

  const masterCard = useMutation(api.features.scheduling.masterCard);
  const unmasterCard = useMutation(api.features.scheduling.unmasterCard);
  const hideCard = useMutation(api.features.scheduling.hideCard);
  const unhideCard = useMutation(api.features.scheduling.unhideCard);
  const toggleFavorite = useMutation(api.features.scheduling.toggleFavoriteCard);
  const deleteCard = useMutation(api.features.scheduling.deleteCardPermanently);

  const [editingCard, setEditingCard] = useState<{
    cardId: Id<'cards'>;
    translations: CardTranslation[];
  } | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<Id<'cards'> | null>(null);

  const [pendingMaster, setPendingMaster] = useState<Set<string>>(new Set());
  const [pendingHide, setPendingHide] = useState<Set<string>>(new Set());
  // Override map for favorite. Unlike master/hide (one-way toggles), favorite
  // flips both ways, so we track the effective value instead of "is pending".
  const [favoriteOverride, setFavoriteOverride] = useState<
    Map<string, boolean>
  >(new Map());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const prevResultsLength = useRef(0);

  // Clear loading state when new results arrive
  useEffect(() => {
    if (results.length > prevResultsLength.current && isLoadingMore) {
      setIsLoadingMore(false);
    }
    prevResultsLength.current = results.length;
  }, [results.length, isLoadingMore]);

  // Also clear if we've exhausted all results
  useEffect(() => {
    if (status === 'Exhausted') setIsLoadingMore(false);
  }, [status]);

  const handleLoadMore = useCallback(() => {
    setIsLoadingMore(true);
    loadMore(10);
  }, [loadMore]);

  const handleToggleMaster = async (
    cardId: Id<'cards'>,
    currentlyMastered: boolean,
  ) => {
    setPendingMaster((prev) => new Set(prev).add(cardId));
    try {
      if (currentlyMastered) {
        await unmasterCard({ cardId });
      } else {
        await masterCard({ cardId });
      }
    } finally {
      setPendingMaster((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    }
  };

  const handleToggleHide = async (
    cardId: Id<'cards'>,
    currentlyHidden: boolean,
  ) => {
    setPendingHide((prev) => new Set(prev).add(cardId));
    try {
      if (currentlyHidden) {
        await unhideCard({ cardId });
      } else {
        await hideCard({ cardId });
      }
    } finally {
      setPendingHide((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    }
  };

  const handleToggleFavorite = useCallback(
    async (cardId: Id<'cards'>, currentlyFavorite: boolean) => {
      const nextValue = !currentlyFavorite;
      setFavoriteOverride((prev) => {
        const next = new Map(prev);
        next.set(cardId, nextValue);
        return next;
      });
      try {
        await toggleFavorite({ cardId });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
        setFavoriteOverride((prev) => {
          const next = new Map(prev);
          next.set(cardId, currentlyFavorite);
          return next;
        });
      }
    },
    [toggleFavorite],
  );

  const handleConfirmDelete = useCallback(async () => {
    const cardId = deletingCardId;
    if (!cardId) return;
    setDeletingCardId(null);
    try {
      await deleteCard({ cardId });
    } catch (error) {
      console.error('Failed to delete card:', error);
    }
  }, [deletingCardId, deleteCard]);

  const normalizedLang = normalizeLanguageCode(language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] flex flex-col sm:max-w-md p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3">
          <DialogTitle>{displayWord}</DialogTitle>
          <DialogDescription className="sr-only">
            Sentences containing the word {displayWord}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-6">
          <div className="space-y-4">
            {status === 'LoadingFirstPage' && (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
            {results.map((sentence) => {
              const baseTranslations = sentence.translations.filter(
                (t) => t.isBaseLanguage && t.text,
              );
              const targetTranslations = sentence.translations.filter(
                (t) => t.isTargetLanguage && t.text,
              );

              const cardId = sentence.cardId as Id<'cards'> | null;
              const isMastered = sentence.isMastered || (cardId ? pendingMaster.has(cardId) : false);
              const isHidden = sentence.isHidden || (cardId ? pendingHide.has(cardId) : false);
              const isFavorite = cardId && favoriteOverride.has(cardId)
                ? (favoriteOverride.get(cardId) as boolean)
                : (sentence.isFavorite ?? false);

              return (
                <div key={sentence.textId} className="content-box p-4 space-y-2">
                  {/* Card actions row */}
                  {cardId && (
                    <div className="flex items-center justify-between -mt-1 -mx-1 mb-1">
                      <Badge variant="secondary" className="text-xs">
                        {sentence.reviewCount} Reviews
                      </Badge>
                      <CardActionsMenu
                        isFavorite={isFavorite}
                        isMastered={isMastered}
                        isHidden={isHidden}
                        onFavorite={() =>
                          handleToggleFavorite(cardId, isFavorite)
                        }
                        onMaster={() => handleToggleMaster(cardId, isMastered)}
                        onHide={() => handleToggleHide(cardId, isHidden)}
                        onEdit={() =>
                          setEditingCard({
                            cardId,
                            translations: sentence.translations,
                          })
                        }
                        onDelete={() => setDeletingCardId(cardId)}
                        triggerClassName="h-7 w-7"
                        triggerIconClassName="h-3.5 w-3.5"
                      />
                    </div>
                  )}

                  {/* Base language translations */}
                  <div className="space-y-1">
                    {baseTranslations.map((tr) => {
                      const audio = sentence.audioRecordings.find(
                        (a) => a.language === tr.language,
                      );
                      const isWordLanguage =
                        normalizeLanguageCode(tr.language) === normalizedLang;
                      const isActive =
                        buttonPlayback.active?.language === tr.language;
                      const override = cardId
                        ? (ephemeralOverrides[cardId]?.[tr.language] ?? null)
                        : null;
                      // Ephemeral surface: ignore the course-level general speed.
                      const effectiveSpeed = override ?? DEFAULT_PLAYBACK_SPEED;
                      return (
                        <div key={tr.language} className="flex items-start gap-2">
                          <div className="flex-1">
                            <HighlightedText
                              text={tr.text}
                              wordTimings={audio?.wordTimings ?? null}
                              localTime={buttonPlayback.active?.localTime ?? 0}
                              isActive={isActive}
                              enabled={highlightEnabled}
                              className="text-sm font-medium leading-relaxed"
                              highlightTerm={isWordLanguage ? word : undefined}
                            />
                            {tr.romanization && (
                              <p className="text-romanization">
                                {tr.romanization}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <AudioButton
                              url={audio?.url ?? null}
                              language={tr.language}
                              onTimeUpdate={buttonPlayback.onTimeUpdate}
                              onStop={buttonPlayback.onStop}
                              speed={effectiveSpeed}
                            />
                            {cardId && (
                              <CardSpeedBadge
                                override={override}
                                generalSpeed={DEFAULT_PLAYBACK_SPEED}
                                onCycle={(next) =>
                                  handleSpeedCycle(cardId, tr.language, next)
                                }
                                variant="ephemeral"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Separator />

                  {/* Target language translations */}
                  <div className="space-y-1">
                    {targetTranslations.map((tr) => {
                      const audio = sentence.audioRecordings.find(
                        (a) => a.language === tr.language,
                      );
                      const isWordLanguage =
                        normalizeLanguageCode(tr.language) === normalizedLang;
                      const isActive =
                        buttonPlayback.active?.language === tr.language;
                      const override = cardId
                        ? (ephemeralOverrides[cardId]?.[tr.language] ?? null)
                        : null;
                      const effectiveSpeed = override ?? DEFAULT_PLAYBACK_SPEED;
                      return (
                        <div key={tr.language} className="flex items-start gap-2">
                          <div className="flex-1">
                            <HighlightedText
                              text={tr.text}
                              wordTimings={audio?.wordTimings ?? null}
                              localTime={buttonPlayback.active?.localTime ?? 0}
                              isActive={isActive}
                              enabled={highlightEnabled}
                              className="text-sm leading-relaxed"
                              highlightTerm={isWordLanguage ? word : undefined}
                            />
                            {tr.romanization && (
                              <p className="text-romanization">
                                {tr.romanization}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <AudioButton
                              url={audio?.url ?? null}
                              language={tr.language}
                              onTimeUpdate={buttonPlayback.onTimeUpdate}
                              onStop={buttonPlayback.onStop}
                              speed={effectiveSpeed}
                            />
                            {cardId && (
                              <CardSpeedBadge
                                override={override}
                                generalSpeed={DEFAULT_PLAYBACK_SPEED}
                                onCycle={(next) =>
                                  handleSpeedCycle(cardId, tr.language, next)
                                }
                                variant="ephemeral"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {results.length === 0 && status === 'Exhausted' && (
              <p className="text-sm text-muted-foreground">
                No sentences found for this word yet.
              </p>
            )}
            {(status === 'CanLoadMore' || isLoadingMore) && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                disabled={isLoadingMore}
                onClick={handleLoadMore}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      {editingCard && (
        <EditCardDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditingCard(null);
          }}
          cardId={editingCard.cardId}
          translations={editingCard.translations}
        />
      )}

      <AlertDialog
        open={deletingCardId !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingCardId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('actions.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('actions.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('actions.deleteConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={handleConfirmDelete}
            >
              {t('actions.deleteConfirmConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
