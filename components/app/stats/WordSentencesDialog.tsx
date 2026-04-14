'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { usePaginatedQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { getLanguageShortLabel } from '@/lib/languages';
import { CircleCheck, EyeOff, Star, Loader2 } from 'lucide-react';
import { useEnsureContent } from '@/hooks/use-ensure-content';

function highlightWord(text: string, word: string): React.ReactNode {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function normalizeLang(code: string): string {
  return code.replace(/_latam$/, '');
}

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
  const hideCard = useMutation(api.features.scheduling.hideCard);
  const toggleFavorite = useMutation(api.features.scheduling.toggleFavoriteCard);

  const [pendingMaster, setPendingMaster] = useState<Set<string>>(new Set());
  const [pendingHide, setPendingHide] = useState<Set<string>>(new Set());
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

  const handleMaster = async (cardId: Id<'cards'>) => {
    setPendingMaster((prev) => new Set(prev).add(cardId));
    try {
      await masterCard({ cardId });
    } finally {
      setPendingMaster((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    }
  };

  const handleHide = async (cardId: Id<'cards'>) => {
    setPendingHide((prev) => new Set(prev).add(cardId));
    try {
      await hideCard({ cardId });
    } finally {
      setPendingHide((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    }
  };

  const normalizedLang = normalizeLang(language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col sm:max-w-md p-0 gap-0 overflow-hidden">
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

              return (
                <div key={sentence.textId} className="content-box p-4 space-y-2">
                  {/* Card actions row */}
                  {cardId && (
                    <div className="flex items-center justify-between -mt-1 -mx-1 mb-1">
                      <Badge variant="secondary" className="text-xs">
                        {sentence.reviewCount} Reviews
                      </Badge>
                      <div className="flex items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleFavorite({ cardId })}
                              className={`h-7 w-7 hover:bg-favorite/10 ${sentence.isFavorite ? 'text-favorite hover:text-favorite/80' : 'text-muted-foreground hover:text-favorite'}`}
                            >
                              <Star className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Favorite</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleMaster(cardId)}
                              className={`h-7 w-7 hover:bg-success/10 ${isMastered ? 'text-success hover:text-success/80' : 'text-muted-foreground hover:text-success'}`}
                            >
                              <CircleCheck className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Master</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleHide(cardId)}
                              className={`h-7 w-7 hover:bg-destructive/10 ${isHidden ? 'text-destructive hover:text-destructive/80' : 'text-muted-foreground hover:text-destructive'}`}
                            >
                              <EyeOff className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Hide</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  )}

                  {/* Base language translations */}
                  <div className="space-y-1">
                    {baseTranslations.map((tr) => {
                      const audio = sentence.audioRecordings.find(
                        (a) => a.language === tr.language,
                      );
                      const isWordLanguage =
                        normalizeLang(tr.language) === normalizedLang;
                      return (
                        <div key={tr.language} className="flex items-start gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium leading-relaxed">
                              {isWordLanguage
                                ? highlightWord(tr.text, word)
                                : tr.text}
                            </p>
                            {tr.romanization && (
                              <p className="text-romanization">
                                {tr.romanization}
                              </p>
                            )}
                          </div>
                          <AudioButton
                            url={audio?.url ?? null}
                            language={getLanguageShortLabel(tr.language)}
                          />
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
                        normalizeLang(tr.language) === normalizedLang;
                      return (
                        <div key={tr.language} className="flex items-start gap-2">
                          <div className="flex-1">
                            <p className="text-sm leading-relaxed">
                              {isWordLanguage
                                ? highlightWord(tr.text, word)
                                : tr.text}
                            </p>
                            {tr.romanization && (
                              <p className="text-romanization">
                                {tr.romanization}
                              </p>
                            )}
                          </div>
                          <AudioButton
                            url={audio?.url ?? null}
                            language={getLanguageShortLabel(tr.language)}
                          />
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
    </Dialog>
  );
}
