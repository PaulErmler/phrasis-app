"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Calendar,
  Clock,
  RotateCcw,
  Brain,
  TrendingUp,
  CheckCircle2,
  Loader2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Layers,
  FastForward,
} from "lucide-react";
import {
  Rating,
  getAllRatingPreviews,
  getPhaseDescription,
  isInInitialPhase,
  formatInterval,
  createInitialCardState,
  calculateNextReview,
  DEFAULT_INITIAL_REVIEWS_TARGET,
  type CardSchedulingState,
  type DuePreview,
  type SupportedRating,
} from "@/lib/scheduling";

// Rating labels and colors (using SupportedRating, excludes Manual)
const RATING_CONFIG: Record<SupportedRating, { label: string; color: string; description: string }> = {
  [Rating.Again]: { label: "Again", color: "bg-red-500", description: "Forgot completely" },
  [Rating.Hard]: { label: "Hard", color: "bg-orange-500", description: "Difficult recall" },
  [Rating.Good]: { label: "Good", color: "bg-green-500", description: "Correct with effort" },
  [Rating.Easy]: { label: "Easy", color: "bg-blue-500", description: "Instant recall" },
};

// State labels
const STATE_LABELS: Record<number, string> = {
  0: "New",
  1: "Learning",
  2: "Review",
  3: "Relearning",
};

interface ReviewLogEntry {
  timestamp: Date;
  rating: SupportedRating;
  previousState: CardSchedulingState;
  newState: CardSchedulingState;
  intervalMinutes: number;
}

