'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Check,
  Eye,
  Layers,
  BookOpen,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK = {
  name: 'A1',
  description: 'Learn the 500 most common words',
  cardsAdded: 12,
  totalTexts: 295,
};

const SENTENCES = [
  { id: '1', base: 'Guten Morgen', target: 'Good morning' },
  { id: '2', base: 'Wie geht es Ihnen?', target: 'How are you?' },
  { id: '3', base: 'Ich heiße Anna', target: 'My name is Anna' },
  { id: '4', base: 'Danke schön', target: 'Thank you very much' },
  { id: '5', base: 'Auf Wiedersehen', target: 'Goodbye' },
];

const progress = (MOCK.cardsAdded / MOCK.totalTexts) * 100;
const remaining = MOCK.totalTexts - MOCK.cardsAdded;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function AccentBar() {
  return (
    <div className="h-1.5 bg-muted">
      <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
    </div>
  );
}

function StatsRow() {
  return (
    <div className="flex gap-3 text-xs">
      <div className="flex items-center gap-1">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span>{MOCK.cardsAdded} added</span>
      </div>
      <div className="flex items-center gap-1">
        <BookOpen className="h-3 w-3 text-muted-foreground" />
        <span>{remaining} remaining</span>
      </div>
    </div>
  );
}

function SentenceItem({ base, target }: { base: string; target: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 space-y-1.5">
      <p className="text-sm font-medium leading-snug">{base}</p>
      <Separator />
      <p className="text-xs text-muted-foreground leading-snug">{target}</p>
    </div>
  );
}

