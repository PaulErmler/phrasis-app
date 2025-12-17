"use client";

import { useState, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const ENGLISH_SENTENCE = "I like cookies.";

export default function AudioFlashcardPage() {
  const [translation, setTranslation] = useState<string | null>(null);
  const [englishAudioUrl, setEnglishAudioUrl] = useState<string | null>(null);
  const [spanishAudioUrl, setSpanishAudioUrl] = useState<string | null>(null);
  const [isPlayingEnglish, setIsPlayingEnglish] = useState(false);
  const [isPlayingSpanish, setIsPlayingSpanish] = useState(false);
  const [isLoadingEnglish, setIsLoadingEnglish] = useState(false);
  const [isLoadingSpanish, setIsLoadingSpanish] = useState(false);
  const [isLoadingTranslation, setIsLoadingTranslation] = useState(false);

  const englishAudioRef = useRef<HTMLAudioElement>(new Audio());
  const spanishAudioRef = useRef<HTMLAudioElement>(new Audio());

  const translateText = useAction(api.textToSpeech.translateText);
  const generateSpeech = useAction(api.textToSpeech.generateSpeech);

  // Stop all audio
  const stopAudio = () => {
    if (!englishAudioRef.current || !spanishAudioRef.current) return;

    englishAudioRef.current.pause();
    englishAudioRef.current.currentTime = 0;
    setIsPlayingEnglish(false);

    spanishAudioRef.current.pause();
    spanishAudioRef.current.currentTime = 0;
    setIsPlayingSpanish(false);
  };

  // Handle card click: fetch translation
  const handleCardClick = async () => {
    setIsLoadingTranslation(true);
    try {
      const result = await translateText({
        text: ENGLISH_SENTENCE,
        sourceLang: "en",
        targetLang: "es",
      });
      setTranslation(result.translatedText);
    } catch (error) {
      console.error("Translation error:", error);
      setTranslation("Translation failed.");
    } finally {
      setIsLoadingTranslation(false);
    }
  };

  // Play audio
  const playAudio = async (
    text: string,
    lang: string,
    ref: React.MutableRefObject<HTMLAudioElement>,
    setUrl: React.Dispatch<React.SetStateAction<string | null>>,
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
    setLoading: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    stopAudio();
    setLoading(true);
  
    try {
      const audioUrl = await generateSpeech({ text, language: lang });
      setUrl(audioUrl);
  
      ref.current.src = audioUrl;
      ref.current.onended = () => setPlaying(false);
  
      await ref.current.play();
      setPlaying(true);
    } catch (error) {
      console.error("Audio error:", error);
      alert("Failed to play audio");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-20">
      <div className="w-full max-w-2xl space-y-6">
        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={handleCardClick}
        >
          <CardContent className="p-8 text-center">
            <p className="text-2xl md:text-3xl font-medium mb-3">
              {ENGLISH_SENTENCE}
            </p>

            {isLoadingTranslation && <p>Translating...</p>}

            {translation && !isLoadingTranslation && (
              <p className="mt-4 text-xl md:text-2xl text-muted-foreground">
                {translation}
              </p>
            )}
          </CardContent>
        </Card>

        {/* English Audio Button */}
        <Button
          onClick={() =>
            playAudio(
              ENGLISH_SENTENCE,
              "en-US",
              englishAudioRef,
              setEnglishAudioUrl,
              setIsPlayingEnglish,
              setIsLoadingEnglish
            )
          }
          disabled={isLoadingEnglish}
        >
          {isLoadingEnglish
            ? "Loading..."
            : isPlayingEnglish
            ? "Stop English"
            : "Play English"}
        </Button>

        {/* Spanish Audio Button */}
        <Button
          onClick={() => {
            if (!translation) return alert("Click the card first to get translation");
            playAudio(
              translation,
              "es-ES",
              spanishAudioRef,
              setSpanishAudioUrl,
              setIsPlayingSpanish,
              setIsLoadingSpanish
            );
          }}
          disabled={isLoadingSpanish}
        >
          {isLoadingSpanish
            ? "Loading..."
            : isPlayingSpanish
            ? "Stop Spanish"
            : "Play Spanish"}
        </Button>
      </div>
    </main>
  );
}
