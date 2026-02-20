'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  usePreloadedQuery,
  useQuery,
  useMutation,
  Preloaded,
} from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CollectionCarouselUI,
  type CollectionProgressItem,
} from './CollectionCarouselUI';
import { CollectionDetailDialog } from './CollectionDetailDialog';
import { COLLECTION_PREVIEW_SIZE } from '@/convex/lib/collections';

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
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [optimisticActiveId, setOptimisticActiveId] = useState<string | null>(
    null,
  );

  const collectionProgress = usePreloadedQuery(preloadedCollectionProgress);
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const setActiveCollection = useMutation(
    api.features.decks.setActiveCollection,
  );
  const addCardsFromCollection = useMutation(
    api.features.decks.addCardsFromCollection,
  );
  const ensureContent = useMutation(
    api.features.collections.ensureContentForCollection,
  );

  const activeCollectionId =
    optimisticActiveId ?? courseSettings?.activeCollectionId ?? null;

  // Find opened collection progress
  const openedCollection = collectionProgress?.find(
    (c) => c.collectionId === openCollectionId,
  );
  const isOpenedComplete = openedCollection
    ? openedCollection.cardsAdded >= openedCollection.totalTexts &&
      openedCollection.totalTexts > 0
    : false;

  // Query enriched texts for the opened collection
  const contentData = useQuery(
    api.features.collections.getCollectionTextsWithContent,
    openCollectionId && !isOpenedComplete
      ? { collectionId: openCollectionId as Id<'collections'> }
      : 'skip',
  );

  // Trigger content generation for missing translations/audio.
  // Keyed by courseId+collectionId so a course switch re-triggers generation.
  const ensuredRef = useRef<Set<string>>(new Set());
  const activeCourseId = courseSettings?.courseId ?? null;

  useEffect(() => {
    if (!contentData?.hasMissingContent || !openCollectionId || !activeCourseId)
      return;

    const key = `${activeCourseId}:${openCollectionId}`;
    if (ensuredRef.current.has(key)) return;

    ensuredRef.current.add(key);
    ensureContent({
      collectionId: openCollectionId as Id<'collections'>,
    }).catch(() => {
      ensuredRef.current.delete(key);
    });
  }, [contentData, openCollectionId, activeCourseId, ensureContent]);

  // Compute initial scroll index (active collection position)
  const initialScrollIndex =
    collectionProgress && activeCollectionId
      ? collectionProgress.findIndex(
        (c) => c.collectionId === activeCollectionId,
      )
      : undefined;

  const handleSelectCollection = useCallback(
    async (collectionId: string) => {
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
    [setActiveCollection, t],
  );

  const handleAddCards = useCallback(async () => {
    if (!openCollectionId) return;

    setIsAdding(true);
    try {
      const result = await addCardsFromCollection({
        collectionId: openCollectionId as Id<'collections'>,
        batchSize: COLLECTION_PREVIEW_SIZE,
      });

      // Allow re-triggering ensure for this collection after adding cards,
      // since progress has shifted to a new set of preview texts.
      if (activeCourseId) {
        ensuredRef.current.delete(`${activeCourseId}:${openCollectionId}`);
      }

      if (result.cardsAdded === 0) {
        toast.info(t('noCardsToAdd'));
      } else {
        toast.success(t('cardsAdded', { count: result.cardsAdded }));
      }
    } catch (error) {
      console.error('Error adding cards:', error);
      toast.error(t('failedToAdd'));
    } finally {
      setIsAdding(false);
    }
  }, [openCollectionId, addCardsFromCollection, activeCourseId, t]);

  if (!collectionProgress || !courseSettings) {
    return (
      <CollectionCarouselUI
        collections={[]}
        activeCollectionId={null}
        onSelectCollection={() => {}}
        onOpenCollection={() => {}}
        isLoading={true}
      />
    );
  }

  if (collectionProgress.length === 0) {
    return null;
  }

  const items: CollectionProgressItem[] = collectionProgress.map((c) => ({
    collectionId: c.collectionId,
    collectionName: c.collectionName,
    cardsAdded: c.cardsAdded,
    totalTexts: c.totalTexts,
  }));

  return (
    <>
      <CollectionCarouselUI
        collections={items}
        activeCollectionId={activeCollectionId}
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
