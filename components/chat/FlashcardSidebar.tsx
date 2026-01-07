"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader } from "@/components/ai-elements/loader";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

/**
 * Sidebar component to display user's flashcards
 */
export function FlashcardSidebar() {
  const flashcards = useQuery(api.chat.flashcards.listUserFlashcards);

  if (flashcards === undefined) {
    return (
      <aside className="hidden lg:flex w-80 border-l flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-lg">My Flashcards</h2>
          <p className="text-sm text-muted-foreground">Your saved learning cards</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader size={24} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden lg:flex w-80 border-l flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">My Flashcards</h2>
        <p className="text-sm text-muted-foreground">
          {flashcards.length} {flashcards.length === 1 ? "card" : "cards"}
        </p>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {flashcards.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">
                No flashcards yet
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Ask your teacher to create some!
              </p>
            </div>
          ) : (
            flashcards.map((flashcard) => (
              <Card key={flashcard._id} className="overflow-hidden">
                <CardHeader className="p-3 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium leading-tight">
                      {flashcard.text}
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      #{flashcard.randomNumber}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <CardDescription className="text-xs mb-2">
                    {flashcard.note}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(flashcard.date), "MMM d, yyyy")}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}



