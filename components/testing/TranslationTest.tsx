"use client";

import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Languages, ArrowLeftRight, Loader2 } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { MAX_TRANSLATION_LENGTH } from "@/lib/constants/translation";

export function TranslationTest() {
  const [sourceText, setSourceText] = useState("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("es");
  const [requestId, setRequestId] = useState<Id<"translationRequests"> | null>(null);
  const [displayedResult, setDisplayedResult] = useState("");

  const requestTranslation = useMutation(api.translation.requestTranslation);
  
  // Query the translation request - reactively updates when the result is ready
  const translationRequest = useQuery(
    api.translation.getTranslationRequest,
    requestId ? { requestId } : "skip"
  );

  // Update displayed result when translation completes
  useEffect(() => {
    if (translationRequest?.status === "completed" && translationRequest.result) {
      setDisplayedResult(translationRequest.result);
    } else if (translationRequest?.status === "failed") {
      setDisplayedResult(`Error: ${translationRequest.error || "Translation failed"}`);
    }
  }, [translationRequest]);

  const handleSourceTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    if (text.length <= MAX_TRANSLATION_LENGTH) {
      setSourceText(text);
    }
  };

  const handleSwapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    if (displayedResult && !displayedResult.startsWith("Error:")) {
      setSourceText(displayedResult);
      setDisplayedResult(sourceText);
    }
  };

  const handleTranslate = useCallback(async () => {
    if (!sourceText.trim()) return;
    if (sourceText.length > MAX_TRANSLATION_LENGTH) return;
    
    try {
      // Clear previous result and request a new translation
      setDisplayedResult("");
      const newRequestId = await requestTranslation({
        text: sourceText.trim(),
        sourceLang,
        targetLang,
      });
      setRequestId(newRequestId);
    } catch (error) {
      console.error("Translation request failed:", error);
      setDisplayedResult("Failed to request translation. Please try again.");
    }
  }, [sourceText, sourceLang, targetLang, requestTranslation]);

  const isTranslating = requestId !== null && translationRequest?.status === "pending";
  const isOverLimit = sourceText.length > MAX_TRANSLATION_LENGTH;
  const charCountColor = isOverLimit 
    ? "text-destructive" 
    : sourceText.length > MAX_TRANSLATION_LENGTH * 0.9 
      ? "text-warning" 
      : "text-muted-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Languages className="h-5 w-5" />
          Translation Test
        </CardTitle>
        <CardDescription>
          Test the Google Cloud Translation API
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Language Selectors with Swap Button */}
        <div className="flex items-center gap-2">
          <Select value={sourceLang} onValueChange={setSourceLang}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="From" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSwapLanguages}
            className="shrink-0"
            title="Swap languages"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          
          <Select value={targetLang} onValueChange={setTargetLang}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="To" />
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

        {/* Source Text Input with Character Counter */}
        <div className="space-y-1">
          <Textarea
            placeholder="Enter text to translate..."
            value={sourceText}
            onChange={handleSourceTextChange}
            className="min-h-[100px] resize-none"
          />
          <div className="flex justify-end">
            <span className={`text-xs ${charCountColor}`}>
              {sourceText.length}/{MAX_TRANSLATION_LENGTH}
            </span>
          </div>
        </div>

        {/* Translate Button */}
        <Button
          onClick={handleTranslate}
          disabled={isTranslating || !sourceText.trim() || isOverLimit}
          className="w-full"
        >
          {isTranslating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Translating...
            </>
          ) : (
            "Translate"
          )}
        </Button>

        {/* Translation Result */}
        {displayedResult && (
          <div className={`rounded-lg p-3 ${displayedResult.startsWith("Error:") ? "bg-destructive/10" : "bg-muted"}`}>
            <p className="text-xs text-muted-foreground mb-1">
              {displayedResult.startsWith("Error:") ? "Error:" : "Translation:"}
            </p>
            <p className={`text-sm ${displayedResult.startsWith("Error:") ? "text-destructive" : ""}`}>
              {displayedResult.startsWith("Error:") ? displayedResult.slice(7) : displayedResult}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
