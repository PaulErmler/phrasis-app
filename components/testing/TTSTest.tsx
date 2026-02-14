"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Volume2, Loader2, Play, Pause, AlertCircle } from "lucide-react";
import { 
  SUPPORTED_LANGUAGES, 
  getVoicesByLanguageCode, 
  getLocalesByLanguageCode, 
  getLocaleFromApiCode,
  Voice 
} from "@/lib/languages";
import { MAX_TTS_LENGTH, TTS_SPEED_OPTIONS, DEFAULT_TTS_SPEED } from "@/lib/constants/tts";

export function TTSTest() {
  const [text, setText] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [selectedLocale, setSelectedLocale] = useState("en-US");
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_TTS_SPEED);
  const [requestId, setRequestId] = useState<Id<"ttsRequests"> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const requestTTS = useMutation(api.testing.tts.requestTTS);

  // Query the TTS request - reactively updates when the result is ready
  const ttsRequest = useQuery(
    api.testing.tts.getTTSRequest,
    requestId ? { requestId } : "skip"
  );

  // Get available locales for the selected language
  const availableLocales = useMemo(() => {
    return getLocalesByLanguageCode(selectedLanguage);
  }, [selectedLanguage]);

  // Get available voices for the selected locale
  const availableVoices = useMemo(() => {
    const voices = getVoicesByLanguageCode(selectedLanguage);
    return voices.filter((v) => getLocaleFromApiCode(v.apiCode) === selectedLocale);
  }, [selectedLanguage, selectedLocale]);

  // Group voices by gender
  const voicesByGender = useMemo(() => {
    const female = availableVoices.filter((v) => v.gender === "female");
    const male = availableVoices.filter((v) => v.gender === "male");
    return { female, male };
  }, [availableVoices]);

  // Update locale when language changes
  useEffect(() => {
    const locales = getLocalesByLanguageCode(selectedLanguage);
    if (locales.length > 0 && !locales.includes(selectedLocale)) {
      setSelectedLocale(locales[0]);
    }
  }, [selectedLanguage, selectedLocale]);

  // Update selected voice when locale changes
  useEffect(() => {
    if (availableVoices.length > 0) {
      // Try to keep the same voice name if available in the new locale
      const sameVoice = selectedVoice
        ? availableVoices.find((v) => v.name === selectedVoice.name)
        : null;
      if (sameVoice) {
        setSelectedVoice(sameVoice);
      } else {
        // Default to first female voice
        const defaultVoice = availableVoices.find((v) => v.gender === "female") || availableVoices[0];
        setSelectedVoice(defaultVoice);
      }
    }
  }, [availableVoices, selectedVoice]);

  // Handle audio playback when request completes
  useEffect(() => {
    if (ttsRequest?.status === "completed" && ttsRequest.audioUrl) {
      // Create audio element and play
      if (audioRef.current) {
        audioRef.current.src = ttsRequest.audioUrl;
        audioRef.current.play().catch(console.error);
        setIsPlaying(true);
      }
    }
  }, [ttsRequest?.status, ttsRequest?.audioUrl]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
    };
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    if (newText.length <= MAX_TTS_LENGTH) {
      setText(newText);
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!text.trim() || !selectedVoice) return;

    try {
      // Stop any playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      const newRequestId = await requestTTS({
        text: text.trim(),
        voiceName: selectedVoice.apiCode,
        speed,
      });
      setRequestId(newRequestId);
    } catch (error) {
      console.error("TTS request failed:", error);
    }
  }, [text, selectedVoice, speed, requestTTS]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
  };

  const isGenerating = requestId !== null && ttsRequest?.status === "pending";
  const hasError = ttsRequest?.status === "failed";
  const hasAudio = ttsRequest?.status === "completed" && ttsRequest.audioUrl;
  const isOverLimit = text.length > MAX_TTS_LENGTH;
  const charCountColor = isOverLimit
    ? "text-destructive"
    : text.length > MAX_TTS_LENGTH * 0.9
      ? "text-warning"
      : "text-muted-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Volume2 className="h-5 w-5" />
          Text-to-Speech Test
        </CardTitle>
        <CardDescription>
          Test Google Cloud TTS with Chirp3 HD voices
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hidden audio element */}
        <audio ref={audioRef} />

        {/* Language and Locale Selection */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Language</Label>
            <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
              <SelectTrigger>
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Accent</Label>
            <Select value={selectedLocale} onValueChange={setSelectedLocale}>
              <SelectTrigger>
                <SelectValue placeholder="Accent" />
              </SelectTrigger>
              <SelectContent>
                {availableLocales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {locale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Voice Selection */}
        <div className="space-y-1.5">
          <Label className="text-xs">Voice</Label>
          <Select
            value={selectedVoice?.apiCode || ""}
            onValueChange={(apiCode) => {
              const voice = availableVoices.find((v) => v.apiCode === apiCode);
              if (voice) setSelectedVoice(voice);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select voice" />
            </SelectTrigger>
            <SelectContent>
              {voicesByGender.female.length > 0 && (
                <>
                  <SelectItem value="_female_header" disabled className="font-semibold text-xs opacity-60">
                    Female Voices
                  </SelectItem>
                  {voicesByGender.female.map((voice) => (
                    <SelectItem key={voice.apiCode} value={voice.apiCode}>
                      {voice.name} (Female)
                    </SelectItem>
                  ))}
                </>
              )}
              {voicesByGender.male.length > 0 && (
                <>
                  <SelectItem value="_male_header" disabled className="font-semibold text-xs opacity-60">
                    Male Voices
                  </SelectItem>
                  {voicesByGender.male.map((voice) => (
                    <SelectItem key={voice.apiCode} value={voice.apiCode}>
                      {voice.name} (Male)
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Speed Selection */}
        <div className="space-y-1.5">
          <Label className="text-xs">Speed</Label>
          <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
            <SelectTrigger>
              <SelectValue placeholder="Speed" />
            </SelectTrigger>
            <SelectContent>
              {TTS_SPEED_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Text Input */}
        <div className="space-y-1">
          <Textarea
            placeholder="Enter text to synthesize..."
            value={text}
            onChange={handleTextChange}
            className="min-h-[100px] resize-none"
          />
          <div className="flex justify-end">
            <span className={`text-xs ${charCountColor}`}>
              {text.length}/{MAX_TTS_LENGTH}
            </span>
          </div>
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !text.trim() || !selectedVoice || isOverLimit}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Volume2 className="h-4 w-4 mr-2" />
              Generate Audio
            </>
          )}
        </Button>

        {/* Error Message */}
        {hasError && (
          <div className="rounded-lg p-3 bg-destructive/10 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <p className="text-sm text-destructive">
              {ttsRequest?.error || "TTS generation failed"}
            </p>
          </div>
        )}

        {/* Audio Playback Controls */}
        {hasAudio && (
          <div className="rounded-lg p-3 bg-muted space-y-2">
            <p className="text-xs text-muted-foreground">Generated Audio:</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePlayPause}
                className="flex-shrink-0"
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-4 w-4 mr-1" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-1" />
                    Play
                  </>
                )}
              </Button>
              <span className="text-sm text-muted-foreground truncate">
                {selectedVoice?.displayName}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
