'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { LandingAudioButton } from '@/components/landing/LandingAudioButton';
import { CircleCheck, EyeOff, Star } from 'lucide-react';
import { highlightWord } from '@/lib/wordCloud';

interface MockSentence {
  id: string;
  reviewCount: number;
  base: string;
  target: string;
}

const MOCK_SENTENCES: Record<string, MockSentence[]> = {
  amigo: [
    { id: 'amigo-1', reviewCount: 12, base: 'My friend came to the party.', target: 'Mi amigo vino a la fiesta.' },
    { id: 'amigo-2', reviewCount: 5, base: 'He is a good friend.', target: 'Él es un buen amigo.' },
  ],
  vida: [
    { id: 'vida-1', reviewCount: 8, base: 'Life is beautiful.', target: 'La vida es hermosa.' },
    { id: 'vida-2', reviewCount: 3, base: 'That changed my life.', target: 'Eso cambió mi vida.' },
  ],
  país: [
    { id: 'pais-1', reviewCount: 6, base: 'This country is very large.', target: 'Este país es muy grande.' },
    { id: 'pais-2', reviewCount: 2, base: 'I want to visit that country.', target: 'Quiero visitar ese país.' },
  ],
  tiempo: [
    { id: 'tiempo-1', reviewCount: 10, base: 'I don\'t have time today.', target: 'No tengo tiempo hoy.' },
    { id: 'tiempo-2', reviewCount: 4, base: 'Time passes quickly.', target: 'El tiempo pasa rápido.' },
  ],
  casa: [
    { id: 'casa-1', reviewCount: 15, base: 'I am going home.', target: 'Voy a casa.' },
    { id: 'casa-2', reviewCount: 7, base: 'The house is very old.', target: 'La casa es muy vieja.' },
  ],
  fiesta: [
    { id: 'fiesta-1', reviewCount: 3, base: 'The party was great.', target: 'La fiesta fue genial.' },
    { id: 'fiesta-2', reviewCount: 1, base: 'Are you coming to the party?', target: '¿Vienes a la fiesta?' },
  ],
  manera: [
    { id: 'manera-1', reviewCount: 9, base: 'There is no way to do it.', target: 'No hay manera de hacerlo.' },
    { id: 'manera-2', reviewCount: 4, base: 'I like the way you think.', target: 'Me gusta tu manera de pensar.' },
  ],
  parte: [
    { id: 'parte-1', reviewCount: 7, base: 'That is part of the plan.', target: 'Eso es parte del plan.' },
    { id: 'parte-2', reviewCount: 2, base: 'The best part is the ending.', target: 'La mejor parte es el final.' },
  ],
  esta: [
    { id: 'esta-1', reviewCount: 11, base: 'This is my house.', target: 'Esta es mi casa.' },
    { id: 'esta-2', reviewCount: 6, base: 'She is not here today.', target: 'Ella no está aquí hoy.' },
  ],
  nunca: [
    { id: 'nunca-1', reviewCount: 4, base: 'I never said that.', target: 'Nunca dije eso.' },
    { id: 'nunca-2', reviewCount: 2, base: 'Never give up.', target: 'Nunca te rindas.' },
  ],
  quiere: [
    { id: 'quiere-1', reviewCount: 8, base: 'She wants to travel.', target: 'Ella quiere viajar.' },
    { id: 'quiere-2', reviewCount: 3, base: 'Nobody wants to go.', target: 'Nadie quiere ir.' },
  ],
  importante: [
    { id: 'imp-1', reviewCount: 6, base: 'This is very important.', target: 'Esto es muy importante.' },
    { id: 'imp-2', reviewCount: 1, base: 'The important thing is to try.', target: 'Lo importante es intentar.' },
  ],
  tiene: [
    { id: 'tiene-1', reviewCount: 14, base: 'She has two children.', target: 'Ella tiene dos hijos.' },
    { id: 'tiene-2', reviewCount: 5, base: 'This city has a lot of history.', target: 'Esta ciudad tiene mucha historia.' },
  ],
  muy: [
    { id: 'muy-1', reviewCount: 20, base: 'It is very cold today.', target: 'Hoy hace muy frío.' },
    { id: 'muy-2', reviewCount: 9, base: 'She is very happy.', target: 'Ella está muy feliz.' },
  ],
  estado: [
    { id: 'estado-1', reviewCount: 5, base: 'I have been here before.', target: 'He estado aquí antes.' },
    { id: 'estado-2', reviewCount: 2, base: 'The state of the project is good.', target: 'El estado del proyecto es bueno.' },
  ],
  todavía: [
    { id: 'todavia-1', reviewCount: 7, base: 'She still hasn\'t arrived.', target: 'Todavía no ha llegado.' },
    { id: 'todavia-2', reviewCount: 3, base: 'I still remember that day.', target: 'Todavía recuerdo ese día.' },
  ],
  llegó: [
    { id: 'llego-1', reviewCount: 4, base: 'He arrived late.', target: 'Él llegó tarde.' },
    { id: 'llego-2', reviewCount: 1, base: 'The package arrived this morning.', target: 'El paquete llegó esta mañana.' },
  ],
  cómo: [
    { id: 'como-1', reviewCount: 18, base: 'How are you?', target: '¿Cómo estás?' },
    { id: 'como-2', reviewCount: 6, base: 'How do you say that in Spanish?', target: '¿Cómo se dice eso en español?' },
  ],
  poco: [
    { id: 'poco-1', reviewCount: 11, base: 'I speak a little Spanish.', target: 'Hablo un poco de español.' },
    { id: 'poco-2', reviewCount: 3, base: 'Wait a little bit.', target: 'Espera un poco.' },
  ],
  hasta: [
    { id: 'hasta-1', reviewCount: 16, base: 'See you tomorrow.', target: 'Hasta mañana.' },
    { id: 'hasta-2', reviewCount: 8, base: 'I worked until midnight.', target: 'Trabajé hasta la medianoche.' },
  ],
  era: [
    { id: 'era-1', reviewCount: 13, base: 'It was a beautiful day.', target: 'Era un día hermoso.' },
    { id: 'era-2', reviewCount: 5, base: 'She was very young then.', target: 'Ella era muy joven entonces.' },
  ],
  próxima: [
    { id: 'proxima-1', reviewCount: 4, base: 'See you next week.', target: 'Nos vemos la próxima semana.' },
    { id: 'proxima-2', reviewCount: 2, base: 'The next stop is mine.', target: 'La próxima parada es la mía.' },
  ],
  dígame: [
    { id: 'digame-1', reviewCount: 6, base: 'Tell me what happened.', target: 'Dígame qué pasó.' },
    { id: 'digame-2', reviewCount: 1, base: 'Hello? (answering phone)', target: '¿Dígame?' },
  ],
};

