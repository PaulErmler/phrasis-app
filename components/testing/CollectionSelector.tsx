"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Plus, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const BATCH_SIZE_OPTIONS = [
  { value: "5", label: "5 cards" },
  { value: "10", label: "10 cards" },
  { value: "20", label: "20 cards" },
  { value: "50", label: "50 cards" },
];

export function CollectionSelector() {
  const [selectedCollectionId, setSelectedCollectionId] = useState<Id<"collections"> | null>(null);
  const [batchSize, setBatchSize] = useState("10");
  const [isAdding, setIsAdding] = useState(false);

  const collectionProgress = useQuery(api.features.decks.getCollectionProgress);
  const addCardsFromCollection = useMutation(api.features.decks.addCardsFromCollection);

  const handleAddCards = async () => {
    if (!selectedCollectionId) {
      toast.error("Please select a collection first");
      return;
    }

    setIsAdding(true);
    try {
      const result = await addCardsFromCollection({
        collectionId: selectedCollectionId,
        batchSize: parseInt(batchSize, 10),
      });

      if (result.cardsAdded === 0) {
        toast.info("No more cards to add from this collection");
      } else {
        toast.success(`Added ${result.cardsAdded} cards to your deck`, {
          description: `Total cards in deck: ${result.totalCardsInDeck}`,
        });
      }
    } catch (error) {
      console.error("Error adding cards:", error);
      toast.error("Failed to add cards", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsAdding(false);
    }
  };

  if (collectionProgress === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Add Cards from Collections
          </CardTitle>
          <CardDescription>Loading collections...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (collectionProgress.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Add Cards from Collections
          </CardTitle>
          <CardDescription>
            No collections available. Run the upload script to add texts.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const selectedCollection = collectionProgress.find(
    (c) => c.collectionId === selectedCollectionId
  );
  const remainingCards = selectedCollection
    ? selectedCollection.totalTexts - selectedCollection.cardsAdded
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Add Cards from Collections
        </CardTitle>
        <CardDescription>
          Select a difficulty level and add cards to your deck
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Collection Selection */}
        <RadioGroup
          value={selectedCollectionId ?? ""}
          onValueChange={(value) => setSelectedCollectionId(value as Id<"collections">)}
          className="space-y-3"
        >
          {collectionProgress.map((collection) => {
            const progress = collection.totalTexts > 0
              ? (collection.cardsAdded / collection.totalTexts) * 100
              : 0;
            const isComplete = collection.cardsAdded >= collection.totalTexts;
            const isSelected = selectedCollectionId === collection.collectionId;

            return (
              <div
                key={collection.collectionId}
                className={`relative flex items-start space-x-3 rounded-lg border p-4 transition-colors ${
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
                } ${isComplete ? "opacity-60" : ""}`}
              >
                <RadioGroupItem
                  value={collection.collectionId}
                  id={collection.collectionId}
                  disabled={isComplete}
                  className="mt-1"
                />
                <Label
                  htmlFor={collection.collectionId}
                  className="flex-1 cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {collection.collectionName}
                      </Badge>
                      {isComplete && (
                        <Badge variant="secondary" className="gap-1">
                          <Check className="h-3 w-3" />
                          Complete
                        </Badge>
                      )}
                    </div>
                    <span className="text-muted-sm">
                      {collection.cardsAdded} / {collection.totalTexts} cards
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </Label>
              </div>
            );
          })}
        </RadioGroup>

        {/* Batch Size and Add Button */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="batch-size" className="text-muted-sm mb-2 block">
              Cards to add
            </Label>
            <Select value={batchSize} onValueChange={setBatchSize}>
              <SelectTrigger id="batch-size">
                <SelectValue placeholder="Select batch size" />
              </SelectTrigger>
              <SelectContent>
                {BATCH_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={handleAddCards}
              disabled={!selectedCollectionId || isAdding || remainingCards === 0}
              className="w-full sm:w-auto gap-2"
            >
              {isAdding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Add Cards
                </>
              )}
            </Button>
          </div>
        </div>

        {selectedCollectionId && remainingCards > 0 && (
          <p className="text-muted-sm">
            {remainingCards} cards remaining in this collection
          </p>
        )}
      </CardContent>
    </Card>
  );
}

