'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, usePreloadedQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useEnsureContent } from '@/hooks/use-ensure-content';
import { useAppData } from '@/components/app/AppDataProvider';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import { HighlightedText } from '@/components/app/learning/HighlightedText';
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
import { CardSpeedBadge } from '@/components/app/learning/CardSpeedBadge';
import { getLanguageShortLabel } from '@/lib/languages';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import type { Id } from '@/convex/_generated/dataModel';

export function DeckCardsView() {
  const t = useTranslations('AppPage.deckCards');
  const deckCards = useQuery(api.features.decks.getDeckCards, {});
  const activeCourse = useQuery(api.features.courses.getActiveCourse);

  const { preloadedCourseSettings } = useAppData();
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const highlightEnabled = courseSettings?.highlightWords !== false;
  const languagePlaybackSpeeds = courseSettings?.languagePlaybackSpeeds ?? {};
  const buttonPlayback = useButtonPlayback();

  // Per-card speed override mutation with optimistic update on the deck list
  // query so the badge feels instant. Only patches the matching card.
  const setCardAudioSpeedOverrideMutation = useMutation(
    api.features.scheduling.setCardAudioSpeedOverride,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.features.decks.getDeckCards, {});
    if (current === undefined) return;
    localStore.setQuery(
      api.features.decks.getDeckCards,
      {},
      current.map((c) =>
        c._id === args.cardId
          ? {
              ...c,
              audioSpeedOverrides: (() => {
                const next = { ...(c.audioSpeedOverrides ?? {}) };
                if (args.speed === null) delete next[args.language];
                else next[args.language] = args.speed;
                return next;
              })(),
            }
          : c,
      ),
    );
  });

  const handleSpeedCycle = useCallback(
    (cardId: Id<'cards'>, language: string, next: number | null) => {
      setCardAudioSpeedOverrideMutation({ cardId, language, speed: next });
    },
    [setCardAudioSpeedOverrideMutation],
  );

  useEnsureContent(deckCards);

  if (deckCards === undefined || activeCourse === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('loading')}</CardDescription>
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
            {t('title')}
          </CardTitle>
          <CardDescription>{t('emptyState')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t('title')}
          <Badge variant="secondary" className="ml-2">
            {t('cardCount', { count: deckCards.length })}
          </Badge>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
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
                            <p className="text-romanization">
                              {baseTranslation.romanization}
                            </p>
                          )}
                          {targetTranslation?.text && (
                            <p className="text-muted-sm mt-1 leading-relaxed">
                              {targetTranslation.text}
                            </p>
                          )}
                          {targetTranslation?.romanization && (
                            <p className="text-romanization">
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
                        {(() => {
                          const lang =
                            baseTranslation?.language || card.sourceLanguage;
                          const isActive =
                            buttonPlayback.active?.language === lang;
                          return (
                            <HighlightedText
                              text={baseTranslation?.text || card.sourceText}
                              wordTimings={baseAudio?.wordTimings ?? null}
                              localTime={buttonPlayback.active?.localTime ?? 0}
                              isActive={isActive}
                              enabled={highlightEnabled}
                              className="text-sm"
                            />
                          );
                        })()}
                        {baseTranslation?.romanization && (
                          <p className="text-romanization">
                            {baseTranslation.romanization}
                          </p>
                        )}
                        {!baseTranslation?.text &&
                          baseTranslation === undefined && (
                          <p className="text-muted-sm italic">
                            {t('translating')}
                          </p>
                        )}
                        {(() => {
                          const lang =
                            baseTranslation?.language || card.sourceLanguage;
                          const override =
                            card.audioSpeedOverrides?.[lang] ?? null;
                          const generalSpeed =
                            languagePlaybackSpeeds[lang] ??
                            DEFAULT_PLAYBACK_SPEED;
                          const effectiveSpeed = override ?? generalSpeed;
                          return (
                            <div className="flex items-center gap-2">
                              <AudioButton
                                url={baseAudio?.url ?? null}
                                language={lang}
                                showLabel
                                onTimeUpdate={buttonPlayback.onTimeUpdate}
                                onStop={buttonPlayback.onStop}
                                speed={effectiveSpeed}
                              />
                              <CardSpeedBadge
                                override={override}
                                generalSpeed={generalSpeed}
                                onCycle={(next) =>
                                  handleSpeedCycle(card._id, lang, next)
                                }
                              />
                            </div>
                          );
                        })()}
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
                            {(() => {
                              const isActive =
                                buttonPlayback.active?.language ===
                                targetTranslation.language;
                              return (
                                <HighlightedText
                                  text={targetTranslation.text}
                                  wordTimings={targetAudio?.wordTimings ?? null}
                                  localTime={buttonPlayback.active?.localTime ?? 0}
                                  isActive={isActive}
                                  enabled={highlightEnabled}
                                  className="text-sm"
                                />
                              );
                            })()}
                            {targetTranslation.romanization && (
                              <p className="text-romanization">
                                {targetTranslation.romanization}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-muted-sm italic">{t('translating')}</p>
                        )}
                        {(() => {
                          const lang = targetTranslation?.language ?? '';
                          const override = lang
                            ? (card.audioSpeedOverrides?.[lang] ?? null)
                            : null;
                          const generalSpeed = lang
                            ? (languagePlaybackSpeeds[lang] ?? DEFAULT_PLAYBACK_SPEED)
                            : DEFAULT_PLAYBACK_SPEED;
                          const effectiveSpeed = override ?? generalSpeed;
                          return (
                            <div className="flex items-center gap-2">
                              <AudioButton
                                url={targetAudio?.url ?? null}
                                language={lang}
                                showLabel
                                onTimeUpdate={buttonPlayback.onTimeUpdate}
                                onStop={buttonPlayback.onStop}
                                speed={effectiveSpeed}
                              />
                              {lang && (
                                <CardSpeedBadge
                                  override={override}
                                  generalSpeed={generalSpeed}
                                  onCycle={(next) =>
                                    handleSpeedCycle(card._id, lang, next)
                                  }
                                />
                              )}
                            </div>
                          );
                        })()}
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
