'use client';

import { ChevronLeft, Sparkles, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * "Add your own sentences" replica. The learn-what-matters-to-you story:
 * personal hobby sentences typed in, translations + audio generated.
 */
const TYPED = [
  'Where is the nearest climbing gym?',
  'Can I rent climbing shoes here?',
  'Is this route suitable for beginners?',
];

const GENERATED = [
  { base: 'Where is the nearest climbing gym?', target: '¿Dónde está el rocódromo más cercano?' },
  { base: 'Can I rent climbing shoes here?', target: '¿Puedo alquilar pies de gato aquí?' },
  { base: 'Is this route suitable for beginners?', target: '¿Esta vía es adecuada para principiantes?' },
];

export function CustomScreen() {
  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      <header className="sheet-header">
        <div className="flex items-center gap-1 min-w-0">
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="heading-section truncate">Add Cards</h1>
        </div>
      </header>

      <div className="flex-1 overflow-hidden px-4 py-4 space-y-3">
        {/* Input area with the user's own sentences */}
        <div className="card-surface p-3 space-y-2">
          <label className="label-form">Your sentences</label>
          <div className="rounded-lg border bg-background px-3 py-2.5 text-sm leading-relaxed">
            {TYPED.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <Button className="w-full gap-2">
            <Sparkles className="h-4 w-4" />
            Add 3 sentences
          </Button>
        </div>

        {/* Generated cards */}
        <div className="space-y-2">
          {GENERATED.map((card, i) => (
            <div key={card.base} className="card-surface p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-xs">New</Badge>
                {i === 0 && (
                  <Badge className="border-transparent bg-primary/10 text-primary text-xs">
                    Audio ready
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{card.base}</p>
              <div className="flex items-start gap-2">
                <p className="text-base font-medium flex-1">{card.target}</p>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                  <Volume2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
