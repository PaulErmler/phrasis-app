"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useConvexAuth, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type ReviewRating = "again" | "hard" | "good" | "easy";

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

  const audioRef = useRef<HTMLAudioElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const reviewStartTimeRef = useRef<number>(Date.now());
  const currentAudioUrlRef = useRef<string>("");

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

  // Play audio
  const playAudio = async (url: string) => {
    if (!url) return;
    if (audioRef.current) {
      audioRef.current.src = url;
      setIsPlayingAudio(true);
      try {
        await audioRef.current.play();
      } catch (error) {
        console.error("Playback error:", error);
        setIsPlayingAudio(false);
      }
    }
  };

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
      reviewStartTimeRef.current = Date.now();
      
      // Play English audio automatically
      (async () => {
        const url = await getAudioUrl(cardsQuery[0].english, "en");
        if (url) {
          currentAudioUrlRef.current = url;
          await playAudio(url);
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
            await playAudio(url);
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
          <div className="space-y-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">English</p>
                <p className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug">
                  {currentCard.english}
                </p>
              </div>
              <div className="flex gap-3 justify-start md:justify-end">
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    playAudio(currentAudioUrlRef.current).then(() =>
                      setIsPlayingAudio(false)
                    );
                  }}
                  disabled={isPlayingAudio || !currentAudioUrlRef.current}
                  className="bg-emerald-500 hover:bg-emerald-600"
                >
                  🔊 Play English
                </Button>
              </div>
            </div>

            {/* Spanish Section */}
            {showSpanish && (
              <div className="pt-6 border-t border-border/70 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Spanish</p>
                <p className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug">
                  {currentCard.spanish}
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      playAudio(currentAudioUrlRef.current).then(() =>
                        setIsPlayingAudio(false)
                      );
                    }}
                    disabled={isPlayingAudio || !currentAudioUrlRef.current}
                    className="bg-teal-500 hover:bg-teal-600"
                  >
                    🔊 Play Spanish
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

            {/* Tap instruction before reveal */}
            {!showSpanish && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <p>Tap anywhere on the card to reveal the translation and hear it.</p>
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
          </div>
        </Card>
      </div>
    </div>
  );
}
