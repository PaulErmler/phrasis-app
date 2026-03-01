'use client';

import { useState, useCallback } from 'react';
import { usePreloadedQuery, useMutation, Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CollectionCarouselUI,
  type CollectionProgressItem,
} from './CollectionCarouselUI';
import { CollectionDetailDialog } from './CollectionDetailDialog';
import { useCollectionDetail } from './useCollectionDetail';

export function CollectionCarousel({
  preloadedCollectionProgress,
  preloadedCourseSettings,
}: {
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
}) {
  const t = useTranslations('AppPage.collections.carousel');
  const [optimisticActiveId, setOptimisticActiveId] = useState<string | null>(
    null,
  );

  const collectionProgress = usePreloadedQuery(preloadedCollectionProgress);
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const setActiveCollection = useMutation(
    api.features.decks.setActiveCollection,
  );

  const activeCollectionId =
    optimisticActiveId ?? courseSettings?.activeCollectionId ?? null;
  const activeCourseId = courseSettings?.courseId ?? null;

  const items: CollectionProgressItem[] | undefined = collectionProgress?.map(
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

  const initialScrollIndex =
    collectionProgress && activeCollectionId
      ? collectionProgress.findIndex(
          (c) => c.collectionId === activeCollectionId,
        )
      : undefined;

  const handleSelectCollection = useCallback(
    async (collectionId: string) => {
      if (collectionId === activeCollectionId) return;
      setOptimisticActiveId(collectionId);
      try {
        await setActiveCollection({
          collectionId: collectionId as Id<'collections'>,
        });
      } catch (error) {
        console.error('Error setting active collection:', error);
        toast.error(
          error instanceof Error ? error.message : t('failedToSelect'),
        );
      } finally {
        setOptimisticActiveId(null);
      }
    },
    [setActiveCollection, t, activeCollectionId],
  );

  if (!collectionProgress || !courseSettings) {
    return (
      <CollectionCarouselUI
        collections={[]}
        activeCollectionIds={[]}
        onSelectCollection={() => {}}
        onOpenCollection={() => {}}
        isLoading={true}
      />
    );
  }

  if (collectionProgress.length === 0) {
    return null;
  }

  return (
    <>
      <CollectionCarouselUI
        collections={items!}
        activeCollectionIds={activeCollectionId ? [activeCollectionId] : []}
        onSelectCollection={handleSelectCollection}
        onOpenCollection={setOpenCollectionId}
        isLoading={false}
        initialScrollIndex={
          initialScrollIndex !== undefined && initialScrollIndex >= 0
            ? initialScrollIndex
            : undefined
        }
      />

      <CollectionDetailDialog
        open={openCollectionId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCollectionId(null);
        }}
        collectionName={openedCollection?.collectionName ?? null}
        totalTexts={openedCollection?.totalTexts ?? 0}
        cardsAdded={openedCollection?.cardsAdded ?? 0}
        isActive={activeCollectionId === openCollectionId}
        isComplete={isOpenedComplete}
        texts={contentData?.texts ?? []}
        isLoadingTexts={contentData === undefined && !isOpenedComplete}
        isAdding={isAdding}
        onSelect={() => {
          if (openCollectionId) handleSelectCollection(openCollectionId);
        }}
        onAddCards={handleAddCards}
      />
    </>
  );
}
