'use client';

import { useEffect, useState } from 'react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export interface CollectionProgressItem {
  collectionId: string;
  collectionName: string;
  cardsAdded: number;
  totalTexts: number;
}

/** Generate a human-readable CEFR description using i18n, with fallback. */
export function getCollectionDescription(
  name: string,
  t?: (key: string) => string,
): string {
  if (t) {
    return t(name);
  }
  // Fallback if no translation function is provided
  const descriptions: Record<string, string> = {
    Essential: 'The most essential survival sentences',
    A1: 'Sentences with vocabulary at CEFR A1 Level',
    A2: 'Sentences with vocabulary at CEFR A2 Level',
    B1: 'Sentences with vocabulary at CEFR B1 Level',
    B2: 'Sentences with vocabulary at CEFR B2 Level',
    C1: 'Sentences with vocabulary at CEFR C1 Level',
    C2: 'Sentences with vocabulary at CEFR C2 Level',
  };
  return descriptions[name] ?? `${name} collection`;
}

interface CollectionCarouselUIProps {
  collections: CollectionProgressItem[];
  activeCollectionId: string | null;
  onSelectCollection: (collectionId: string) => void;
  onOpenCollection: (collectionId: string) => void;
  isLoading?: boolean;
  /** Index to scroll to on first render (e.g. active collection index) */
  initialScrollIndex?: number;
}

export function CollectionCarouselUI({
  collections,
  activeCollectionId,
  onSelectCollection,
  onOpenCollection,
  isLoading = false,
  initialScrollIndex,
}: CollectionCarouselUIProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [currentSnap, setCurrentSnap] = useState(0);
  const [snapCount, setSnapCount] = useState(0);
  const [hasScrolledInitial, setHasScrolledInitial] = useState(false);
  const t = useTranslations('AppPage.collections.carousel');

  // Track dot indicator state
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setCurrentSnap(api.selectedScrollSnap());
      setSnapCount(api.scrollSnapList().length);
    };

    onSelect();
    api.on('select', onSelect);
    api.on('reInit', onSelect);

    return () => {
      api.off('select', onSelect);
      api.off('reInit', onSelect);
    };
  }, [api]);

  // Scroll to initial index once on mount
  useEffect(() => {
    if (!api || hasScrolledInitial || initialScrollIndex === undefined) return;
    if (initialScrollIndex >= 0) {
      setTimeout(() => api.scrollTo(initialScrollIndex, true), 50);
    }
    setHasScrolledInitial(true);
  }, [api, initialScrollIndex, hasScrolledInitial]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-4 overflow-hidden">
          {[1, 2].map((i) => (
            <Skeleton
              key={i}
              className="h-48 min-w-[85%] sm:min-w-[48%] md:min-w-[32%] rounded-xl"
            />
          ))}
        </div>
      </div>
    );
  }

  if (collections.length === 0) return null;

  return (
    <div className="space-y-3">
      <Carousel
        setApi={setApi}
        opts={{
          align: 'start',
          loop: false,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {collections.map((collection) => {
            const progress =
              collection.totalTexts > 0
                ? (collection.cardsAdded / collection.totalTexts) * 100
                : 0;
            const isComplete =
              collection.cardsAdded >= collection.totalTexts &&
              collection.totalTexts > 0;
            const isActive = activeCollectionId === collection.collectionId;
            const hasStarted = collection.cardsAdded > 0;

            return (
              <CarouselItem
                key={collection.collectionId}
                className="pl-4 basis-[85%] sm:basis-[48%] md:basis-[48%] lg:basis-[45%]"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenCollection(collection.collectionId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenCollection(collection.collectionId);
                    }
                  }}
                  className={cn(
                    'w-full text-left rounded-xl border p-5 transition-all cursor-pointer h-[200px] flex flex-col',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'hover:shadow-md',
                    isActive && !isComplete && 'border-2 border-current',
                    isComplete && 'opacity-50',
                  )}
                >
                  {/* Header: title + select button */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="heading-section">
                      {collection.collectionName}
                    </h3>
                    {!isComplete && (
                      <Button
                        size="sm"
                        variant={isActive ? 'default' : 'outline'}
                        className="shrink-0 text-xs h-8 px-3"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isActive) {
                            onSelectCollection(collection.collectionId);
                          }
                        }}
                      >
                        {isActive && <Check className="h-3.5 w-3.5 mr-1" />}
                        {isActive ? t('selected') : t('select')}
                      </Button>
                    )}
                    {isComplete && (
                      <div className="flex items-center gap-1 text-xs text-success font-medium shrink-0">
                        <Check className="h-4 w-4" />
                        {t('done')}
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-muted-sm leading-relaxed mb-4 line-clamp-2 flex-shrink-0">
                    {getCollectionDescription(
                      collection.collectionName,
                      (key) => t(`descriptions.${key}`),
                    )}
                  </p>

                  {/* Spacer to push footer to bottom */}
                  <div className="flex-1" />

                  {/* Card count + Progress (pinned to bottom) */}
                  <div>
                    <p className="text-base mb-1">
                      {t('cards', {
                        count: collection.totalTexts.toLocaleString(),
                      })}
                    </p>

                    {hasStarted ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">
                            {collection.cardsAdded} / {collection.totalTexts}
                          </span>
                        </div>
                        <Progress value={progress} className="h-2" />
                      </div>
                    ) : (
                      <p className="text-muted-sm">{t('notStarted')}</p>
                    )}
                  </div>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>

      {/* Dot indicators */}
      {snapCount > 1 && (
        <div className="flex justify-center gap-1.5 pt-1">
          {Array.from({ length: snapCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => api?.scrollTo(i)}
              className={cn(
                'rounded-full transition-all',
                i === currentSnap
                  ? 'w-6 h-2.5 bg-foreground'
                  : 'w-2.5 h-2.5 bg-muted-foreground/30',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
