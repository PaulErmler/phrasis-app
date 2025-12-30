"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useConvexAuth, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type ReviewRating = "again" | "hard" | "good" | "easy";

const formatTime = (seconds: number) => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

export default function AudioSpacedRepetitionPage() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : "skip");
  const userId = currentUser?._id;
  
  // Fetch cards due for review
  const cardsQuery = useQuery(
    api.cardActions.getCardsDueForReview,
    userId ? { userId, limit: 1 } : "skip"
  );

  const [currentCard, setCurrentCard] = useState<any>(null);
  const [showSpanish, setShowSpanish] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);
  const [autoplayDelayEnglishToSpanish, setAutoplayDelayEnglishToSpanish] = useState(2000);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAudioType, setSelectedAudioType] = useState<'english' | 'spanish'>('english');
  const [manualPlayMode, setManualPlayMode] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const reviewStartTimeRef = useRef<number>(Date.now());
  const currentAudioUrlRef = useRef<string>("");
  const autoplayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoplayEnabledRef = useRef(false);

  // Keep autoplayEnabled ref in sync with state
  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled;
  }, [autoplayEnabled]);

  // Mutations & Actions
  const rateCardMutation = useMutation(api.cardActions.rateCardReview);
  const generateSpeech = useAction(api.audioFunctions.getOrRecordAudio);

  // Get audio URL via Convex action (uses text + language)
  const getAudioUrl = async (text: string, language: "en" | "es") => {
    try {
      const result = await generateSpeech({ text, language });
      return result.audioUrl;
    } catch (error) {
      console.error("Audio fetch error:", error);
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
  const playAudio = async (url: string, isEnglish: boolean = false) => {
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
      
      if (autoplayEnabledRef.current && currentCard && !manualPlayMode) {
        if (!showSpanish) {
          // English just finished, schedule Spanish reveal
          autoplayTimeoutRef.current = setTimeout(() => {
            setShowSpanish(true);
          }, autoplayDelayEnglishToSpanish);
        } else {
          // Spanish just finished, DON'T auto-rate!
          // User must manually rate to ensure accurate FSRS assessment
          // Just stop and wait for user rating
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
  }, [autoplayDelayEnglishToSpanish, currentCard, showSpanish]);

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

  // Load initial card when cards query completes
  useEffect(() => {
    if (cardsQuery && cardsQuery.length > 0) {
      setCurrentCard(cardsQuery[0]);
      setShowSpanish(false);
      setElapsedSeconds(0);
      setManualPlayMode(false);
      reviewStartTimeRef.current = Date.now();
      
      // Clear any pending autoplay timeouts
      if (autoplayTimeoutRef.current) {
        clearTimeout(autoplayTimeoutRef.current);
        autoplayTimeoutRef.current = null;
      }
      
      // Play English audio
      (async () => {
        const url = await getAudioUrl(cardsQuery[0].english, "en");
        if (url) {
          currentAudioUrlRef.current = url;
          await playAudio(url, true);
        }
      })();
    }
  }, [cardsQuery]);

  // Update elapsed time when showing Spanish
  useEffect(() => {
    if (showSpanish) {
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
      
      // Play Spanish audio automatically
      (async () => {
        if (currentCard) {
          const url = await getAudioUrl(currentCard.spanish, "es");
          if (url) {
            currentAudioUrlRef.current = url;
            await playAudio(url, false);
          }
        }
      })();
    }
  }, [showSpanish, currentCard]);

  // Handle rating
  const handleRate = async (rating: ReviewRating) => {
    if (!currentCard || !userId || isLoading) return;

    try {
      setIsLoading(true);
      setManualPlayMode(false); // Reset manual mode for next card
      const totalElapsed = Math.round((Date.now() - reviewStartTimeRef.current) / 1000);
      
      // Submit rating
      await rateCardMutation({
        userId,
        cardId: currentCard._id,
        sentenceId: currentCard.sentenceId,
        rating,
        elapsedSeconds: totalElapsed,
      });

      // Fetch next card
      const nextCardsResponse = await fetch(
        `/api/cards?userId=${userId}&limit=1`
      );
      
      if (nextCardsResponse.ok) {
        const nextCards = await nextCardsResponse.json();
        if (nextCards.length > 0) {
          setCurrentCard(nextCards[0]);
          setShowSpanish(false);
          setElapsedSeconds(0);
          reviewStartTimeRef.current = Date.now();
          
          // Play English audio for next card
          const url = await getAudioUrl(nextCards[0].english, "en");
          if (url) {
            currentAudioUrlRef.current = url;
            await playAudio(url);
          }
        } else {
          setCurrentCard(null);
        }
      }
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
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">No Cards Due</h1>
          <p className="text-gray-600">
            Great job! No cards are due for review right now.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50 to-teal-100 p-4">
      <div className="max-w-3xl mx-auto py-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-emerald-600 font-semibold">Spaced Repetition</p>
            <h1 className="text-3xl font-bold text-gray-900">Audio Spaced Repetition</h1>
            <p className="text-sm text-muted-foreground">Tap to reveal, listen, then rate your recall.</p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground bg-white/70 border border-border/60 px-3 py-2 rounded-lg shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Now reviewing</span>
          </div>
        </div>

        {/* Autoplay Controls */}
        <div className="flex justify-center gap-3">
          <Button
            onClick={() => setAutoplayEnabled(!autoplayEnabled)}
            variant="outline"
            size="sm"
            className={autoplayEnabled ? "bg-emerald-100 border-emerald-300" : ""}
          >
            Autoplay: {autoplayEnabled ? "On" : "Off"}
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
          <Card className="border-border/50 shadow-lg bg-white/95">
            <div className="p-4 space-y-4">
              <h3 className="font-semibold text-sm">Autoplay Settings</h3>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Delay English to Spanish (ms): {autoplayDelayEnglishToSpanish}
                </label>
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="500"
                  value={autoplayDelayEnglishToSpanish}
                  onChange={(e) => setAutoplayDelayEnglishToSpanish(Number(e.target.value))}
                  className="w-full mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">Wait time after English audio plays before showing Spanish</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Delay Spanish to Next Card: 3000ms</p>
                <p className="text-xs text-muted-foreground">Wait time after Spanish audio plays before moving to next card</p>
              </div>
            </div>
          </Card>
        )}

        {/* Main Card */}
        <Card
          className="p-8 shadow-lg cursor-pointer hover:shadow-xl transition-shadow bg-white/90 border border-border/70"
          onClick={() => {
            if (!showSpanish) {
              startTimeRef.current = Date.now();
              setShowSpanish(true);
            }
          }}
        >
          <div className="space-y-6">
            {/* English Sentence with Audio Progress */}
            <div className="space-y-4">
              <div className="space-y-2">
                <p 
                  className="text-3xl md:text-4xl font-medium text-gray-900 leading-snug cursor-pointer hover:text-emerald-600 transition-colors"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!showSpanish) {
                      startTimeRef.current = Date.now();
                      setShowSpanish(true);
                    } else {
                      setSelectedAudioType('english');
                      setManualPlayMode(true);
                      const url = await getAudioUrl(currentCard.english, 'en');
                      if (url) {
                        currentAudioUrlRef.current = url;
                        await playAudio(url, true);
                      }
                    }
                  }}
                >
                  {currentCard.english}
                </p>
              </div>

              {/* Spanish Translation (below English) */}
              {showSpanish && (
                <p 
                  className="text-2xl md:text-3xl text-muted-foreground leading-snug cursor-pointer hover:text-teal-600 transition-colors"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setSelectedAudioType('spanish');
                    setManualPlayMode(true);
                    const url = await getAudioUrl(currentCard.spanish, 'es');
                    if (url) {
                      currentAudioUrlRef.current = url;
                      await playAudio(url, false);
                    }
                  }}
                >
                  {currentCard.spanish}
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
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAudioPlayPause();
                }}
                size="lg"
                className="rounded-full w-16 h-16 bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg flex items-center justify-center"
              >
                {isPlayingAudio ? (
                  <span className="text-2xl">⏸️</span>
                ) : (
                  <span className="text-2xl">▶️</span>
                )}
              </Button>
            </div>

            {/* Instructions */}
            {!showSpanish && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <p>Tap anywhere on the card to reveal the translation.</p>
              </div>
            )}
            
            {showSpanish && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <p>Click on English or Spanish text to hear it. Use the center button to pause/play.</p>
              </div>
            )}

            {/* Rating Buttons (only after Spanish is revealed) */}
            {showSpanish && (
              <div className="pt-4 border-t border-border/70 space-y-3">
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
              </div>
            )}

            {/* Audio Element */}
            <audio
              ref={audioRef}
              onEnded={() => setIsPlayingAudio(false)}
              className="hidden"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
