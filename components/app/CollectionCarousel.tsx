"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CollectionCarouselUI, type CollectionProgressItem } from "./CollectionCarouselUI";
import { CollectionDetailDialog, type PreviewText } from "./CollectionDetailDialog";

const PREVIEW_COUNT = 5;

export function CollectionCarousel() {
  const t = useTranslations("AppPage.collections.carousel");
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [optimisticActiveId, setOptimisticActiveId] = useState<string | null>(null);

  const collectionProgress = useQuery(api.features.decks.getCollectionProgress);
  const courseSettings = useQuery(api.features.courses.getActiveCourseSettings);
  const setActiveCollection = useMutation(api.features.decks.setActiveCollection);
  const addCardsFromCollection = useMutation(api.features.decks.addCardsFromCollection);

  const activeCollectionId = optimisticActiveId ?? courseSettings?.activeCollectionId ?? null;

  // Find opened collection progress
  const openedCollection = collectionProgress?.find(
    (c) => c.collectionId === openCollectionId
  );
  const isOpenedComplete = openedCollection
    ? openedCollection.cardsAdded >= openedCollection.totalTexts && openedCollection.totalTexts > 0
    : false;

  // Query next texts for the opened collection (skip if complete or not opened)
  const nextTexts = useQuery(
    api.features.decks.getNextTextsFromCollection,
    openCollectionId && !isOpenedComplete
      ? { collectionId: openCollectionId as Id<"collections">, limit: PREVIEW_COUNT }
      : "skip"
  );

  // Compute initial scroll index (active collection position)
  const initialScrollIndex =
    collectionProgress && activeCollectionId
      ? collectionProgress.findIndex((c) => c.collectionId === activeCollectionId)
      : undefined;

  const handleSelectCollection = useCallback(
    async (collectionId: string) => {
      setOptimisticActiveId(collectionId);
      try {
        await setActiveCollection({
          collectionId: collectionId as Id<"collections">,
        });
      } catch (error) {
        console.error("Error setting active collection:", error);
        toast.error(
          error instanceof Error ? error.message : t("failedToSelect")
        );
      } finally {
        setOptimisticActiveId(null);
      }
    },
    [setActiveCollection, t]
  );

  const handleAddCards = useCallback(async () => {
    if (!openCollectionId) return;

    setIsAdding(true);
    try {
      const result = await addCardsFromCollection({
        collectionId: openCollectionId as Id<"collections">,
        batchSize: PREVIEW_COUNT,
      });

      if (result.cardsAdded === 0) {
        toast.info(t("noCardsToAdd"));
      } else {
        toast.success(t("cardsAdded", { count: result.cardsAdded }));
      }
    } catch (error) {
      console.error("Error adding cards:", error);
      toast.error(t("failedToAdd"));
    } finally {
      setIsAdding(false);
    }
  }, [openCollectionId, addCardsFromCollection, t]);

  if (collectionProgress === undefined || courseSettings === undefined) {
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

  const texts: PreviewText[] = (nextTexts ?? []).map((t) => ({
    _id: t._id,
    text: t.text,
    collectionRank: t.collectionRank ?? undefined,
  }));

  return (
    <>
      <CollectionCarouselUI
        collections={items}
        activeCollectionId={activeCollectionId}
        onSelectCollection={handleSelectCollection}
        onOpenCollection={setOpenCollectionId}
        isLoading={false}
        initialScrollIndex={initialScrollIndex !== undefined && initialScrollIndex >= 0 ? initialScrollIndex : undefined}
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
        texts={texts}
        isLoadingTexts={nextTexts === undefined && !isOpenedComplete}
        isAdding={isAdding}
        onSelect={() => {
          if (openCollectionId) handleSelectCollection(openCollectionId);
        }}
        onAddCards={handleAddCards}
      />
    </>
  );
}
