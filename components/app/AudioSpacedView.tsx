"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useConvexAuth, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Play, Pause } from "lucide-react";
import { BottomNav } from "@/components/app/BottomNav";

type ReviewRating = "again" | "hard" | "good" | "easy";

const formatTime = (seconds: number) => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

export function AudioSpacedView() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : "skip");
  const userId = currentUser?._id;
  
  // Fetch user preferences first
  const userPreferences = useQuery(
    api.userPreferences.getUserPreferences,
    userId ? { userId } : "skip"
  );
 
 
  // Fetch cards due for review
  const cardsQuery = useQuery(
    api.cardActions.getCardsDueForReview,
    userId ? { userId, limit: 1 } : "skip"
  );
  
  // Fetch card stats for count display
  const cardStats = useQuery(
    api.cardActions.getCardStats,
    userId ? { userId } : "skip"
  );

  const [currentCard, setCurrentCard] = useState<any>(null);
  const [showTarget, setShowTarget] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);
  const [autoplayDelaySourceToTarget, setAutoplayDelaySourceToTarget] = useState(2000);
  const [autoplayDelayTargetToNext, setAutoplayDelayTargetToNext] = useState(3000);
  const [showSettings, setShowSettings] = useState(false);
  const [manualPlayMode, setManualPlayMode] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const reviewStartTimeRef = useRef<number>(Date.now());
  const currentAudioUrlRef = useRef<string>("");
  const autoplayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoplayEnabledRef = useRef(false);

  // Mutations & Actions
  const rateCardMutation = useMutation(api.cardActions.rateCardReview);
  const markCardAsSeenMutation = useMutation(api.cardActions.markCardAsSeenInInitialLearning);
  const skipInitialLearningMutation = useMutation(api.cardActions.skipInitialLearningPhase);
  const updatePreferencesMutation = useMutation(api.userPreferences.updateUserPreferences);
  const requestAudioMutation = useMutation(api.audioRequests.requestAudio);
  const [audioRequestId, setAudioRequestId] = useState<string | null>(null);
  const audioRequest = useQuery(
    api.audioRequests.getRequest,
    audioRequestId ? { requestId: audioRequestId as any } : "skip"
  );

  // Handle audio request completion
  useEffect(() => {
    if (audioRequest?.status === "completed" && audioRequest.audioUrl && currentAudioUrlRef.current !== audioRequest.audioUrl) {
      currentAudioUrlRef.current = audioRequest.audioUrl;
      playAudio(audioRequest.audioUrl);
    }
  }, [audioRequest?.status, audioRequest?.audioUrl]);
  
  // Load settings from user preferences
  useEffect(() => {
    if (userPreferences) {
      setAutoplayDelaySourceToTarget(userPreferences.autoplayDelaySourceToTarget ?? 2000);
      setAutoplayDelayTargetToNext(userPreferences.autoplayDelayTargetToNext ?? 3000);
    }
  }, [userPreferences]);

  // Sync autoplay enabled state to ref for use in event handlers
  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled;
  }, [autoplayEnabled]);

  // Helper to request audio via mutation (captures intent, generates in background)
  const requestAudio = async (text: string, language: string) => {
    try {
      const requestId = await requestAudioMutation({
        text,
        language,
      });
      setAudioRequestId(requestId);
      
      // Wait for completion via useQuery subscription (returns immediately)
      return null; // Will be handled by useEffect watching audioRequest
    } catch (error) {
      console.error("Error requesting audio:", error);
      return null;
    }
  };

  // Toggle audio play/pause
  const toggleAudioPlayPause = () => {
    if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play().catch(() => setIsPlayingAudio(false));
        setIsPlayingAudio(true);
      }
    }
  };

  // Play audio with proper cleanup
  const playAudio = async (url: string) => {
    if (!url) return;
    if (audioRef.current) {
      // Stop current playback and cleanup
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      
      try {
        audioRef.current.src = url;
        setIsPlayingAudio(true);
        await audioRef.current.play();
      } catch (error: any) {
        // Ignore AbortError from user interruption, log other errors
        if (error.name !== 'AbortError') {
          console.error("Playback error:", error);
        }
        setIsPlayingAudio(false);
      }
    }
  };

  // Load initial card when cards query completes
  useEffect(() => {
    if (cardsQuery && cardsQuery.length > 0) {
      setCurrentCard(cardsQuery[0]);
      setShowTarget(false);
      setManualPlayMode(false);
      reviewStartTimeRef.current = Date.now();
      
      // Clear any pending autoplay timeouts
      if (autoplayTimeoutRef.current) {
        clearTimeout(autoplayTimeoutRef.current);
        autoplayTimeoutRef.current = null;
      }
      
      // Request source language audio
      (async () => {
        const sourceText = cardsQuery[0].sourceText;
        const sourceLang = cardsQuery[0].sourceLanguage || "en"     
        // Fetch the audio URL
        try {
          const audioUrl = await requestAudio(sourceText, sourceLang);
          if (audioUrl) {
            currentAudioUrlRef.current = audioUrl;
            await playAudio(audioUrl);
          }
        } catch (error) {
          console.error("Error loading audio:", error);
        }
      })();
    } else if (cardsQuery && cardsQuery.length === 0) {
      // No more cards due
      setCurrentCard(null);
    }
  }, [cardsQuery]);

  // Update elapsed time when showing target translation
  useEffect(() => {
    if (showTarget) {
      // Request target language audio (non-blocking)
      (async () => {
        if (currentCard) {
          const targetText = currentCard.targetText;
          const targetLang = currentCard.targetLanguage || "es";
          const requestId = await requestAudio(targetText, targetLang);
          
        // For now, fetch the audio URL immediately (TODO: implement lazy loading)
        try {
          const audioUrl = await requestAudio(targetText, targetLang);
          if (audioUrl) {
            currentAudioUrlRef.current = audioUrl;
            await playAudio(audioUrl);
          }
        } catch (error) {
          console.error("Error loading audio:", error);
        }
        }
      })();
    }
  }, [showTarget, currentCard]);

  // Update progress and handle autoplay transitions
  useEffect(() => {
    if (!audioRef.current) return;

    const updateProgress = () => {
      setCurrentTime(audioRef.current?.currentTime || 0);
      setDuration(audioRef.current?.duration || 0);
    };

    const handleAudioEnded = async () => {
      setIsPlayingAudio(false);
      setCurrentTime(0);
      
      if (currentCard && !manualPlayMode && autoplayEnabledRef.current) {
        const isInitialLearning = currentCard.isInInitialLearning;
        
        if (!showTarget) {
          // Source language just finished, schedule target reveal
          autoplayTimeoutRef.current = setTimeout(() => {
            setShowTarget(true);
          }, autoplayDelaySourceToTarget);
        } else {
          // Target language just finished - auto-advance
          autoplayTimeoutRef.current = setTimeout(() => {
            if (isInitialLearning) {
              // Initial learning: just mark as seen
              handleRate();
            } else {
              // FSRS: auto-rate as "good"
              handleRate("good");
            }
          }, autoplayDelayTargetToNext);
        }
      }
    };

    audioRef.current.addEventListener('timeupdate', updateProgress);
    audioRef.current.addEventListener('loadedmetadata', updateProgress);
    audioRef.current.addEventListener('ended', handleAudioEnded);

    return () => {
      audioRef.current?.removeEventListener('timeupdate', updateProgress);
      audioRef.current?.removeEventListener('loadedmetadata', updateProgress);
      audioRef.current?.removeEventListener('ended', handleAudioEnded);
    };
  }, [autoplayDelaySourceToTarget, autoplayDelayTargetToNext, currentCard, showTarget]);

  // Early returns for auth checks (after all hooks)
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 max-w-md text-center">
          <Spinner />
        </Card>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">Audio Spaced Repetition</h1>
          <p className="text-gray-600">Please sign in to access spaced repetition learning.</p>
        </Card>
      </div>
    );
  }

  const handleRate = async (rating?: ReviewRating) => {
    if (!currentCard || !userId || isLoading) return;

    try {
      setIsLoading(true);
      setManualPlayMode(false); // Reset manual mode for next card
      const totalElapsed = Math.round((Date.now() - reviewStartTimeRef.current) / 1000);
      
      if (currentCard.isInInitialLearning) {
        // Initial learning phase: mark as seen
        await markCardAsSeenMutation({
          userId,
          cardId: currentCard._id,
        });
      } else {
        // FSRS phase: submit rating
        if (!rating) return;
        await rateCardMutation({
          userId,
          cardId: currentCard._id,
          sentenceId: currentCard.sentenceId,
          rating,
          elapsedSeconds: totalElapsed,
        });
      }

      // The cardsQuery will automatically refetch and provide the next card
      // since it watches userId and the database state changes
    } catch (error) {
      console.error("Rating error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 max-w-md">
          <h1 className="text-2xl font-bold mb-4">Audio Spaced Repetition</h1>
          <p className="text-gray-600 mb-4">
            Please sign in to access spaced repetition learning.
          </p>
        </Card>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="max-w-3xl mx-auto p-4 py-8 space-y-4">
          {/* Back Button */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => window.history.back()}
              variant="outline"
              size="sm"
            >
              ← Back
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground uppercase tracking-wide">Audio Practice</p>
            <h1 className="text-3xl font-bold">Spaced Repetition</h1>
          </div>

          {/* All Done Card */}
          <div className="flex justify-center pt-8">
            <Card className="max-w-md w-full">
              <CardHeader className="text-center">
                <div className="text-6xl mb-4">🎉</div>
                <CardTitle>Great Job!</CardTitle>
                <CardDescription>
                  No cards are due for review right now. Come back later to continue learning!
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => window.history.back()}
                  className="w-full"
                  variant="outline"
                >
                  ← Go Back Home
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Bottom Navigation */}
        <BottomNav currentView="home" onViewChange={() => {}} hidePlayButton={true} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-3xl mx-auto p-4 py-8 space-y-4">
        {/* Back Button */}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.history.back()}
            variant="outline"
            size="sm"
          >
            ← Back
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground uppercase tracking-wide">Audio Practice</p>
          <h1 className="text-3xl font-bold">Spaced Repetition</h1>
        </div>

        {/* Cards Remaining Counter */}
        {cardStats && (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-3 bg-muted/50 border border-border px-4 py-2 rounded-lg text-sm">
              <span className={`w-2 h-2 rounded-full ${currentCard?.isInInitialLearning ? 'bg-cyan-500' : 'bg-orange-500'}`} />
              <span>
                {currentCard?.isInInitialLearning ? (
                  <>
                    📚 Learning: <span className="font-semibold">{cardStats.initialLearningDueNow}</span> remaining
                  </>
                ) : (
                  <>
                    🔁 Review: <span className="font-semibold">{cardStats.dueCount}</span> due
                  </>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Autoplay Controls */}
        <div className="flex justify-center gap-3">
          <Button
            onClick={() => setAutoplayEnabled(!autoplayEnabled)}
            variant={autoplayEnabled ? "default" : "outline"}
            size="sm"
          >
            {autoplayEnabled ? "▶ Autoplay: On" : "⏸ Autoplay: Off"}
          </Button>
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="outline"
            size="sm"
          >
            ⚙️ Settings
          </Button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Initial Learning Reviews Required */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Initial Learning Reviews Required
                </label>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={async () => {
                      const newValue = Math.max(1, (userPreferences?.initialLearningReviewsRequired ?? 4) - 1);
                      if (userId) {
                        await updatePreferencesMutation({ userId, initialLearningReviewsRequired: newValue });
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-10 h-10"
                  >
                    -
                  </Button>
                  <span className="text-lg font-semibold w-12 text-center">
                    {userPreferences?.initialLearningReviewsRequired ?? 4}
                  </span>
                  <Button
                    onClick={async () => {
                      const newValue = Math.min(10, (userPreferences?.initialLearningReviewsRequired ?? 4) + 1);
                      if (userId) {
                        await updatePreferencesMutation({ userId, initialLearningReviewsRequired: newValue });
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-10 h-10"
                  >
                    +
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Number of times to review new cards before FSRS starts (1-10)</p>
              </div>
              
              {/* Skip Initial Learning Phase */}
              {cardStats && cardStats.initialLearningCount > 0 && (
                <div className="pt-3 border-t border-border/50">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Skip Initial Learning
                  </label>
                  <Button
                    onClick={async () => {
                      if (userId && confirm(`Graduate all ${cardStats.initialLearningCount} learning cards to FSRS immediately?`)) {
                        const result = await skipInitialLearningMutation({ userId });
                        if (result.success) {
                          alert(`✓ Graduated ${result.graduatedCount} cards to FSRS!`);
                        }
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full text-amber-700 border-amber-300 hover:bg-amber-50"
                  >
                    🚀 Skip to FSRS ({cardStats.initialLearningCount} cards)
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    Move all learning cards directly to spaced repetition
                  </p>
                </div>
              )}
              
              {/* Autoplay Delays */}
              <div className="pt-3 border-t border-border/50">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Autoplay Delays</h4>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Source to Target Delay
                    </label>
                    <div className="flex items-center gap-3 mt-2">
                      <Button
                        onClick={async () => {
                          const newValue = Math.max(0, autoplayDelaySourceToTarget - 500);
                          setAutoplayDelaySourceToTarget(newValue);
                          if (userId) {
                            await updatePreferencesMutation({ userId, autoplayDelaySourceToTarget: newValue });
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="w-10 h-10"
                      >
                        -
                      </Button>
                      <span className="text-lg font-semibold w-16 text-center">
                        {(autoplayDelaySourceToTarget / 1000).toFixed(1)}s
                      </span>
                      <Button
                        onClick={async () => {
                          const newValue = Math.min(10000, autoplayDelaySourceToTarget + 500);
                          setAutoplayDelaySourceToTarget(newValue);
                          if (userId) {
                            await updatePreferencesMutation({ userId, autoplayDelaySourceToTarget: newValue });
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="w-10 h-10"
                      >
                        +
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Wait time after source audio before showing translation</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Target to Next Card Delay
                    </label>
                    <div className="flex items-center gap-3 mt-2">
                      <Button
                        onClick={async () => {
                          const newValue = Math.max(0, autoplayDelayTargetToNext - 500);
                          setAutoplayDelayTargetToNext(newValue);
                          if (userId) {
                            await updatePreferencesMutation({ userId, autoplayDelayTargetToNext: newValue });
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="w-10 h-10"
                      >
                        -
                      </Button>
                      <span className="text-lg font-semibold w-16 text-center">
                        {(autoplayDelayTargetToNext / 1000).toFixed(1)}s
                      </span>
                      <Button
                        onClick={async () => {
                          const newValue = Math.min(10000, autoplayDelayTargetToNext + 500);
                          setAutoplayDelayTargetToNext(newValue);
                          if (userId) {
                            await updatePreferencesMutation({ userId, autoplayDelayTargetToNext: newValue });
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="w-10 h-10"
                      >
                        +
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Wait time after target audio before auto-advancing</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Card */}
        <Card>
          <CardContent className="p-8">
            {/* Source Language Sentence with Audio Progress */}
            <div
              className="space-y-4 cursor-pointer"
              onClick={() => {
                if (!showTarget) {
                  startTimeRef.current = Date.now();
                  setShowTarget(true);
                }
              }}
            >
              <div className="space-y-2">
                <p 
                  className="text-3xl md:text-4xl font-medium text-gray-900 leading-snug cursor-pointer hover:text-emerald-600 transition-colors"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!showTarget) {
                      startTimeRef.current = Date.now();
                      setShowTarget(true);
                    } else {
                      setManualPlayMode(true);
                      const sourceText = currentCard.sourceText;
                      const sourceLang = currentCard.sourceLanguage || (userPreferences?.sourceLanguage ?? "en");
                      const requestId = await requestAudio(sourceText, sourceLang);
                      
                      // Fetch audio URL for manual playback
                      try {
                        const result = await fetch(`/api/audio?text=${encodeURIComponent(sourceText)}&language=${sourceLang}`);
                        if (result.ok) {
                          const data = await result.json();
                          if (data.audioUrl) {
                            currentAudioUrlRef.current = data.audioUrl;
                            await playAudio(data.audioUrl);
                          }
                        }
                      } catch (error) {
                        console.error("Error loading audio:", error);
                      }
                    }
                  }}
                >
                  {currentCard.sourceText}
                </p>
              </div>

              {/* Target Translation (below Source) */}
              {showTarget && (
                <p 
                  className="text-2xl md:text-3xl text-muted-foreground leading-snug cursor-pointer hover:text-teal-600 transition-colors"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setManualPlayMode(true);
                    const targetText = currentCard.targetText;
                    const targetLang = currentCard.targetLanguage || (userPreferences?.targetLanguage ?? "es");
                    const requestId = await requestAudio(targetText, targetLang);
                    
                    // Fetch audio URL for manual playback
                    try {
                      const result = await fetch(`/api/audio?text=${encodeURIComponent(targetText)}&language=${targetLang}`);
                      if (result.ok) {
                        const data = await result.json();
                        if (data.audioUrl) {
                          currentAudioUrlRef.current = data.audioUrl;
                          await playAudio(data.audioUrl);
                        }
                      }
                    } catch (error) {
                      console.error("Error loading audio:", error);
                    }
                  }}
                >
                  {currentCard.targetText}
                </p>
              )}

              {/* Audio Progress Bar */}
              <div className="w-full mt-4 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatTime(currentTime)}</span>
                  <span>-{formatTime(duration - currentTime)}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-200 ${
                      isPlayingAudio ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Play/Pause Button */}
            <div className="flex justify-center">
              {!isPlayingAudio ? (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAudioPlayPause();
                  }}
                  size="icon"
                  className="h-14 w-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
                >
                  <Play className="h-6 w-6 fill-current text-primary-foreground" />
                </Button>
              ) : (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAudioPlayPause();
                  }}
                  size="icon"
                  className="h-14 w-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
                >
                  <Pause className="h-6 w-6 fill-current text-primary-foreground" />
                </Button>
              )}
            </div>

            {/* Instructions */}
            {!showTarget && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <p>Tap anywhere on the card to reveal the translation.</p>
              </div>
            )}
            
            {showTarget && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <p>Click on any text to hear it. Use the center button to pause/play.</p>
              </div>
            )}

            {/* Rating Buttons (only after target is revealed) */}
            {showTarget && (
              <div className="pt-4 border-t border-border/70 space-y-3">
                {currentCard.isInInitialLearning ? (
                  <>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 mb-3">
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 text-center mb-1">
                        📚 Initial Learning Phase
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 text-center">
                        Review {currentCard.initialReviewCount || 0}/{userPreferences?.initialLearningReviewsRequired ?? 4} · Just familiarize yourself with the content
                      </p>
                    </div>
                    <div className="flex justify-center">
                      <Button
                        onClick={() => handleRate()}
                        disabled={isLoading}
                        className="bg-blue-500 hover:bg-blue-600"
                        size="lg"
                      >
                        {isLoading ? <Spinner /> : "Next →"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-gray-700 text-center">How well did you know this?</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Button
                        onClick={() => handleRate("again")}
                        disabled={isLoading}
                        className="bg-red-500 hover:bg-red-600"
                      >
                        {isLoading ? <Spinner /> : "❌ Again"}
                      </Button>
                      <Button
                        onClick={() => handleRate("hard")}
                        disabled={isLoading}
                        className="bg-yellow-500 hover:bg-yellow-600"
                      >
                        {isLoading ? <Spinner /> : "😰 Hard"}
                      </Button>
                      <Button
                        onClick={() => handleRate("good")}
                        disabled={isLoading}
                        className="bg-blue-500 hover:bg-blue-600"
                      >
                        {isLoading ? <Spinner /> : "👍 Good"}
                      </Button>
                      <Button
                        onClick={() => handleRate("easy")}
                        disabled={isLoading}
                        className="bg-green-500 hover:bg-green-600"
                      >
                        {isLoading ? <Spinner /> : "✨ Easy"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Audio Element */}
            <audio
              ref={audioRef}
              onEnded={() => setIsPlayingAudio(false)}
              className="hidden"
            />
          </CardContent>
        </Card>
      </div>

      {/* Bottom Navigation */}
      <BottomNav currentView="home" onViewChange={() => {}} hidePlayButton={true} />
    </div>
  );
}
