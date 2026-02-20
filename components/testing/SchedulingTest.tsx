'use client';

import { useState, useMemo, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarClock, Play, RotateCcw } from 'lucide-react';
import {
  DEFAULT_INITIAL_REVIEW_COUNT,
  DEFAULT_REQUEST_RETENTION,
  simulateReviews,
  scheduleCard,
  createInitialCardState,
  getValidRatings,
  getDefaultRating,
  formatInterval,
  type ReviewRating,
  type CardSchedulingState,
  type SimulationStep,
} from '@/lib/scheduling';

function buildReviewTelemetry(): { timeSpentMs: number; timezone: string } {
  return {
    timeSpentMs: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

// ============================================================================
// VIRTUAL SIMULATION TAB
// ============================================================================

function VirtualSimulation() {
  const [initialReviewCount, setInitialReviewCount] = useState(
    DEFAULT_INITIAL_REVIEW_COUNT,
  );
  const [requestRetention, setRequestRetention] = useState(
    DEFAULT_REQUEST_RETENTION,
  );
  const [steps, setSteps] = useState<SimulationStep[]>([]);
  const [cardState, setCardState] = useState<CardSchedulingState>(
    createInitialCardState(),
  );
  const [simulationTime, setSimulationTime] = useState(Date.now());

  const validRatings = getValidRatings(cardState.schedulingPhase);
  const defaultRating = getDefaultRating(cardState.schedulingPhase);

  const handleReview = useCallback(
    (rating: ReviewRating) => {
      const result = scheduleCard(
        cardState,
        rating,
        initialReviewCount,
        simulationTime,
        requestRetention,
      );
      const interval = result.dueDate - simulationTime;

      const step: SimulationStep = {
        reviewNumber: steps.length + 1,
        rating,
        phase: result.schedulingPhase,
        dueDate: result.dueDate,
        phaseTransitioned: result.phaseTransitioned,
        intervalDescription: formatInterval(interval),
      };

      setSteps((prev) => [...prev, step]);
      setCardState({
        schedulingPhase: result.schedulingPhase,
        preReviewCount: result.preReviewCount,
        dueDate: result.dueDate,
        fsrsState: result.fsrsState,
      });
      setSimulationTime(result.dueDate);
    },
    [
      cardState,
      initialReviewCount,
      simulationTime,
      steps.length,
      requestRetention,
    ],
  );

  const handleReset = useCallback(() => {
    const now = Date.now();
    setSteps([]);
    setCardState(createInitialCardState(now));
    setSimulationTime(now);
  }, []);

  // Quick simulation: all "stillLearning" then all "good"
  const quickSimulation = useMemo(() => {
    const preReviewCount = Math.max(initialReviewCount - 2, 0);
    const ratings: Array<ReviewRating> = [
      ...Array<ReviewRating>(preReviewCount).fill('stillLearning'),
      ...Array<ReviewRating>(8).fill('good'),
    ];
    return simulateReviews(
      initialReviewCount,
      ratings,
      undefined,
      requestRetention,
    );
  }, [initialReviewCount, requestRetention]);

  return (
    <div className="space-y-4">
      {/* Initial Review Count Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            Initial Review Count (X)
          </label>
          <span className="text-muted-sm font-mono">{initialReviewCount}</span>
        </div>
        <Slider
          value={[initialReviewCount]}
          onValueChange={([val]) => {
            setInitialReviewCount(val);
            handleReset();
          }}
          min={2}
          max={10}
          step={1}
        />
        <p className="text-muted-xs">
          Pre-review threshold: {Math.max(initialReviewCount - 2, 0)} reviews
          before FSRS starts
        </p>
      </div>

      {/* Desired Retention Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Desired Retention</label>
          <span className="text-muted-sm font-mono">
            {(requestRetention * 100).toFixed(0)}%
          </span>
        </div>
        <Slider
          value={[requestRetention * 100]}
          onValueChange={([val]) => {
            setRequestRetention(val / 100);
            handleReset();
          }}
          min={70}
          max={99}
          step={1}
        />
        <p className="text-muted-xs">
          Higher retention → shorter intervals. Backend uses{' '}
          {(DEFAULT_REQUEST_RETENTION * 100).toFixed(0)}%.
        </p>
      </div>

      {/* Quick Simulation Preview */}
      <div className="rounded-lg border p-3 space-y-2">
        <h4 className="text-sm font-medium">
          Quick Preview (all &quot;still learning&quot; then &quot;good&quot;)
        </h4>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1 text-xs">
          <span className="font-medium text-muted-foreground">#</span>
          <span className="font-medium text-muted-foreground">Rating</span>
          <span className="font-medium text-muted-foreground">Phase</span>
          <span className="font-medium text-muted-foreground text-right">
            Next in
          </span>
          {quickSimulation.map((step) => (
            <QuickSimRow
              key={step.reviewNumber}
              step={step}
              initialReviewCount={initialReviewCount}
            />
          ))}
        </div>
      </div>

      {/* Interactive Step-by-Step */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Interactive Simulation</h4>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>

        {/* Current state */}
        <div className="text-xs space-y-1 bg-muted rounded-md p-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Phase:</span>
            <PhaseBadge
              phase={cardState.schedulingPhase}
              isInitialFsrs={
                cardState.schedulingPhase === 'review' &&
                steps.length < initialReviewCount
              }
            />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pre-review count:</span>
            <span className="font-mono">
              {cardState.preReviewCount} / {Math.max(initialReviewCount - 2, 0)}
            </span>
          </div>
          {cardState.fsrsState && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">FSRS stability:</span>
                <span className="font-mono">
                  {cardState.fsrsState.stability.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">FSRS difficulty:</span>
                <span className="font-mono">
                  {cardState.fsrsState.difficulty.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">FSRS reps:</span>
                <span className="font-mono">{cardState.fsrsState.reps}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">FSRS state:</span>
                <span className="font-mono">
                  {['New', 'Learning', 'Review', 'Relearning'][
                    cardState.fsrsState.state
                  ] ?? cardState.fsrsState.state}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Rating buttons */}
        <div className="flex flex-wrap gap-2">
          {validRatings.map((rating) => (
            <Button
              key={rating}
              size="sm"
              variant={rating === defaultRating ? 'default' : 'outline'}
              onClick={() => handleReview(rating)}
            >
              {ratingLabel(rating)}
            </Button>
          ))}
        </div>

        {/* Step history */}
        {steps.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {steps.map((step) => (
              <div
                key={step.reviewNumber}
                className="flex items-center justify-between text-xs py-1 border-b last:border-b-0"
              >
                <span className="text-muted-foreground font-mono w-6">
                  {step.reviewNumber}.
                </span>
                <span className="flex-1">{ratingLabel(step.rating)}</span>
                <PhaseBadge
                  phase={step.phase}
                  isInitialFsrs={
                    step.phase === 'review' &&
                    step.reviewNumber <= initialReviewCount
                  }
                />
                {step.phaseTransitioned && (
                  <span className="text-amber-500 ml-1 text-[10px]">
                    TRANSITION
                  </span>
                )}
                <span className="font-mono ml-2 w-12 text-right">
                  {step.intervalDescription}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// REAL CARD REVIEW TAB
// ============================================================================

function RealCardReview() {
  const cardForReview = useQuery(api.features.scheduling.getCardForReview);
  const reviewCardMutation = useMutation(api.features.scheduling.reviewCard);
  const [lastResult, setLastResult] = useState<{
    phase: string;
    dueDate: number;
    transitioned: boolean;
  } | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);

  const handleReview = useCallback(
    async (rating: ReviewRating) => {
      if (!cardForReview) return;
      setIsReviewing(true);
      try {
        const result = await reviewCardMutation({
          cardId: cardForReview._id,
          rating,
          ...buildReviewTelemetry(),
        });
        setLastResult({
          phase: result.schedulingPhase,
          dueDate: result.dueDate,
          transitioned: result.phaseTransitioned,
        });
      } finally {
        setIsReviewing(false);
      }
    },
    [cardForReview, reviewCardMutation],
  );

  if (cardForReview === undefined) {
    return <div className="text-muted-sm py-8 text-center">Loading...</div>;
  }

  if (cardForReview === null) {
    return (
      <div className="text-muted-sm py-8 text-center space-y-2">
        <p>No cards due for review.</p>
        <p className="text-xs">
          Add cards from a collection first, or wait until a card is due.
        </p>
      </div>
    );
  }

  const phase = cardForReview.schedulingPhase as 'preReview' | 'review';
  const validRatings = getValidRatings(phase);
  const defaultRating = getDefaultRating(phase);

  return (
    <div className="space-y-4">
      {/* Card content */}
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-sm font-medium">{cardForReview.sourceText}</p>
        {cardForReview.translations.map((t) =>
          t.language !== cardForReview.sourceLanguage ? (
            <p key={t.language} className="text-muted-sm">
              {t.text || '(translation pending)'}
            </p>
          ) : null,
        )}
      </div>

      {/* Scheduling state */}
      <div className="text-xs space-y-1 bg-muted rounded-md p-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Phase:</span>
          <PhaseBadge phase={phase} />
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Pre-review count:</span>
          <span className="font-mono">
            {cardForReview.preReviewCount} /{' '}
            {Math.max(cardForReview.initialReviewCount - 2, 0)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Due:</span>
          <span className="font-mono">
            {new Date(cardForReview.dueDate).toLocaleString()}
          </span>
        </div>
        {cardForReview.fsrsState && (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stability:</span>
              <span className="font-mono">
                {cardForReview.fsrsState.stability.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Difficulty:</span>
              <span className="font-mono">
                {cardForReview.fsrsState.difficulty.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Rating buttons */}
      <div className="flex flex-wrap gap-2">
        {validRatings.map((rating) => (
          <Button
            key={rating}
            size="sm"
            variant={rating === defaultRating ? 'default' : 'outline'}
            onClick={() => handleReview(rating)}
            disabled={isReviewing}
          >
            {ratingLabel(rating)}
          </Button>
        ))}
      </div>

      {/* Last result */}
      {lastResult && (
        <div className="rounded-lg bg-muted p-2 text-xs space-y-1">
          <p>
            <span className="text-muted-foreground">Next phase: </span>
            <PhaseBadge phase={lastResult.phase} />
          </p>
          <p>
            <span className="text-muted-foreground">Next due: </span>
            <span className="font-mono">
              {new Date(lastResult.dueDate).toLocaleString()}
            </span>
          </p>
          {lastResult.transitioned && (
            <p className="text-amber-500 font-medium">
              Transitioned to FSRS review phase
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHARED UI HELPERS
// ============================================================================

function PhaseBadge({
  phase,
  isInitialFsrs,
}: {
  phase: string;
  isInitialFsrs?: boolean;
}) {
  const isPreReview = phase === 'preReview';
  const colorClass = isPreReview
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    : isInitialFsrs
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  const label = isPreReview
    ? 'Pre-review'
    : isInitialFsrs
      ? 'Initial FSRS Review'
      : 'FSRS Review';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${colorClass}`}
    >
      {label}
    </span>
  );
}

function QuickSimRow({
  step,
  initialReviewCount,
}: {
  step: SimulationStep;
  initialReviewCount: number;
}) {
  const isInitialFsrs =
    step.phase === 'review' && step.reviewNumber <= initialReviewCount;
  return (
    <>
      <span className="font-mono text-muted-foreground">
        {step.reviewNumber}
      </span>
      <span>
        {ratingLabel(step.rating)}
        {step.phaseTransitioned && (
          <span className="text-amber-500 ml-1">&rarr; FSRS</span>
        )}
      </span>
      <PhaseBadge phase={step.phase} isInitialFsrs={isInitialFsrs} />
      <span className="font-mono text-right">{step.intervalDescription}</span>
    </>
  );
}

function ratingLabel(rating: ReviewRating): string {
  switch (rating) {
  case 'stillLearning':
    return 'Still learning';
  case 'understood':
    return 'Understood';
  case 'again':
    return 'Again';
  case 'hard':
    return 'Hard';
  case 'good':
    return 'Good';
  case 'easy':
    return 'Easy';
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function SchedulingTest() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Scheduling Test
        </CardTitle>
        <CardDescription>
          Test the FSRS spaced repetition scheduler with pre-review phase
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="virtual">
          <TabsList className="w-full">
            <TabsTrigger value="virtual" className="flex-1">
              <Play className="h-3 w-3 mr-1" />
              Virtual Simulation
            </TabsTrigger>
            <TabsTrigger value="real" className="flex-1">
              <CalendarClock className="h-3 w-3 mr-1" />
              Real Cards
            </TabsTrigger>
          </TabsList>
          <TabsContent value="virtual" className="mt-4">
            <VirtualSimulation />
          </TabsContent>
          <TabsContent value="real" className="mt-4">
            <RealCardReview />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
