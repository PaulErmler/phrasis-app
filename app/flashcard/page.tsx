"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const ENGLISH_SENTENCE = "I like cookies.";

export default function FlashcardPage() {
  const router = useRouter();
  const [translation, setTranslation] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const translateText = useAction(api.translation.translateText);

  const handleCardClick = async () => {
    if (translation) {
      // If translation already exists, don't hide it, just do nothing
      return;
    }

    // Fetch translation
    setIsLoading(true);
    try {
      const result = await translateText({
        text: ENGLISH_SENTENCE,
        sourceLang: "en",
        targetLang: "es", // Translate to Spanish
      });
      setTranslation(result.translatedText);
    } catch (error) {
      console.error("Translation error:", error);
      setTranslation("Translation failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-20">
      <div className="w-full max-w-2xl space-y-6">
        <Button
          variant="ghost"
          onClick={() => router.push("/app")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to App
        </Button>

        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={handleCardClick}
        >
          <CardContent className="p-8 text-center space-y-4">
            <div>
              <p className="text-2xl md:text-3xl font-medium mb-2">
                {ENGLISH_SENTENCE}
              </p>
              {isLoading && (
                <div className="text-muted-foreground text-lg mt-4">
                  Translating...
                </div>
              )}
              {translation && !isLoading && (
                <div className="mt-6 pt-6 border-t border-border">
                  <p className="text-xl md:text-2xl font-medium text-muted-foreground">
                    {translation}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="text-center text-sm text-muted-foreground">
          {translation 
            ? "Translation shown below" 
            : "Click the card to see the Spanish translation"}
        </div>
      </div>
    </main>
  );
}

