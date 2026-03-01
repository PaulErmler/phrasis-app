'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, usePreloadedQuery, Preloaded } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { MessageSquarePlus } from 'lucide-react';
import {
  CollectionCarouselUI,
  type CollectionProgressItem,
} from './CollectionCarouselUI';
import { CollectionDetailDialog } from './CollectionDetailDialog';
import { useCollectionDetail } from './useCollectionDetail';

export function CustomCollectionCarousel({
  preloadedCourseSettings,
}: {
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
}) {
  const t = useTranslations('AppPage.collections');
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const activeCourseId = courseSettings?.courseId ?? null;
  const selectedIds = (courseSettings?.activeCustomCollectionIds ?? []).map(
    (id) => id.toString(),
  );

  const customCollections = useQuery(
    api.features.decks.getCustomCollectionsProgress,
  );
  const toggleMutation = useMutation(
    api.features.decks.toggleCustomCollection,
  );

  const items: CollectionProgressItem[] | undefined = customCollections?.map(
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

  // Empty state: loaded but no custom collections yet
  if (customCollections && customCollections.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="heading-section">
          {t('customCarousel.sectionTitle')}
        </h2>
        <div className="rounded-xl border border-dashed p-6 text-center space-y-2">
          <MessageSquarePlus className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-muted-sm">
            {t('customCarousel.emptyState')}
          </p>
        </div>
      </div>
    );
  }

  // Still loading
  if (!customCollections) return null;

  return (
    <div className="space-y-2">
      <h2 className="heading-section">
        {t('customCarousel.sectionTitle')}
      </h2>
      <CollectionCarouselUI
        collections={items!}
        activeCollectionIds={selectedIds}
        onSelectCollection={handleToggleCollection}
        onOpenCollection={setOpenCollectionId}
        isLoading={false}
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
        onAddCards={handleAddCards}
      />
    </div>
  );
}