export function SchedulerTest() {
  // State for simulation
  const [simulatedCard, setSimulatedCard] = useState<CardSchedulingState>(createInitialCardState());
  const [reviewLog, setReviewLog] = useState<ReviewLogEntry[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  
  // Optimistic state for initialReviewsTarget
  const [optimisticTarget, setOptimisticTarget] = useState<number | null>(null);
  const [isUpdatingTarget, setIsUpdatingTarget] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Time shift for simulated card (in days)
  const [timeShiftDays, setTimeShiftDays] = useState(0);

  // Get real data from backend (if available)
  const activeCourse = useQuery(api.courses.getActiveCourse);
  const courseSettings = useQuery(api.courses.getActiveCourseSettings);
  // Get ALL cards (including future ones) for testing
  const deckCards = useQuery(api.decks.getDeckCards, { limit: 10 });
  const reviewCardMutation = useMutation(api.decks.reviewCard);
  const updateTargetMutation = useMutation(api.decks.updateInitialReviewsTarget);

  // Server value for target (from course settings)
  const serverTarget = courseSettings?.initialReviewsTarget ?? DEFAULT_INITIAL_REVIEWS_TARGET;
  
  // Use optimistic value if set, otherwise use server value
  const effectiveTarget = optimisticTarget ?? serverTarget;
  
  // Clear optimistic state when server catches up
  useEffect(() => {
    if (optimisticTarget !== null && courseSettings?.initialReviewsTarget === optimisticTarget) {
      setOptimisticTarget(null);
      setIsUpdatingTarget(false);
    }
  }, [courseSettings?.initialReviewsTarget, optimisticTarget]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Calculate effective "now" for simulation (shifted by timeShiftDays)
  const simulatedNow = useMemo(() => {
    const now = new Date();
    now.setDate(now.getDate() + timeShiftDays);
    return now;
  }, [timeShiftDays]);

  // Calculate previews for all ratings using shared logic
  const previews = useMemo(() => {
    return getAllRatingPreviews(simulatedCard, effectiveTarget, simulatedNow);
  }, [simulatedCard, effectiveTarget, simulatedNow]);

  // Phase description
  const phaseDescription = useMemo(() => {
    return getPhaseDescription(simulatedCard, effectiveTarget);
  }, [simulatedCard, effectiveTarget]);

  // Is in initial phase?
  const inInitialPhase = useMemo(() => {
    return isInInitialPhase(simulatedCard, effectiveTarget);
  }, [simulatedCard, effectiveTarget]);

  // Simulate a review with the given rating using the real scheduling algorithm
  const simulateReview = (rating: SupportedRating) => {
    // Use the real calculateNextReview function with the shifted time
    const result = calculateNextReview(
      simulatedCard,
      rating,
      effectiveTarget,
      simulatedNow
    );

    // Log the review
    const logEntry: ReviewLogEntry = {
      timestamp: simulatedNow,
      rating,
      previousState: simulatedCard,
      newState: result.nextState,
      intervalMinutes: result.intervalMinutes,
    };

    setReviewLog((prev) => [logEntry, ...prev].slice(0, 20)); // Keep last 20 entries
    setSimulatedCard(result.nextState);
  };

  // Review a real card from the backend
  const reviewRealCard = async (rating: SupportedRating) => {
    const selectedCard = deckCards?.[selectedCardIndex];
    if (!selectedCard) return;
    
    setIsReviewing(true);
    try {
      await reviewCardMutation({
        cardId: selectedCard._id,
        rating,
      });
    } catch (error) {
      console.error("Failed to review card:", error);
    } finally {
      setIsReviewing(false);
    }
  };

  // Navigate between cards
  const nextCard = () => {
    if (deckCards && selectedCardIndex < deckCards.length - 1) {
      setSelectedCardIndex(selectedCardIndex + 1);
    }
  };

  const prevCard = () => {
    if (selectedCardIndex > 0) {
      setSelectedCardIndex(selectedCardIndex - 1);
    }
  };

  // Reset simulation
  const resetSimulation = () => {
    setSimulatedCard(createInitialCardState());
    setReviewLog([]);
    setTimeShiftDays(0);
  };

  // Update course target with debounced backend update
  const updateCourseTarget = useCallback((target: number) => {
    // Immediately update the UI (optimistic)
    setOptimisticTarget(target);
    setIsUpdatingTarget(true);
    
    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Debounce the backend update (wait 500ms after user stops changing)
    debounceTimeoutRef.current = setTimeout(() => {
      if (activeCourse) {
        updateTargetMutation({ target })
          .catch((error) => {
            console.error("Failed to update target:", error);
            // Revert optimistic update on error
            setOptimisticTarget(null);
            setIsUpdatingTarget(false);
          });
      }
    }, 500);
  }, [activeCourse, updateTargetMutation]);

  // Format due date for display (relative to a reference time)
  const formatDueDate = (timestamp: number, referenceTime: Date = new Date()): string => {
    const diffMs = timestamp - referenceTime.getTime();
    
    if (diffMs < 0) {
      return "Due now";
    }
    
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes < 60) {
      return `in ${diffMinutes}m`;
    }
    
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `in ${diffHours}h`;
    }
    
    const diffDays = Math.round(diffHours / 24);
    return `in ${diffDays}d`;
  };

  const selectedCard = deckCards?.[selectedCardIndex];
  const selectedCardScheduling = selectedCard?.scheduling;
  const isDueNow = selectedCardScheduling ? selectedCardScheduling.dueDate <= Date.now() : false;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Card Scheduling Test
        </CardTitle>
        <CardDescription>
          Test FSRS scheduling with initial learning phase
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Settings Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Settings</Label>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-muted-foreground">
                Initial Reviews Target
              </Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{effectiveTarget}</Badge>
                {isUpdatingTarget && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
            <Slider
              value={[effectiveTarget]}
              onValueChange={([value]) => updateCourseTarget(value)}
              min={1}
              max={15}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Cards shown at fixed intervals until {effectiveTarget} reviews, then FSRS takes over
            </p>
          </div>
        </div>

        <Separator />

        {/* Simulation Card State */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Simulated Card</Label>
            </div>
            <Button variant="ghost" size="sm" onClick={resetSimulation}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>

          {/* Time Shift Control */}
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            <FastForward className="h-4 w-4 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground">Time shift:</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setTimeShiftDays(prev => prev - 1)}
              >
                -
              </Button>
              <span className="text-sm font-mono w-16 text-center">
                {timeShiftDays >= 0 ? `+${timeShiftDays}` : timeShiftDays}d
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setTimeShiftDays(prev => prev + 1)}
              >
                +
              </Button>
            </div>
            {timeShiftDays !== 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                ({simulatedNow.toLocaleDateString()})
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Phase</p>
              <Badge variant={inInitialPhase ? "secondary" : "default"}>
                {phaseDescription}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">State</p>
              <Badge variant="outline">{STATE_LABELS[simulatedCard.state]}</Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Reviews</p>
              <p className="font-mono">{simulatedCard.reps}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Lapses</p>
              <p className="font-mono">{simulatedCard.lapses}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Stability</p>
              <p className="font-mono">{simulatedCard.stability.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Difficulty</p>
              <p className="font-mono">{simulatedCard.difficulty.toFixed(2)}</p>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Due</p>
            <div className="flex items-center gap-2">
              <Clock className="h-3 w-3" />
              <span>{formatDueDate(simulatedCard.dueDate, simulatedNow)}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Rating Buttons with Previews */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Rate & Preview</Label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as SupportedRating[]).map((rating) => {
              const config = RATING_CONFIG[rating];
              const preview = previews[rating];
              
              return (
                <Button
                  key={rating}
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-start"
                  onClick={() => simulateReview(rating)}
                >
                  <div className="flex items-center gap-2 w-full">
                    <div className={`w-2 h-2 rounded-full ${config.color}`} />
                    <span className="font-medium">{config.label}</span>
                    {preview.isGraduated && !inInitialPhase ? null : (
                      preview.isGraduated && (
                        <Badge variant="secondary" className="ml-auto text-[10px]">
                          Graduates
                        </Badge>
                      )
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Next: {preview.formattedInterval}
                  </div>
                </Button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Default rating: <span className="font-medium">Good</span>
          </p>
        </div>

        <Separator />

        {/* Review Log */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Review History</Label>
          </div>

          {reviewLog.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No reviews yet. Click a rating button above.
            </p>
          ) : (
            <ScrollArea className="h-32">
              <div className="space-y-2">
                {reviewLog.map((entry, index) => {
                  const config = RATING_CONFIG[entry.rating];
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between text-xs p-2 bg-muted/50 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${config.color}`} />
                        <span>{config.label}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>+{formatInterval(entry.intervalMinutes)}</span>
                        <span>→ Rep #{entry.newState.reps}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Real Cards Section (if available) */}
        {deckCards && deckCards.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Real Cards (from deck)</Label>
                </div>
                <Badge variant="outline" className="text-xs">
                  {deckCards.length} cards
                </Badge>
              </div>

              {/* Card Navigation */}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={prevCard}
                  disabled={selectedCardIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Card {selectedCardIndex + 1} of {deckCards.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={nextCard}
                  disabled={selectedCardIndex >= deckCards.length - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {selectedCard && (
                <>
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <p className="text-sm font-medium">{selectedCard.sourceText}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>State: {STATE_LABELS[selectedCardScheduling?.state ?? 0]}</span>
                      <span>•</span>
                      <span>Reviews: {selectedCardScheduling?.reps ?? 0}</span>
                      <span>•</span>
                      <span>Lapses: {selectedCardScheduling?.lapses ?? 0}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant={isDueNow ? "default" : "secondary"}>
                        {isDueNow ? "Due now" : formatDueDate(selectedCardScheduling?.dueDate ?? 0)}
                      </Badge>
                      {selectedCardScheduling && selectedCardScheduling.initialReviewCount < serverTarget && (
                        <Badge variant="outline">
                          Initial {selectedCardScheduling.initialReviewCount}/{serverTarget}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as SupportedRating[]).map((rating) => {
                      const config = RATING_CONFIG[rating];
                      return (
                        <Button
                          key={rating}
                          variant="outline"
                          size="sm"
                          disabled={isReviewing}
                          onClick={() => reviewRealCard(rating)}
                          className="text-xs"
                        >
                          {isReviewing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <div className={`w-1.5 h-1.5 rounded-full ${config.color} mr-1`} />
                              {config.label}
                            </>
                          )}
                        </Button>
                      );
                    })}
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    {isDueNow ? "Card is due - review now!" : "Card not due yet - but you can still review it"}
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

