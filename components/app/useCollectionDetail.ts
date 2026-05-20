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

  // Trigger background content generation as soon as the user opens a
  // collection — covers the next CONTENT_LOOKAHEAD_SIZE (15) sentences
  // beyond the user's current progress, so the next two or three "Add"
  // taps land instantly. The previous guard on `contentData.hasMissingContent`
  // only fired when the 5-card preview itself was incomplete, which left
  // sentences 6-15 to lazy-load when the user actually added them.
  // The `ensuredRef` dedup still prevents repeated calls within a session
  // until the user adds cards (which clears the entry in `handleAddCards`).
  useEffect(() => {
    if (!openCollectionId || !activeCourseId) return;

    const key = `${activeCourseId}:${openCollectionId}`;
    if (ensuredRef.current.has(key)) return;

    ensuredRef.current.add(key);
    ensureContent({
      collectionId: openCollectionId as Id<'collections'>,
    }).catch(() => {
      ensuredRef.current.delete(key);
    });
  }, [openCollectionId, activeCourseId, ensureContent]);

  const effectiveBatchSize = sentencesQuota.unlimited
    ? COLLECTION_PREVIEW_SIZE
    : Math.min(COLLECTION_PREVIEW_SIZE, Math.max(0, sentencesQuota.balance));

  const handleAddCards = useCallback(async (targetCollectionId?: string) => {
    const collectionId = targetCollectionId ?? openCollectionId;
    if (!collectionId) return;

    setIsAdding(true);
    setUsageLimitHit(false);
    try {
      const result = await addCardsFromCollection({
        collectionId: collectionId as Id<'collections'>,
        batchSize: effectiveBatchSize > 0 ? effectiveBatchSize : COLLECTION_PREVIEW_SIZE,
        exclusive: true,
      });

      if (activeCourseId) {
        ensuredRef.current.delete(`${activeCourseId}:${collectionId}`);
      }

      if (result.cardsAdded === 0) {
        toast.info(t('noCardsToAdd'));
      } else {
        toast.success(t('cardsAdded', { count: result.cardsAdded }));
      }
    } catch (error) {
      const code = error instanceof ConvexError
        ? (error.data as { code?: string })?.code
        : undefined;
      if (code === 'USAGE_LIMIT') {
        setUsageLimitHit(true);
      } else if (code === 'QUOTA_NOT_SYNCED') {
        toast.error(t('failedToAdd'));
      } else {
        console.error('Failed to add cards:', error);
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
    // While the quota query is loading, treat as unlimited so the inline
    // detail renders "+Add" by default instead of flashing the locked
    // Upgrade button before the real balance arrives. The server mutation
    // is still the authoritative gate if the user actually has 0 quota.
    sentencesRemaining:
      sentencesQuota.isLoading || sentencesQuota.unlimited
        ? null
        : sentencesQuota.balance,
    sentencesQuota,
    usageLimitHit,
  };
}
