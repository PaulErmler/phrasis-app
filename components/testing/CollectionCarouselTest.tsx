"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid } from "lucide-react";
import {
  CollectionCarouselUI,
  type CollectionProgressItem,
} from "@/components/app/CollectionCarouselUI";
import { CollectionDetailDialog, type PreviewText } from "@/components/app/CollectionDetailDialog";

// ============================================================================
// MOCK DATA
// ============================================================================

function makeId(name: string): string {
  return `mock_collection_${name.toLowerCase()}`;
}

const ALL_COLLECTIONS: CollectionProgressItem[] = [
  { collectionId: makeId("Essential"), collectionName: "Essential", cardsAdded: 0, totalTexts: 1000 },
  { collectionId: makeId("A1"), collectionName: "A1", cardsAdded: 0, totalTexts: 800 },
  { collectionId: makeId("A2"), collectionName: "A2", cardsAdded: 0, totalTexts: 1200 },
  { collectionId: makeId("B1"), collectionName: "B1", cardsAdded: 0, totalTexts: 2000 },
  { collectionId: makeId("B2"), collectionName: "B2", cardsAdded: 0, totalTexts: 2500 },
  { collectionId: makeId("C1"), collectionName: "C1", cardsAdded: 0, totalTexts: 3000 },
  { collectionId: makeId("C2"), collectionName: "C2", cardsAdded: 0, totalTexts: 3000 },
];

const SAMPLE_TEXTS: PreviewText[] = [
  { _id: "t1", text: "I know I can't take Tom's place.", collectionRank: 1 },
  { _id: "t2", text: "That's what I like about Tom.", collectionRank: 2 },
  { _id: "t3", text: "I don't like it in the town in winter.", collectionRank: 3 },
  { _id: "t4", text: "That's not something that you forget.", collectionRank: 4 },
  { _id: "t5", text: "I don't have any time to waste.", collectionRank: 5 },
];

// ============================================================================
// STATE SCENARIOS
// ============================================================================

function ScenarioWrapper({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Badge variant="outline">{label}</Badge>
      {children}
    </div>
  );
}

