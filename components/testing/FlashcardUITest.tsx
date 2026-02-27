"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Volume2,
  Play,
  Pause,
  ChevronRight,
  CircleCheck,
  EyeOff,
} from "lucide-react";
import {
  getValidRatings,
  getDefaultRating,
  formatInterval,
  scheduleCard,
  createInitialCardState,
  type ReviewRating,
  type SchedulingPhase,
  type CardSchedulingState,
} from "@/lib/scheduling";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_PRE_REVIEW_STATE: CardSchedulingState = createInitialCardState();
// Simulate a card that has transitioned to FSRS review phase
const MOCK_REVIEW_STATE: CardSchedulingState = (() => {
  const initial = createInitialCardState();
  const result = scheduleCard(initial, "understood", 5);
  return {
    schedulingPhase: result.schedulingPhase,
    preReviewCount: result.preReviewCount,
    dueDate: result.dueDate,
    fsrsState: result.fsrsState,
  };
})();

const MOCK_CARD_PRE_REVIEW = {
  phase: "preReview" as SchedulingPhase,
  preReviewCount: 2,
  cardState: { ...MOCK_PRE_REVIEW_STATE, preReviewCount: 2 },
  baseTexts: [{ language: "EN", text: "How are you doing today?" }],
  targetTexts: [
    { language: "ES", text: "¿Cómo estás hoy?" },
    { language: "FR", text: "Comment vas-tu aujourd'hui ?" },
  ],
};

const MOCK_CARD_REVIEW = {
  phase: "review" as SchedulingPhase,
  preReviewCount: 5,
  cardState: MOCK_REVIEW_STATE,
  baseTexts: [{ language: "EN", text: "The weather is beautiful today." }],
  targetTexts: [
    { language: "ES", text: "El clima está hermoso hoy." },
    { language: "FR", text: "Le temps est magnifique aujourd'hui." },
  ],
};

// ============================================================================
// FLASHCARD PREVIEW (presentational)
// ============================================================================

