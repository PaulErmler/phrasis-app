'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useTranslations } from 'next-intl';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { toast } from 'sonner';
import { COLLECTION_PREVIEW_SIZE } from '@/convex/lib/collections';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
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
  const [usageLimitHit, setUsageLimitHit] = useState(false);
  const ensuredRef = useRef<Set<string>>(new Set());
  const sentencesQuota = useFeatureQuota(FEATURE_IDS.SENTENCES);

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

  const effectiveBatchSize = sentencesQuota.unlimited
    ? COLLECTION_PREVIEW_SIZE
    : Math.min(COLLECTION_PREVIEW_SIZE, Math.max(0, sentencesQuota.balance));

  const handleAddCards = useCallback(async () => {
    if (!openCollectionId) return;

    setIsAdding(true);
    setUsageLimitHit(false);
    try {
      const result = await addCardsFromCollection({
        collectionId: openCollectionId as Id<'collections'>,
        batchSize: effectiveBatchSize > 0 ? effectiveBatchSize : COLLECTION_PREVIEW_SIZE,
      });

      if (activeCourseId) {
        ensuredRef.current.delete(`${activeCourseId}:${openCollectionId}`);
      }

      if (result.cardsAdded === 0) {
        toast.info(t('noCardsToAdd'));
      } else {
        toast.success(t('cardsAdded', { count: result.cardsAdded }));
      }
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string })?.code === 'USAGE_LIMIT'
      ) {
        setUsageLimitHit(true);
      } else {
        toast.error(t('failedToAdd'));
      }
    } finally {
      setIsAdding(false);
    }
  }, [openCollectionId, addCardsFromCollection, activeCourseId, t, effectiveBatchSize]);

  return {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    contentData,
    isAdding,
    handleAddCards,
    sentencesRemaining: sentencesQuota.unlimited ? null : sentencesQuota.balance,
    sentencesQuota,
    usageLimitHit,
  };
}