/** 1. Fresh onboarding — A2 preselected, nothing done */
function FreshOnboardingScenario() {
  const [active, setActive] = useState<string | null>(makeId("A2"));
  const [openId, setOpenId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const collections = ALL_COLLECTIONS.map((c) => ({ ...c }));
  const opened = collections.find((c) => c.collectionId === openId);

  const handleAdd = () => {
    setIsAdding(true);
    setTimeout(() => setIsAdding(false), 1000);
  };

  return (
    <ScenarioWrapper label="Preselected from onboarding (A2 active, no progress)">
      <CollectionCarouselUI
        collections={collections}
        activeCollectionId={active}
        onSelectCollection={setActive}
        onOpenCollection={setOpenId}
        initialScrollIndex={2}
      />
      <CollectionDetailDialog
        open={openId !== null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        collectionName={opened?.collectionName ?? null}
        totalTexts={opened?.totalTexts ?? 0}
        cardsAdded={opened?.cardsAdded ?? 0}
        isActive={active === openId}
        isComplete={false}
        texts={SAMPLE_TEXTS}
        isLoadingTexts={false}
        isAdding={isAdding}
        onSelect={() => { if (openId) setActive(openId); }}
        onAddCards={handleAdd}
      />
    </ScenarioWrapper>
  );
}

/** 2. Mid-progress — Essential+A1 done, A2 at 40% */
function MidProgressScenario() {
  const [active, setActive] = useState<string | null>(makeId("A2"));
  const [openId, setOpenId] = useState<string | null>(null);

  const collections: CollectionProgressItem[] = ALL_COLLECTIONS.map((c) => {
    if (c.collectionName === "Essential") return { ...c, cardsAdded: c.totalTexts };
    if (c.collectionName === "A1") return { ...c, cardsAdded: c.totalTexts };
    if (c.collectionName === "A2") return { ...c, cardsAdded: Math.round(c.totalTexts * 0.4) };
    return { ...c };
  });

  const opened = collections.find((c) => c.collectionId === openId);
  const isOpenedComplete = opened ? opened.cardsAdded >= opened.totalTexts && opened.totalTexts > 0 : false;

  return (
    <ScenarioWrapper label="Essential + A1 done, A2 at 40%">
      <CollectionCarouselUI
        collections={collections}
        activeCollectionId={active}
        onSelectCollection={setActive}
        onOpenCollection={setOpenId}
      />
      <CollectionDetailDialog
        open={openId !== null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        collectionName={opened?.collectionName ?? null}
        totalTexts={opened?.totalTexts ?? 0}
        cardsAdded={opened?.cardsAdded ?? 0}
        isActive={active === openId}
        isComplete={isOpenedComplete}
        texts={isOpenedComplete ? [] : SAMPLE_TEXTS}
        isLoadingTexts={false}
        isAdding={false}
        onSelect={() => { if (openId) setActive(openId); }}
        onAddCards={() => {}}
      />
    </ScenarioWrapper>
  );
}

/** 3. Auto-advance simulation */
function AutoAdvanceScenario() {
  const [completedA2, setCompletedA2] = useState(false);
  const active = completedA2 ? makeId("B1") : makeId("A2");
  const [openId, setOpenId] = useState<string | null>(null);

  const collections: CollectionProgressItem[] = ALL_COLLECTIONS.map((c) => {
    if (c.collectionName === "Essential") return { ...c, cardsAdded: c.totalTexts };
    if (c.collectionName === "A1") return { ...c, cardsAdded: c.totalTexts };
    if (c.collectionName === "A2") {
      return completedA2
        ? { ...c, cardsAdded: c.totalTexts }
        : { ...c, cardsAdded: c.totalTexts - 5 };
    }
    return { ...c };
  });

  const opened = collections.find((c) => c.collectionId === openId);
  const isOpenedComplete = opened ? opened.cardsAdded >= opened.totalTexts && opened.totalTexts > 0 : false;

  return (
    <ScenarioWrapper label={completedA2 ? "A2 completed → auto-advanced to B1" : "A2 nearly done (5 remaining)"}>
      <div className="flex gap-3 items-center">
        <Button
          size="sm"
          variant={completedA2 ? "outline" : "default"}
          onClick={() => setCompletedA2(!completedA2)}
        >
          {completedA2 ? "Reset" : "Complete A2"}
        </Button>
      </div>
      <CollectionCarouselUI
        collections={collections}
        activeCollectionId={active}
        onSelectCollection={() => {}}
        onOpenCollection={setOpenId}
      />
      <CollectionDetailDialog
        open={openId !== null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        collectionName={opened?.collectionName ?? null}
        totalTexts={opened?.totalTexts ?? 0}
        cardsAdded={opened?.cardsAdded ?? 0}
        isActive={active === openId}
        isComplete={isOpenedComplete}
        texts={isOpenedComplete ? [] : SAMPLE_TEXTS}
        isLoadingTexts={false}
        isAdding={false}
        onSelect={() => {}}
        onAddCards={() => {}}
      />
    </ScenarioWrapper>
  );
}

/** 4. All complete */
function AllCompleteScenario() {
  const [openId, setOpenId] = useState<string | null>(null);

  const collections: CollectionProgressItem[] = ALL_COLLECTIONS.map((c) => ({
    ...c,
    cardsAdded: c.totalTexts,
  }));

  const opened = collections.find((c) => c.collectionId === openId);

  return (
    <ScenarioWrapper label="All collections complete, no active selection">
      <CollectionCarouselUI
        collections={collections}
        activeCollectionId={null}
        onSelectCollection={() => {}}
        onOpenCollection={setOpenId}
      />
      <CollectionDetailDialog
        open={openId !== null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        collectionName={opened?.collectionName ?? null}
        totalTexts={opened?.totalTexts ?? 0}
        cardsAdded={opened?.cardsAdded ?? 0}
        isActive={false}
        isComplete={true}
        texts={[]}
        isLoadingTexts={false}
        isAdding={false}
        onSelect={() => {}}
        onAddCards={() => {}}
      />
    </ScenarioWrapper>
  );
}

/** 5. Only C2 remaining */
function LastCollectionScenario() {
  const [openId, setOpenId] = useState<string | null>(null);

  const collections: CollectionProgressItem[] = ALL_COLLECTIONS.map((c) => {
    if (c.collectionName === "C2") return { ...c, cardsAdded: Math.round(c.totalTexts * 0.1) };
    return { ...c, cardsAdded: c.totalTexts };
  });

  const opened = collections.find((c) => c.collectionId === openId);
  const isOpenedComplete = opened ? opened.cardsAdded >= opened.totalTexts && opened.totalTexts > 0 : false;

  return (
    <ScenarioWrapper label="Only C2 remaining (10% progress)">
      <CollectionCarouselUI
        collections={collections}
        activeCollectionId={makeId("C2")}
        onSelectCollection={() => {}}
        onOpenCollection={setOpenId}
      />
      <CollectionDetailDialog
        open={openId !== null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        collectionName={opened?.collectionName ?? null}
        totalTexts={opened?.totalTexts ?? 0}
        cardsAdded={opened?.cardsAdded ?? 0}
        isActive={makeId("C2") === openId}
        isComplete={isOpenedComplete}
        texts={isOpenedComplete ? [] : SAMPLE_TEXTS}
        isLoadingTexts={false}
        isAdding={false}
        onSelect={() => {}}
        onAddCards={() => {}}
      />
    </ScenarioWrapper>
  );
}

/** 6. Loading state */
function LoadingScenario() {
  return (
    <ScenarioWrapper label="Loading skeleton">
      <CollectionCarouselUI
        collections={[]}
        activeCollectionId={null}
        onSelectCollection={() => {}}
        onOpenCollection={() => {}}
        isLoading={true}
      />
    </ScenarioWrapper>
  );
}

// ============================================================================
// MAIN TEST COMPONENT
// ============================================================================

export function CollectionCarouselTest() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" />
          Collection Carousel UI States
        </CardTitle>
        <CardDescription>
          All possible states rendered with mock data (no backend). Click a card to open the detail dialog.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="fresh" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
            <TabsTrigger value="fresh">Fresh Onboarding</TabsTrigger>
            <TabsTrigger value="mid">Mid-Progress</TabsTrigger>
            <TabsTrigger value="advance">Auto-Advance</TabsTrigger>
            <TabsTrigger value="allDone">All Complete</TabsTrigger>
            <TabsTrigger value="last">Last Collection</TabsTrigger>
            <TabsTrigger value="loading">Loading</TabsTrigger>
          </TabsList>

          <TabsContent value="fresh">
            <FreshOnboardingScenario />
          </TabsContent>
          <TabsContent value="mid">
            <MidProgressScenario />
          </TabsContent>
          <TabsContent value="advance">
            <AutoAdvanceScenario />
          </TabsContent>
          <TabsContent value="allDone">
            <AllCompleteScenario />
          </TabsContent>
          <TabsContent value="last">
            <LastCollectionScenario />
          </TabsContent>
          <TabsContent value="loading">
            <LoadingScenario />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
