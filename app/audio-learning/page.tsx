"use client";

import { useState, useRef, useEffect } from "react";
import { useAction, useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Play, Pause, Settings } from "lucide-react";

export default function AudioLearningPage() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : "skip");
  const userId = currentUser?._id;
  
  // Fetch due cards from FSRS
  const cardsQuery = useQuery(
    api.cardActions.getCardsDueForReview,
    userId ? { userId, limit: 100 } : "skip"
  );
  
  const [cards, setCards] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [englishAudioUrl, setEnglishAudioUrl] = useState<string | null>(null);
  const [spanishAudioUrl, setSpanishAudioUrl] = useState<string | null>(null);
  const [isPlayingEnglish, setIsPlayingEnglish] = useState(false);
  const [isPlayingSpanish, setIsPlayingSpanish] = useState(false);
  const [isLoadingEnglish, setIsLoadingEnglish] = useState(false);
  const [isLoadingSpanish, setIsLoadingSpanish] = useState(false);
  const [isLoadingSpanishAudio, setIsLoadingSpanishAudio] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [isAutoplayActive, setIsAutoplayActive] = useState(false);
  const [autoplayDelayEnglishToSpanish, setAutoplayDelayEnglishToSpanish] = useState(2000);
  const [autoplayDelaySpanishToNext, setAutoplayDelaySpanishToNext] = useState(3000);
  const [showSettings, setShowSettings] = useState(false);
  const englishAudioRef = useRef<HTMLAudioElement>(new Audio());
  const spanishAudioRef = useRef<HTMLAudioElement>(new Audio());
  const autoplayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoplayActiveRef = useRef(false);
  const autoplayEnabledRef = useRef(true);
  const currentSentenceIndexRef = useRef(0);
  const translationCacheRef = useRef<Record<string, string>>({});
  const audioCacheRef = useRef<Record<string, string>>({});
  const translateText = useAction(api.translationFunctions.getOrTranslate);
  const generateSpeech = useAction(api.audioFunctions.getOrRecordAudio);

  // Load cards when query completes
  useEffect(() => {
    if (cardsQuery && cardsQuery.length > 0) {
      setCards(cardsQuery);
      setCurrentIndex(0);
      setShowTranslation(false);
    }
  }, [cardsQuery]);

  // Keep refs updated with current state
  useEffect(() => {
    isAutoplayActiveRef.current = isAutoplayActive;
  }, [isAutoplayActive]);

  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled;
  }, [autoplayEnabled]);

  useEffect(() => {
    currentSentenceIndexRef.current = currentIndex;
  }, [currentIndex]);

  const currentSentence = cards && cards.length > 0 ? cards[currentIndex] : null;

  // Stop all audio and clear timeouts
  const stopAudio = () => {
    englishAudioRef.current.pause();
    englishAudioRef.current.currentTime = 0;
    spanishAudioRef.current.pause();
    spanishAudioRef.current.currentTime = 0;
    setIsPlayingEnglish(false);
    setIsPlayingSpanish(false);
    setIsAutoplayActive(false);
    setCurrentTime(0);
    setDuration(0);
    if (autoplayTimeoutRef.current) {
      clearTimeout(autoplayTimeoutRef.current);
      autoplayTimeoutRef.current = null;
    }
  };

  // Update progress
  useEffect(() => {
    const audio = isPlayingEnglish ? englishAudioRef.current : spanishAudioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('loadedmetadata', updateProgress);
    };
  }, [isPlayingEnglish, isPlayingSpanish]);

  // Handle card click: toggle translation
  const handleCardClick = async () => {
    if (!showTranslation) {
      setIsLoadingSpanish(true);
      try {
        await translateText({
          text: currentSentence.english,
          sourceLang: "en",
          targetLang: "es",
        });
      } catch (error) {
        console.error("Translation error:", error);
      } finally {
        setIsLoadingSpanish(false);
      }
    }
    setShowTranslation(!showTranslation);
  };

  // Play audio
  const playAudio = async (text: string, lang: string, ref: React.MutableRefObject<HTMLAudioElement>, setUrl: React.Dispatch<React.SetStateAction<string | null>>, setPlaying: React.Dispatch<React.SetStateAction<boolean>>, setLoading: React.Dispatch<React.SetStateAction<boolean>>, isEnglish: boolean) => {
    // If playing English, start fetching translation in background
    if (isEnglish && !showTranslation) {
      const translationCacheKey = `${text}_en_es`;
      if (translationCacheRef.current[translationCacheKey]) {
        // Translation is already cached
        setIsLoadingSpanish(false);
      } else {
        setIsLoadingSpanish(true);
        translateText({
          text: text,
          sourceLang: "en",
          targetLang: "es",
        }).then(() => {
          translationCacheRef.current[translationCacheKey] = "cached";
          setIsLoadingSpanish(false);
        }).catch((error) => {
          console.error("Translation error:", error);
          setIsLoadingSpanish(false);
        });
      }
    }

    // Stop any current playback without stopping autoplay
    englishAudioRef.current.pause();
    englishAudioRef.current.currentTime = 0;
    spanishAudioRef.current.pause();
    spanishAudioRef.current.currentTime = 0;
    setIsPlayingEnglish(false);
    setIsPlayingSpanish(false);
    setCurrentTime(0);
    setDuration(0);
    if (autoplayTimeoutRef.current) {
      clearTimeout(autoplayTimeoutRef.current);
      autoplayTimeoutRef.current = null;
    }
    setLoading(true);

    try {
      // Check cache first
      const audioCacheKey = `${text}_${lang}`;
      let audioUrl: string;
      
      if (audioCacheRef.current[audioCacheKey]) {
        console.log('Using cached audio for:', text);
        audioUrl = audioCacheRef.current[audioCacheKey];
      } else {
        console.log('Fetching new audio for:', text);
        const result = await generateSpeech({ text, language: lang });
        audioUrl = result.audioUrl;
        audioCacheRef.current[audioCacheKey] = audioUrl;
      }
      
      setUrl(audioUrl);

      ref.current.src = '';
      ref.current.src = audioUrl;
      ref.current.onloadedmetadata = () => setDuration(ref.current.duration);
      ref.current.onended = () => {
        console.log('Audio ended. isEnglish:', isEnglish, 'isAutoplayActive:', isAutoplayActiveRef.current, 'autoplayEnabled:', autoplayEnabledRef.current);
        setPlaying(false);
        setCurrentTime(0);
        if (isEnglish && autoplayEnabledRef.current && isAutoplayActiveRef.current) {
          console.log('Scheduling Spanish audio');
          setShowTranslation(true);
          // Use the sentence index that was playing when English audio started
          const sentenceIndexThatJustPlayed = currentSentenceIndexRef.current;
          const spanishText = cards[sentenceIndexThatJustPlayed]?.spanish;
          if (spanishText) {
            autoplayTimeoutRef.current = setTimeout(() => {
              console.log('Playing Spanish audio:', spanishText);
              playAudio(spanishText, "es", spanishAudioRef, setSpanishAudioUrl, setIsPlayingSpanish, setIsLoadingSpanishAudio, false);
            }, autoplayDelayEnglishToSpanish);
          }
        } else if (!isEnglish && autoplayEnabledRef.current && isAutoplayActiveRef.current) {
            console.log('Scheduling next card');
            autoplayTimeoutRef.current = setTimeout(() => {
              goToNext(true);
            }, autoplayDelaySpanishToNext);
        }
    };
      await ref.current.play();
      setPlaying(true);
    } catch (error) {
      console.error("Audio error:", error);
      alert("Failed to play audio");
    } finally {
      setLoading(false);
    }
  };

  const playEnglishAudio = () => playAudio(currentSentence.english, "en", englishAudioRef, setEnglishAudioUrl, setIsPlayingEnglish, setIsLoadingEnglish, true);
  const playSpanishAudio = () => {
    playAudio(currentSentence.spanish, "es", spanishAudioRef, setSpanishAudioUrl, setIsPlayingSpanish, setIsLoadingSpanishAudio, false);
  };

  const togglePlay = () => {
    if (isAutoplayActive) {
      stopAudio();
    } else {
      setIsAutoplayActive(true);
      playEnglishAudio();
    }
  };

  const goToNext = (autoPlay = false) => {
    const newIndex = (currentIndex + 1) % cards.length;
    setCurrentIndex(newIndex);
    setShowTranslation(false);
    if (!autoPlay) {
      stopAudio();
    }
    if (autoPlay && autoplayEnabled) {
      setTimeout(() => {
        const sentence = cards[newIndex];
        playAudio(sentence.english, "en", englishAudioRef, setEnglishAudioUrl, setIsPlayingEnglish, setIsLoadingEnglish, true);
      }, 0);
    }
  };

  const goToPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
    setShowTranslation(false);
    stopAudio();
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const remainingTime = duration - currentTime;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Loading state
  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-20 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
        <Card className="p-8">Loading...</Card>
      </main>
    );
  }

  // Auth state
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-20 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">Audio Learning</h1>
          <p className="text-gray-600">Please sign in to access learning mode.</p>
        </Card>
      </main>
    );
  }

  // No cards state
  if (!cards || cards.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-20 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">No Cards Available</h1>
          <p className="text-gray-600">Add cards to start practicing!</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-20 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
      <div className="w-full max-w-2xl space-y-6">
        {/* Practice Mode Badge */}
        <div className="text-center">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-emerald-700 bg-emerald-200 rounded-full">
            Practice Mode - Zero FSRS Impact
          </span>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            onClick={goToPrev}
            variant="outline"
            size="icon"
            disabled={cards.length <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm text-muted-foreground">
            {currentIndex + 1} / {cards.length}
          </div>
          <Button
            onClick={() => goToNext()}
            variant="outline"
            size="icon"
            disabled={cards.length <= 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Main Card */}
        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow bg-white/80 backdrop-blur-sm"
          onClick={handleCardClick}
        >
          <CardContent className="p-8 text-center space-y-4">
            <p className="text-3xl md:text-4xl font-medium mb-4">
              {currentSentence.english}
            </p>

            {isLoadingSpanish && <p className="text-sm text-muted-foreground">Translating...</p>}

            {showTranslation && !isLoadingSpanish && (
              <p className="text-2xl md:text-3xl text-muted-foreground">
                {currentSentence.spanish}
              </p>
            )}

            {/* Progress Bar */}
            <div className="w-full mt-4">
              <div className="flex justify-between text-sm text-muted-foreground mb-1">
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime(remainingTime)}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-200 ${isPlayingEnglish || isPlayingSpanish ? 'bg-emerald-500' : 'bg-gray-300'}`}
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Play Button */}
        <div className="flex justify-center">
          <Button
            onClick={togglePlay}
            disabled={isLoadingEnglish || isLoadingSpanishAudio}
            size="lg"
            className="rounded-full w-16 h-16 bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg"
          >
            {isLoadingEnglish || isLoadingSpanishAudio ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isAutoplayActive || isPlayingEnglish || isPlayingSpanish ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6 ml-1" />
            )}
          </Button>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-4">
          <Button
            onClick={() => setAutoplayEnabled(!autoplayEnabled)}
            variant="outline"
            size="sm"
          >
            Autoplay: {autoplayEnabled ? "On" : "Off"}
          </Button>
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="outline"
            size="sm"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <Card className="border-border/50 shadow-lg">
            <CardContent className="p-4 space-y-4">
              <div>
                <label className="text-sm font-medium">Delay English to Spanish (ms)</label>
                <input
                  type="number"
                  value={autoplayDelayEnglishToSpanish}
                  onChange={(e) => setAutoplayDelayEnglishToSpanish(Number(e.target.value))}
                  className="w-full mt-1 p-2 border rounded"
                  min="0"
                  step="500"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Delay Spanish to Next Card (ms)</label>
                <input
                  type="number"
                  value={autoplayDelaySpanishToNext}
                  onChange={(e) => setAutoplayDelaySpanishToNext(Number(e.target.value))}
                  className="w-full mt-1 p-2 border rounded"
                  min="0"
                  step="500"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <div className="text-center text-sm text-muted-foreground space-y-1">
          <p>Click the card to show/hide translation</p>
          <p>Use arrows to navigate cards (stops autoplay)</p>
          <p>Autoplay: Click play to start loop, pause to stop</p>
          <p>Adjust delays in settings</p>
        </div>
      </div>
    </main>
  );
}