'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import {
  CollectionCardPreviewUI,
  type PreviewText,
} from './CollectionCardPreviewUI';

const PREVIEW_COUNT = 5;

export function CollectionCardPreview() {
  const [isAdding, setIsAdding] = useState(false);

  const courseSettings = useQuery(api.features.courses.getActiveCourseSettings);
  const collectionProgress = useQuery(api.features.decks.getCollectionProgress);
  const addCardsFromCollection = useMutation(
    api.features.decks.addCardsFromCollection,
  );

  const activeCollectionId = courseSettings?.activeCollectionId ?? null;

  // Find the active collection's progress info
  const activeCollection = collectionProgress?.find(
    (c) => c.collectionId === activeCollectionId,
  );

  const isCollectionComplete = activeCollection
    ? activeCollection.cardsAdded >= activeCollection.totalTexts &&
      activeCollection.totalTexts > 0
    : false;

  // Only call the query when we have an active, non-complete collection
  const nextTexts = useQuery(
    api.features.decks.getNextTextsFromCollection,
    activeCollectionId && !isCollectionComplete
      ? {
        collectionId: activeCollectionId as Id<'collections'>,
        limit: PREVIEW_COUNT,
      }
      : 'skip',
  );

  const handleAddCards = useCallback(async () => {
    if (!activeCollectionId) return;

    setIsAdding(true);
    try {
      const result = await addCardsFromCollection({
        collectionId: activeCollectionId as Id<'collections'>,
        batchSize: PREVIEW_COUNT,
      });

      if (result.cardsAdded === 0) {
        toast.info('No more cards to add from this collection');
      } else {
        toast.success(`Added ${result.cardsAdded} cards to your deck`);
      }
    } catch (error) {
      console.error('Error adding cards:', error);
      toast.error('Failed to add cards');
    } finally {
      setIsAdding(false);
    }
  }, [activeCollectionId, addCardsFromCollection]);

  if (!activeCollectionId) return null;

  const texts: PreviewText[] = (nextTexts ?? []).map((t) => ({
    _id: t._id,
    text: t.text,
    collectionRank: t.collectionRank ?? undefined,
  }));

  return (
    <CollectionCardPreviewUI
      collectionName={activeCollection?.collectionName ?? null}
      texts={texts}
      isLoading={nextTexts === undefined && !isCollectionComplete}
      isAdding={isAdding}
      isCollectionComplete={isCollectionComplete}
      onAddCards={handleAddCards}
    />
  );
}
