"use client";

import { useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Layers, Languages } from "lucide-react";
import { AudioButton } from "@/components/app/learning/AudioButton";

export function DeckCardsView() {
  const deckCards = useQuery(api.features.decks.getDeckCards, {});
  const activeCourse = useQuery(api.features.courses.getActiveCourse);
  const ensureCardContent = useMutation(api.features.decks.ensureCardContent);
  
  // Track which cards we've already triggered regeneration for
  // to avoid calling the mutation repeatedly
  const regeneratedCardsRef = useRef<Set<string>>(new Set());

  // Automatically trigger content generation for cards with missing content
  useEffect(() => {
    if (!deckCards) return;

    const cardsWithMissingContent = deckCards.filter(
      (card) => card.hasMissingContent && !regeneratedCardsRef.current.has(card.textId)
    );

    // Trigger regeneration for each card with missing content (limit to avoid too many mutations)
    const cardsToProcess = cardsWithMissingContent.slice(0, 5);
    
    for (const card of cardsToProcess) {
      regeneratedCardsRef.current.add(card.textId);
      ensureCardContent({ textId: card.textId as Id<"texts"> }).catch((err) => {
        console.error("Failed to ensure card content:", err);
        // Remove from set so it can be retried later
        regeneratedCardsRef.current.delete(card.textId);
      });
    }
  }, [deckCards, ensureCardContent]);

  if (deckCards === undefined || activeCourse === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Your Deck
          </CardTitle>
          <CardDescription>Loading cards...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (deckCards.length === 0) {
      return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Your Deck
          </CardTitle>
          <CardDescription>
            No cards in your deck yet. Add some cards from a collection above!
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Your Deck
          <Badge variant="secondary" className="ml-2">
            {deckCards.length} cards
          </Badge>
        </CardTitle>
        <CardDescription>
          Cards with translations and audio
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <Accordion type="single" collapsible className="w-full space-y-2">
            {deckCards.map((card, index) => {
              // Get base language translation (the language the user knows)
              const baseTranslation = card.translations.find(
                (t) => t.isBaseLanguage && t.text
              );
              // Get target language translation (the language being learned)
              const targetTranslation = card.translations.find(
                (t) => t.isTargetLanguage && t.text
              );

              // Get audio for each
              const baseAudio = baseTranslation
                ? card.audioRecordings.find((a) => a.language === baseTranslation.language)
                : null;
              const targetAudio = targetTranslation
                ? card.audioRecordings.find((a) => a.language === targetTranslation.language)
                : null;

              return (
                <AccordionItem
                  key={card._id}
                  value={card._id}
                  className="border rounded-lg px-4"
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex-1 text-left">
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground font-mono text-sm min-w-[2rem]">
                          {index + 1}.
                        </span>
                        <div className="flex-1">
                          {/* Show base language text (what user knows) */}
                          <p className="font-medium text-sm leading-relaxed">
                            {baseTranslation?.text || card.sourceText}
                          </p>
                          {/* Show target language text (what user is learning) */}
                          {targetTranslation?.text && (
                            <p className="text-muted-sm mt-1 leading-relaxed">
                              {targetTranslation.text}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="space-y-4 pl-8">
                      {/* Base Language Section (what user knows) */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {(baseTranslation?.language || card.sourceLanguage).toUpperCase()}
                          </Badge>
                          <span className="text-sm font-medium">Base (You know this)</span>
                        </div>
                        <p className="text-sm">{baseTranslation?.text || card.sourceText}</p>
                        {!baseTranslation?.text && baseTranslation === undefined && (
                          <p className="text-muted-sm italic">Translating...</p>
                        )}
                        <div className="flex gap-2">
                          <AudioButton
                            url={baseAudio?.url ?? null}
                            language={(baseTranslation?.language || card.sourceLanguage).toUpperCase()}
                            showLabel
                          />
                        </div>
                      </div>

                      {/* Target Language Section (what user is learning) */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Languages className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="secondary" className="text-xs">
                            {targetTranslation?.language.toUpperCase() || "TARGET"}
                          </Badge>
                          <span className="text-sm font-medium">Target (Learning this)</span>
                        </div>
                        {targetTranslation?.text ? (
                          <p className="text-sm">{targetTranslation.text}</p>
                        ) : (
                          <p className="text-muted-sm italic">Translating...</p>
                        )}
                        <div className="flex gap-2">
                          <AudioButton
                            url={targetAudio?.url ?? null}
                            language={targetTranslation?.language.toUpperCase() || ""}
                            showLabel
                          />
                        </div>
                      </div>

                      {/* Card Status */}
                      <div className="flex items-center gap-2 pt-2 border-t">
                        {card.isMastered && (
                          <Badge variant="default" className="text-xs">
                            Mastered
                          </Badge>
                        )}
                        {card.isHidden && (
                          <Badge variant="outline" className="text-xs">
                            Hidden
                          </Badge>
                        )}
                        <span className="text-muted-xs">
                          Due: {new Date(card.dueDate).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