export function LandingWordSentencesDialog({
  word,
  open,
  onOpenChange,
}: {
  word: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sentences = MOCK_SENTENCES[word.toLowerCase()] ?? [];
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [mastered, setMastered] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, id: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] flex flex-col sm:max-w-md p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3">
          <DialogTitle>{word}</DialogTitle>
          <DialogDescription className="sr-only">
            Example sentences containing the word {word}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-6">
          <div className="space-y-4" style={{ overflowAnchor: 'none' }}>
            {sentences.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No sentences found for this word yet.
              </p>
            )}
            {sentences.map((sentence) => (
              <div key={sentence.id} className="content-box p-4 space-y-2">
                <div className="flex items-center justify-between -mt-1 -mx-1 mb-1">
                  <Badge variant="secondary" className="text-xs">
                    {sentence.reviewCount} Reviews
                  </Badge>
                  <div className="flex items-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggle(favorites, sentence.id, setFavorites)}
                          className={`h-7 w-7 hover:bg-favorite/10 ${favorites.has(sentence.id) ? 'text-favorite hover:text-favorite/80' : 'text-muted-foreground hover:text-favorite'}`}
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Favorite</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggle(mastered, sentence.id, setMastered)}
                          className={`h-7 w-7 hover:bg-success/10 ${mastered.has(sentence.id) ? 'text-success hover:text-success/80' : 'text-muted-foreground hover:text-success'}`}
                        >
                          <CircleCheck className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Master</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggle(hidden, sentence.id, setHidden)}
                          className={`h-7 w-7 hover:bg-destructive/10 ${hidden.has(sentence.id) ? 'text-destructive hover:text-destructive/80' : 'text-muted-foreground hover:text-destructive'}`}
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Hide</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-relaxed">
                        {sentence.base}
                      </p>
                    </div>
                    <LandingAudioButton language="EN" />
                  </div>
                </div>

                <Separator />

                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="text-sm leading-relaxed">
                        {highlightWord(sentence.target, word, 'es')}
                      </p>
                    </div>
                    <LandingAudioButton language="ES" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
