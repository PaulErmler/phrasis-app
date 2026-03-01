'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { COLLECTION_PREVIEW_SIZE } from '@/convex/lib/collections';
import type { CollectionProgressItem } from './CollectionCarouselUI';

interface UseCollectionDetailOptions {
  collections: CollectionProgressItem[] | undefined;
  activeCourseId: string | null;
}

export function useCollectionDetail({
  collections,
  activeCourseId,
}: UseCollectionDetailOptions) {
  const t = useTranslations('AppPage.collections.carousel');
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const ensuredRef = useRef<Set<string>>(new Set());

  const addCardsFromCollection = useMutation(
    api.features.decks.addCardsFromCollection,
  );
  const ensureContent = useMutation(
    api.features.collections.ensureContentForCollection,
  );

  const openedCollection = collections?.find(
    (c) => c.collectionId === openCollectionId,
  );
  const isOpenedComplete = openedCollection
    ? openedCollection.cardsAdded >= openedCollection.totalTexts &&
      openedCollection.totalTexts > 0
    : false;

  const contentData = useQuery(
    api.features.collections.getCollectionTextsWithContent,
    openCollectionId && !isOpenedComplete
      ? { collectionId: openCollectionId as Id<'collections'> }
      : 'skip',
  );

  // Trigger content generation for missing translations/audio
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

  const handleAddCards = useCallback(async () => {
    if (!openCollectionId) return;

    setIsAdding(true);
    try {
      const result = await addCardsFromCollection({
        collectionId: openCollectionId as Id<'collections'>,
        batchSize: COLLECTION_PREVIEW_SIZE,
      });

      if (activeCourseId) {
        ensuredRef.current.delete(`${activeCourseId}:${openCollectionId}`);
      }

      if (result.cardsAdded === 0) {
        toast.info(t('noCardsToAdd'));
      } else {
        toast.success(t('cardsAdded', { count: result.cardsAdded }));
      }
    } catch {
      toast.error(t('failedToAdd'));
    } finally {
      setIsAdding(false);
    }
  }, [openCollectionId, addCardsFromCollection, activeCourseId, t]);

  return {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    contentData,
    isAdding,
    handleAddCards,
  };
}