function FlashcardPreview({
  phase,
  preReviewCount,
  baseTexts,
  targetTexts,
  cardState,
}: {
  phase: SchedulingPhase;
  preReviewCount: number;
  baseTexts: Array<{ language: string; text: string }>;
  targetTexts: Array<{ language: string; text: string }>;
  cardState: CardSchedulingState;
}) {
  const validRatings = getValidRatings(phase);
  const defaultRating = getDefaultRating(phase);
  const [selectedRating, setSelectedRating] = useState<ReviewRating>(defaultRating);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  const ratingLabels: Record<string, string> = {
    stillLearning: "Still learning",
    understood: "Understood",
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy",
  };

  // Compute projected intervals for each rating
  const now = Date.now();
  const ratingIntervals: Record<string, string> = {};
  for (const rating of validRatings) {
    try {
      const result = scheduleCard(cardState, rating, 5, now);
      const diff = result.dueDate - now;
      ratingIntervals[rating] = diff <= 0 ? "Now" : formatInterval(diff);
    } catch {
      ratingIntervals[rating] = "—";
    }
  }

  return (
    <div className="flex flex-col border rounded-lg overflow-hidden bg-background">
      {/* Card area */}
      <div className="p-4">
        <div className="card-surface">
          {/* Card top bar */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {phase === "preReview" ? "Pre-review" : "Review"}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {preReviewCount} reviews
              </Badge>
            </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-success hover:bg-green-50 dark:hover:bg-green-950/30"
                      onClick={() => alert("Master clicked")}
                    >
                      <CircleCheck className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Master</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-warning hover:bg-orange-50 dark:hover:bg-orange-950/30"
                      onClick={() => alert("Hide clicked")}
                    >
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Hide</TooltipContent>
                </Tooltip>
              </div>
          </div>

          {/* Card text content */}
          <div className="px-6 pb-6 space-y-4">
            <div className="space-y-2">
              {baseTexts.map((item) => (
                <div key={item.language} className="flex items-start gap-2">
                  <p className="flex-1 body-large font-medium">
                    {item.text}
                  </p>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Volume2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-2">
              {targetTexts.map((item) => (
                <div key={item.language} className="flex items-start gap-2">
                  <p className="flex-1 body-large">{item.text}</p>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Volume2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="border-t bg-background">
        <div className="px-4 py-4 space-y-3">
          {/* Rating buttons — select only */}
          <div className="flex gap-2">
            {validRatings.map((rating) => (
              <div key={rating} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {ratingIntervals[rating]}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedRating(rating)}
                  className={`w-full ${
                    selectedRating === rating
                      ? "ring-2 ring-primary border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  {ratingLabels[rating]}
                </Button>
              </div>
            ))}
          </div>

          {/* Play + Next row — play 2/3, next 1/3 */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAutoPlaying(!isAutoPlaying)}
              className="flex-[2] gap-2"
            >
              {isAutoPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isAutoPlaying ? "Pause" : "Play"}
            </Button>
            <Button
              size="sm"
              onClick={() => alert(`Submitting rating: ${selectedRating}`)}
              className="flex-[1] gap-2"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EMPTY STATE PREVIEWS
// ============================================================================

function NoCardsDuePreview() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 border rounded-lg bg-background">
      <div className="text-center space-y-2">
        <p className="body-large font-medium">No cards due for review</p>
        <p className="text-muted-sm">
          All caught up! Add more cards to continue learning.
        </p>
      </div>
      <Button size="lg" className="gap-2" onClick={() => alert("Add cards clicked")}>
        Add 5 cards
      </Button>
    </div>
  );
}

function NoCollectionPreview() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 border rounded-lg bg-background">
      <p className="text-muted-sm text-center">No collection selected</p>
      <Button onClick={() => alert("Go home clicked")}>Go to Home</Button>
    </div>
  );
}

function LoadingPreview() {
  return (
    <div className="flex items-center justify-center py-16 border rounded-lg bg-background">
      <div className="space-y-4 w-full max-w-md px-4">
        <div className="h-48 w-full rounded-lg bg-muted animate-pulse" />
        <div className="h-12 w-full rounded-lg bg-muted animate-pulse" />
        <div className="h-12 w-full rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}

// ============================================================================
// MAIN TEST COMPONENT
// ============================================================================

export function FlashcardUITest() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Flashcard UI States
        </CardTitle>
        <CardDescription>
          Preview the different states of the learning mode flashcard UI
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="preReview">
          <TabsList className="mb-4">
            <TabsTrigger value="preReview">Pre-review</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
            <TabsTrigger value="noCards">No Cards Due</TabsTrigger>
            <TabsTrigger value="noCollection">No Collection</TabsTrigger>
            <TabsTrigger value="loading">Loading</TabsTrigger>
          </TabsList>

          <TabsContent value="preReview">
            <FlashcardPreview
              phase={MOCK_CARD_PRE_REVIEW.phase}
              preReviewCount={MOCK_CARD_PRE_REVIEW.preReviewCount}
              baseTexts={MOCK_CARD_PRE_REVIEW.baseTexts}
              targetTexts={MOCK_CARD_PRE_REVIEW.targetTexts}
              cardState={MOCK_CARD_PRE_REVIEW.cardState}
            />
          </TabsContent>

          <TabsContent value="review">
            <FlashcardPreview
              phase={MOCK_CARD_REVIEW.phase}
              preReviewCount={MOCK_CARD_REVIEW.preReviewCount}
              baseTexts={MOCK_CARD_REVIEW.baseTexts}
              targetTexts={MOCK_CARD_REVIEW.targetTexts}
              cardState={MOCK_CARD_REVIEW.cardState}
            />
          </TabsContent>

          <TabsContent value="noCards">
            <NoCardsDuePreview />
          </TabsContent>

          <TabsContent value="noCollection">
            <NoCollectionPreview />
          </TabsContent>

          <TabsContent value="loading">
            <LoadingPreview />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

