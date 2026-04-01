'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useEnsureContent } from '@/hooks/use-ensure-content';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Layers, Languages } from 'lucide-react';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { getLanguageShortLabel } from '@/lib/languages';

export function DeckCardsView() {
  const t = useTranslations('AppPage.deckCards');
  const deckCards = useQuery(api.features.decks.getDeckCards, {});
  const activeCourse = useQuery(api.features.courses.getActiveCourse);

  useEnsureContent(deckCards);

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
        <CardDescription>Cards with translations and audio</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <Accordion type="single" collapsible className="w-full space-y-2">
            {deckCards.map((card, index) => {
              // Get base language translation (the language the user knows)
              const baseTranslation = card.translations.find(
                (t) => t.isBaseLanguage && t.text,
              );
              // Get target language translation (the language being learned)
              const targetTranslation = card.translations.find(
                (t) => t.isTargetLanguage && t.text,
              );

              // Get audio for each
              const baseAudio = baseTranslation
                ? card.audioRecordings.find(
                  (a) => a.language === baseTranslation.language,
                )
                : null;
              const targetAudio = targetTranslation
                ? card.audioRecordings.find(
                  (a) => a.language === targetTranslation.language,
                )
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
                          <p className="font-medium text-sm leading-relaxed">
                            {baseTranslation?.text || card.sourceText}
                          </p>
                          {baseTranslation?.romanization && (
                            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                              {baseTranslation.romanization}
                            </p>
                          )}
                          {targetTranslation?.text && (
                            <p className="text-muted-sm mt-1 leading-relaxed">
                              {targetTranslation.text}
                            </p>
                          )}
                          {targetTranslation?.romanization && (
                            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                              {targetTranslation.romanization}
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
                            {getLanguageShortLabel(
                              baseTranslation?.language || card.sourceLanguage,
                            )}
                          </Badge>
                          <span className="text-sm font-medium">
                            {t('baseLabel')}
                          </span>
                        </div>
                        <p className="text-sm">
                          {baseTranslation?.text || card.sourceText}
                        </p>
                        {baseTranslation?.romanization && (
                          <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                            {baseTranslation.romanization}
                          </p>
                        )}
                        {!baseTranslation?.text &&
                          baseTranslation === undefined && (
                          <p className="text-muted-sm italic">
                            {t('translating')}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <AudioButton
                            url={baseAudio?.url ?? null}
                            language={getLanguageShortLabel(
                              baseTranslation?.language || card.sourceLanguage,
                            )}
                            showLabel
                          />
                        </div>
                      </div>

                      {/* Target Language Section (what user is learning) */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Languages className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="secondary" className="text-xs">
                            {targetTranslation?.language
                              ? getLanguageShortLabel(
                                targetTranslation.language,
                              )
                              : 'TARGET'}
                          </Badge>
                          <span className="text-sm font-medium">
                            {t('targetLabel')}
                          </span>
                        </div>
                        {targetTranslation?.text ? (
                          <>
                            <p className="text-sm">{targetTranslation.text}</p>
                            {targetTranslation.romanization && (
                              <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                                {targetTranslation.romanization}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-muted-sm italic">{t('translating')}</p>
                        )}
                        <div className="flex gap-2">
                          <AudioButton
                            url={targetAudio?.url ?? null}
                            language={
                              targetTranslation?.language
                                ? getLanguageShortLabel(
                                  targetTranslation.language,
                                )
                                : ''
                            }
                            showLabel
                          />
                        </div>
                      </div>

                      {/* Card Status */}
                      <div className="flex items-center gap-2 pt-2 border-t">
                        {card.isFavorite && (
                          <Badge variant="secondary" className="text-xs">
                            {t('statusFavorite')}
                          </Badge>
                        )}
                        {card.isMastered && (
                          <Badge variant="default" className="text-xs">
                            {t('statusMastered')}
                          </Badge>
                        )}
                        {card.isHidden && (
                          <Badge variant="outline" className="text-xs">
                            {t('statusHidden')}
                          </Badge>
                        )}
                        <span className="text-muted-xs">
                          {t('due')}: {new Date(card.dueDate).toLocaleDateString()}
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
