'use client';

import { useCallback, useState } from 'react';
import { useMutation, usePreloadedQuery, Preloaded } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  CollectionCarouselUI,
  type CollectionProgressItem,
} from './CollectionCarouselUI';
import { CollectionDetailDialog } from './CollectionDetailDialog';
import { useCollectionDetail } from './useCollectionDetail';

export function CustomCollectionCarousel({
  preloadedCourseSettings,
  preloadedCustomCollectionsProgress,
  onNavigateToContent,
  onNavigateToChat,
}: {
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedCustomCollectionsProgress: Preloaded<
    typeof api.features.decks.getCustomCollectionsProgress
  >;
  onNavigateToContent: () => void;
  onNavigateToChat: () => void;
}) {
  const t = useTranslations('AppPage.collections');
  const tApp = useTranslations('AppPage');
  const [carouselReady, setCarouselReady] = useState(false);
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const activeCourseId = courseSettings?.courseId ?? null;
  const selectedIds = (courseSettings?.activeCustomCollectionIds ?? []).map(
    (id) => id.toString(),
  );

  const customCollections = usePreloadedQuery(preloadedCustomCollectionsProgress);
  const toggleMutation = useMutation(
    api.features.decks.toggleCustomCollection,
  );

  const items: CollectionProgressItem[] = customCollections.map(
    (c) => ({
      collectionId: c.collectionId,
      collectionName: c.collectionName,
      cardsAdded: c.cardsAdded,
      totalTexts: c.totalTexts,
    }),
  );

  const {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    contentData,
    isAdding,
    handleAddCards,
  } = useCollectionDetail({ collections: items, activeCourseId });

  const handleToggleCollection = useCallback(
    async (collectionId: string) => {
      try {
        await toggleMutation({
          collectionId: collectionId as Id<'collections'>,
        });
      } catch {
        toast.error(t('carousel.failedToSelect'));
      }
    },
    [toggleMutation, t],
  );

  // Empty state: no custom collections yet
  if (customCollections.length === 0) {
    const emptyStateDescription = t('customCarousel.emptyState', {
      content: tApp('views.content'),
      chat: tApp('views.chat'),
    });

    return (
      <div className="space-y-2">
        <h2 className="heading-section">
          {t('customCarousel.sectionTitle')}
        </h2>
        <div className="rounded-xl border border-dashed border-border bg-card p-4 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-stretch gap-4 md:gap-0">
            <div className="flex-[2] min-w-0 md:pr-6 flex items-center">
              <p className="text-muted-sm text-left">
                {emptyStateDescription}
              </p>
            </div>
            <div
              className="md:hidden h-px w-full shrink-0 bg-border"
              aria-hidden
            />
            <div
              className="hidden md:block w-px shrink-0 bg-border self-stretch min-h-[4.5rem]"
              aria-hidden
            />
            <div className="flex-1 min-w-0 md:pl-6 flex flex-col gap-2 justify-center">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={onNavigateToContent}
              >
                {t('customCarousel.customContentButton')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={onNavigateToChat}
              >
                {tApp('views.chat')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', !carouselReady && 'invisible')}>
      <h2 className="heading-section">
        {t('customCarousel.sectionTitle')}
      </h2>
      <CollectionCarouselUI
        collections={items}
        activeCollectionIds={selectedIds}
        onSelectCollection={handleToggleCollection}
        onOpenCollection={setOpenCollectionId}
        onAddCards={(collectionId) => handleAddCards(collectionId)}
        isAdding={isAdding}
        isLoading={false}
        onReady={() => setCarouselReady(true)}
        showToggleWhenComplete
      />

      <CollectionDetailDialog
        open={openCollectionId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCollectionId(null);
        }}
        collectionName={openedCollection?.collectionName ?? null}
        totalTexts={openedCollection?.totalTexts ?? 0}
        cardsAdded={openedCollection?.cardsAdded ?? 0}
        isActive={selectedIds.includes(openCollectionId ?? '')}
        isComplete={isOpenedComplete}
        texts={contentData?.texts ?? []}
        isLoadingTexts={contentData === undefined && !isOpenedComplete}
        isAdding={isAdding}
        onSelect={() => {
          if (openCollectionId) handleToggleCollection(openCollectionId);
        }}
        onAddCards={() => handleAddCards()}
        showToggleWhenComplete
      />
    </div>
  );
}
