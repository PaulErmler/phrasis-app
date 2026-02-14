'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Loader2, CheckCircle2 } from 'lucide-react';

export interface PreviewText {
  _id: string;
  text: string;
  collectionRank?: number;
}

interface CollectionCardPreviewUIProps {
  collectionName: string | null;
  texts: PreviewText[];
  isLoading: boolean;
  isAdding: boolean;
  isCollectionComplete: boolean;
  onAddCards: () => void;
}

export function CollectionCardPreviewUI({
  collectionName,
  texts,
  isLoading,
  isAdding,
  isCollectionComplete,
  onAddCards,
}: CollectionCardPreviewUIProps) {
  if (!collectionName) return null;

  if (isCollectionComplete) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-center space-y-2">
        <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
        <p className="text-sm font-medium">{collectionName} complete!</p>
        <p className="text-muted-xs">
          All cards from this collection have been added to your deck.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border p-4 space-y-3">
        <Skeleton className="h-4 w-32" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (texts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-center space-y-2">
        <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
        <p className="text-sm font-medium">
          No more cards to add from {collectionName}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        Next {texts.length} cards from {collectionName}
      </p>

      <ul className="space-y-2">
        {texts.map((text, idx) => (
          <li key={text._id} className="flex items-start gap-2 text-sm">
            <span className="text-muted-foreground font-mono text-xs min-w-[1.5rem] mt-0.5">
              {idx + 1}.
            </span>
            <span className="leading-relaxed">{text.text}</span>
          </li>
        ))}
      </ul>

      <Button
        onClick={onAddCards}
        disabled={isAdding}
        className="w-full gap-2"
        size="sm"
      >
        {isAdding ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" />
            Add {texts.length} cards to deck
          </>
        )}
      </Button>
    </div>
  );
}