function PrototypeLabel({ number, title }: { number: number; title: string }) {
  return (
    <div className="space-y-1 mb-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Prototype {number}
      </p>
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prototype 1 — Compact Inline Card
// ---------------------------------------------------------------------------

function Prototype1() {
  const [selected, setSelected] = useState(false);

  return (
    <div>
      <PrototypeLabel number={1} title="Compact Inline Card" />
      <div className="rounded-xl border-2 bg-card overflow-hidden">
        <AccentBar />
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{MOCK.name}</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {MOCK.cardsAdded} / {MOCK.totalTexts} sentences
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {MOCK.description}
          </p>
          <StatsRow />
        </div>

        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <Button size="sm" variant="outline" className="text-xs">
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            Preview
          </Button>
          <Button
            size="sm"
            variant={selected ? 'secondary' : 'outline'}
            className="text-xs"
            onClick={() => setSelected(!selected)}
          >
            <Check className={cn('h-3.5 w-3.5 mr-1', !selected && 'invisible')} />
            {selected ? 'Selected' : 'Select'}
          </Button>
        </div>

        <Separator />

        <div className="px-3 pt-2 pb-1">
          <p className="text-xs font-medium text-muted-foreground">Next sentences</p>
        </div>
        <div className="px-3 pb-3 space-y-2 max-h-[200px] overflow-y-auto">
          {SENTENCES.map((s) => (
            <SentenceItem key={s.id} base={s.base} target={s.target} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prototype 2 — Expandable Card
// ---------------------------------------------------------------------------

function Prototype2() {
  const [selected, setSelected] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <PrototypeLabel number={2} title="Expandable Card" />
      <div className="rounded-xl border-2 bg-card overflow-hidden">
        <AccentBar />
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{MOCK.name}</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {MOCK.cardsAdded} / {MOCK.totalTexts} sentences
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {MOCK.description}
          </p>
          <StatsRow />
        </div>

        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <Button
            size="sm"
            variant={selected ? 'secondary' : 'outline'}
            className="text-xs"
            onClick={() => setSelected(!selected)}
          >
            <Check className={cn('h-3.5 w-3.5 mr-1', !selected && 'invisible')} />
            {selected ? 'Selected' : 'Select'}
          </Button>
          <Button size="sm" className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add 5
          </Button>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground py-2.5 hover:bg-accent/50 transition-colors border-t"
        >
          {expanded ? (
            <>
              Hide sentences <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              Show sentences <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>

        {expanded && (
          <div className="px-3 pb-3 space-y-2">
            {SENTENCES.map((s) => (
              <SentenceItem key={s.id} base={s.base} target={s.target} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prototype 3 — Full-Page View
// ---------------------------------------------------------------------------

function Prototype3() {
  const [selected, setSelected] = useState(false);

  return (
    <div>
      <PrototypeLabel number={3} title="Full-Page View" />
      <div className="space-y-4">
        {/* Hero card */}
        <div className="rounded-xl border-2 bg-card overflow-hidden">
          <AccentBar />
          <div className="p-4 space-y-3">
            <div>
              <h3 className="text-lg font-bold">{MOCK.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {MOCK.description}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-semibold tabular-nums">
                  {MOCK.cardsAdded} / {MOCK.totalTexts}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            <StatsRow />

            <div className="space-y-2 pt-1">
              <Button
                variant={selected ? 'secondary' : 'outline'}
                className="w-full"
                onClick={() => setSelected(!selected)}
              >
                {selected && <Check className="h-4 w-4 mr-1.5" />}
                {selected ? 'Selected' : 'Select Collection'}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="text-xs">
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                  Preview
                </Button>
                <Button size="sm" className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add 5
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Sentence cards */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
            Next Sentences
          </p>
          {SENTENCES.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border-2 bg-card p-3 space-y-1.5"
            >
              <p className="text-sm font-medium leading-snug">{s.base}</p>
              <Separator />
              <p className="text-xs text-muted-foreground leading-snug">
                {s.target}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prototype 4 — Split Panel
// ---------------------------------------------------------------------------

function Prototype4() {
  const [selected, setSelected] = useState(false);

  return (
    <div>
      <PrototypeLabel number={4} title="Split Panel" />
      <div className="space-y-3">
        {/* Stats card */}
        <div className="rounded-xl border-2 bg-card overflow-hidden">
          <AccentBar />
          <div className="p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{MOCK.name}</h3>
              <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {MOCK.description}
            </p>
            <Progress value={progress} className="h-1.5" />
            <StatsRow />
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                size="sm"
                variant={selected ? 'secondary' : 'outline'}
                className="text-xs"
                onClick={() => setSelected(!selected)}
              >
                {selected && <Check className="h-3 w-3 mr-1" />}
                {selected ? 'On' : 'Select'}
              </Button>
              <Button size="sm" variant="outline" className="text-xs">
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </Button>
              <Button size="sm" className="text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Add 5
              </Button>
            </div>
          </div>
        </div>

        {/* Sentences card */}
        <div className="rounded-xl border-2 bg-card overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b">
            <h4 className="text-xs font-semibold">Next Sentences</h4>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              5 available
            </span>
          </div>
          <div className="max-h-[250px] overflow-y-auto divide-y">
            {SENTENCES.map((s) => (
              <div key={s.id} className="px-3 py-2.5 space-y-0.5">
                <p className="text-sm font-medium leading-snug">{s.base}</p>
                <p className="text-xs text-muted-foreground leading-snug">
                  {s.target}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prototype 5 — Tabbed Card
// ---------------------------------------------------------------------------

function Prototype5() {
  const [selected, setSelected] = useState(false);

  return (
    <div>
      <PrototypeLabel number={5} title="Tabbed Card" />
      <div className="rounded-xl border-2 bg-card overflow-hidden">
        <AccentBar />
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{MOCK.name}</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {MOCK.cardsAdded} / {MOCK.totalTexts} sentences
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {MOCK.description}
          </p>
        </div>

        <div className="px-3 pb-3">
          <Tabs defaultValue="overview">
            <TabsList className="w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="sentences">Sentences</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-semibold tabular-nums">
                    {MOCK.cardsAdded} / {MOCK.totalTexts}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
              <StatsRow />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={selected ? 'secondary' : 'outline'}
                  className="text-xs"
                  onClick={() => setSelected(!selected)}
                >
                  <Check
                    className={cn('h-3.5 w-3.5 mr-1', !selected && 'invisible')}
                  />
                  {selected ? 'Selected' : 'Select'}
                </Button>
                <Button size="sm" className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add 5
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="sentences">
              <div className="space-y-2 max-h-[250px] overflow-y-auto pt-1">
                {SENTENCES.map((s) => (
                  <SentenceItem key={s.id} base={s.base} target={s.target} />
                ))}
              </div>
              <Button size="sm" className="w-full mt-3 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add All
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CollectionDetailPrototypes() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Collection Detail Prototypes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            5 variations matching the difficulty selection card style
          </p>
        </div>

        <Separator />

        <div className="grid gap-10 md:grid-cols-2">
          <Prototype1 />
          <Prototype2 />
          <Prototype3 />
          <Prototype4 />
          <Prototype5 />
        </div>
      </div>
    </div>
  );
}
