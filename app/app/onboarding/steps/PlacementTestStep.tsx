'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Volume2, EyeOff, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { OGTE_MIN_LEVEL, OGTE_MAX_LEVEL } from '@/lib/constants/onboarding';
import {
  createStrategy,
  DEFAULT_STRATEGY,
  type PlacementStrategy,
  type StrategyName,
  type PlacementAnswer,
  ogteToCurrentLevel,
} from '../lib/placementStrategies';
import type { CurrentLevel } from '../types';

/**
 * Predict the (level, position) the next question would land on if the user
 * answers `knew` to the current question, without mutating the real strategy.
 *
 * Works for every `PlacementStrategy` because each strategy is fully
 * determined by `init(opts)` + the `history` of (level, knew) pairs, so we
 * spin up a fresh instance, replay history, apply the would-be answer, and
 * read its `nextQuestionLevel()`. Used for client-side query prefetching so
 * the next sentence is already in Convex's cache when the user clicks an
 * answer button.
 */
function peekNextLevelAndPosition(
  strategyName: StrategyName,
  initialOgteLevel: number | undefined,
  currentHistory: readonly PlacementAnswer[],
  currentLevel: number,
  knew: boolean,
): { level: number; position: number } | null {
  const clone = createStrategy(strategyName);
  clone.init(initialOgteLevel ? { userGuess: initialOgteLevel } : undefined);
  for (const ans of currentHistory) clone.recordAnswer(ans.level, ans.knew);
  clone.recordAnswer(currentLevel, knew);
  const level = clone.nextQuestionLevel();
  if (level === null) return null;
  const seen = clone.history().filter((h) => h.level === level).length;
  return { level, position: seen % 5 };
}

interface Props {
  targetLanguage: string;
  sourceLanguage: string;
  initialOgteLevel?: number;
  onComplete: (result: {
    strategy: StrategyName;
    history: { level: number; knew: boolean }[];
    finalOgteLevel: number;
    currentLevel: CurrentLevel;
  }) => void;
}

/**
 * Adaptive placement test step.
 *
 * UX:
 *   - User sees English (source) at the top + a speaker button.
 *   - Bottom CTA "Reveal translation" replaces with two answer buttons after
 *     reveal. Target translation appears in the (always-sized) bottom slot
 *     and target audio auto-plays.
 *   - Position rotates with the number of prior asks at the same level so
 *     repeated questions never show the same sentence.
 *
 * Result screen shows the placed OGTE level + the 5 representative sample
 * sentences at that level (so the user can sanity-check the placement
 * before continuing).
 */
export function PlacementTestStep({ targetLanguage, sourceLanguage, initialOgteLevel, onComplete }: Props) {
  const t = useTranslations('Onboarding.placementTest');
  const locale = useLocale();
  const strategyName: StrategyName = DEFAULT_STRATEGY;
  const [strategyAndTick] = useState<{ s: PlacementStrategy }>(() => {
    const s = createStrategy(strategyName);
    s.init(initialOgteLevel ? { userGuess: initialOgteLevel } : undefined);
    return { s };
  });
  const [, setTick] = useState(0);
  const strategy = strategyAndTick.s;

  const nextLevel = strategy.nextQuestionLevel();
  const historyArr = strategy.history();
  const historyLen = historyArr.length;
  // `strategy` mutates `historyArr` in place, so its identity is stable and
  // `historyLen` is the real invalidation signal, not "unnecessary".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => [...historyArr], [historyLen, historyArr]);
  const isDone = nextLevel === null;
  const finalLevel = strategy.finalLevel();

  const position = useMemo(() => {
    if (nextLevel === null) return 0;
    const seen = history.filter((h) => h.level === nextLevel).length;
    return seen % 5;
  }, [nextLevel, history]);

  const sentence = useQuery(
    api.features.placementTest.getPlacementSentence,
    nextLevel !== null
      ? { level: nextLevel, position, targetLanguage, sourceLanguage }
      : 'skip',
  );

  // `revealed` derives from comparing the user-last-revealed textId to the
  // current sentence's textId. State stored as the *revealed* id (not a
  // boolean) so revealed becomes synchronously false the moment the sentence
  // changes. Important now that the next question is prefetched and the
  // useQuery returns the next sentence on the SAME render as the answer
  // click. With a separate `useEffect(() => setRevealed(false), [...])` reset
  // there was one render where revealed was still true AND the next
  // sentence's `targetAudioUrl` was already populated, which caused the
  // auto-play effect to fire on the not-yet-revealed next question.
  const [revealedTextId, setRevealedTextId] = useState<Id<'texts'> | null>(null);
  const revealed =
    sentence?.textId != null && sentence.textId === revealedTextId;
  const handleReveal = () => {
    if (sentence?.textId) setRevealedTextId(sentence.textId);
  };

  // Prefetch the two possible next sentences (one per answer path) so the
  // Convex client cache holds them by the time the user clicks an answer
  // button. Eliminates the "loading…" flash between questions. Both
  // results are discarded; only the subscription matters. Strategies are
  // deterministic given `init` + history, so the peek helper replays the
  // sequence on a clone to predict where each branch lands.
  const prefetchKnew = useMemo(
    () =>
      nextLevel !== null
        ? peekNextLevelAndPosition(
          strategyName,
          initialOgteLevel,
          history,
          nextLevel,
          true,
        )
        : null,
    [strategyName, initialOgteLevel, history, nextLevel],
  );
  const prefetchNotKnew = useMemo(
    () =>
      nextLevel !== null
        ? peekNextLevelAndPosition(
          strategyName,
          initialOgteLevel,
          history,
          nextLevel,
          false,
        )
        : null,
    [strategyName, initialOgteLevel, history, nextLevel],
  );
  useQuery(
    api.features.placementTest.getPlacementSentence,
    prefetchKnew !== null
      ? {
        level: prefetchKnew.level,
        position: prefetchKnew.position,
        targetLanguage,
        sourceLanguage,
      }
      : 'skip',
  );
  useQuery(
    api.features.placementTest.getPlacementSentence,
    prefetchNotKnew !== null
      ? {
        level: prefetchNotKnew.level,
        position: prefetchNotKnew.position,
        targetLanguage,
        sourceLanguage,
      }
      : 'skip',
  );

  // Safety-net: if the placement sentence resolved but any of (translation,
  // source audio, target audio) is missing, fire `ensurePlacementTranslations`
  // once per language. The mutation routes through `scheduleMissingContent`,
  // so it covers all three content kinds for every placement sentence in one
  // pass. Fully idempotent on the server.
  //
  // Failure handling: one silent automatic retry after 3s, then a visible
  // inline retry row + toast. Previously a failure was swallowed and never
  // retried for the language, leaving the placement test content-less with
  // zero feedback.
  const ensureTranslations = useMutation(api.features.onboarding.ensurePlacementTranslations);
  const ensuredForLanguageRef = useRef<string | null>(null);
  const [ensureStatus, setEnsureStatus] = useState<
    'idle' | 'pending' | 'retry-scheduled' | 'error'
  >('idle');
  const autoRetriedRef = useRef(false);
  const contentMissing =
    sentence != null &&
    (!sentence.targetText ||
      !sentence.sourceAudioUrl ||
      !sentence.targetAudioUrl);

  const runEnsureTranslations = useCallback(() => {
    setEnsureStatus('pending');
    ensureTranslations({ targetLanguage, sourceLanguage })
      .then(() => setEnsureStatus('idle'))
      .catch(() => {
        if (!autoRetriedRef.current) {
          autoRetriedRef.current = true;
          setEnsureStatus('retry-scheduled');
        } else {
          setEnsureStatus('error');
          toast.error(t('contentRetry.failed'));
        }
      });
  }, [ensureTranslations, targetLanguage, sourceLanguage, t]);

  useEffect(() => {
    if (!contentMissing) return;
    if (ensuredForLanguageRef.current === targetLanguage) return;
    ensuredForLanguageRef.current = targetLanguage;
    autoRetriedRef.current = false;
    runEnsureTranslations();
  }, [contentMissing, targetLanguage, runEnsureTranslations]);

  useEffect(() => {
    if (ensureStatus !== 'retry-scheduled') return;
    const id = setTimeout(runEnsureTranslations, 3000);
    return () => clearTimeout(id);
  }, [ensureStatus, runEnsureTranslations]);

  // Auto-play target audio on reveal.
  const targetAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!revealed) return;
    if (sentence?.targetAudioUrl) {
      targetAudioRef.current?.play().catch(() => {});
    }
  }, [revealed, sentence?.targetAudioUrl, sentence?.textId]);

  if (isDone) {
    return (
      <PlacementResult
        finalLevel={finalLevel}
        questionsAsked={history.length}
        targetLanguage={targetLanguage}
        sourceLanguage={sourceLanguage}
        onContinue={(adjustedLevel) =>
          onComplete({
            strategy: strategyName,
            history,
            finalOgteLevel: adjustedLevel,
            currentLevel: ogteToCurrentLevel(adjustedLevel),
          })
        }
      />
    );
  }

  const answer = (knew: boolean) => {
    if (nextLevel === null) return;
    strategy.recordAnswer(nextLevel, knew);
    setTick((t) => t + 1);
  };

  const targetLoading = sentence === undefined;
  const sourceText = sentence?.sourceText;
  const targetText = sentence?.targetText;
  const targetMissing = sentence === null || !targetText;

  // Label the source side with the language the query actually rendered
  // Falls back to the user's requested base language while the sentence
  // is still loading.
  const renderedSourceLanguage = sentence?.sourceLanguage ?? sourceLanguage;
  const sourceLanguageLabel = getLocalizedLanguageNameByCode(
    renderedSourceLanguage,
    locale,
  );

  return (
    <div
      data-testid="onboarding-step-placement-test"
      className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="shrink-0 py-4">
        <div className="text-center">
          <h2 className="text-xl font-bold">{t('prompt')}</h2>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mt-1">
            {t('questionLabel', { n: history.length + 1 })}
          </div>
        </div>
      </div>

      {/* Stable-width card: always renders at the same width regardless of
          revealed state. Inner reserve uses min-height so the layout never
          shifts when the translation appears. */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <Card className="w-full max-w-xl mx-4">
          <CardContent className="p-6 space-y-4">
            {/* Source row */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('sourceLabel', { language: sourceLanguageLabel })}
                </div>
                {sentence?.sourceAudioUrl ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => sourceAudioRef.current?.play().catch(() => {})}
                    aria-label={t('playSourceAudio', { language: sourceLanguageLabel })}
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <div className="text-2xl font-semibold leading-relaxed text-center min-h-[3.5rem] break-words">
                {targetLoading ? (
                  <span className="text-muted-foreground italic text-base">{t('loading')}</span>
                ) : (
                  sourceText ?? (
                    <span className="text-muted-foreground italic text-base">
                      {t('noSentence')}
                    </span>
                  )
                )}
              </div>
            </div>

            {/* Target row. Height is reserved whether revealed or not, so the
                card width and the page layout don't jump on reveal. The whole
                row is a tap target before reveal so users can poke the empty
                area as well as the explicit button. */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('translationLabel')}
                </div>
                {revealed && sentence?.targetAudioUrl ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => targetAudioRef.current?.play().catch(() => {})}
                    aria-label={t('playTranslationAudio')}
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <div className="h-7 w-7" />
                )}
              </div>
              {revealed ? (
                <div className="min-h-[4rem] flex items-center justify-center">
                  <div className="text-2xl font-semibold leading-relaxed text-center animate-in fade-in slide-in-from-top-1 duration-200 break-words">
                    {targetMissing ? (
                      <span className="text-muted-foreground italic text-base">
                        {t('translationNotReady')}
                      </span>
                    ) : (
                      targetText
                    )}
                    {sentence?.targetRomanization ? (
                      <div className="text-sm text-muted-foreground italic mt-1">
                        {sentence.targetRomanization}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleReveal}
                  disabled={targetLoading}
                  className="min-h-[4rem] w-full flex items-center justify-center rounded-md text-center text-muted-foreground italic text-sm transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={t('tapReveal')}
                >
                  {t('tapReveal')}
                </button>
              )}
            </div>

            {contentMissing && ensureStatus === 'error' ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <span className="text-xs text-muted-foreground text-left">
                  {t('contentRetry.message')}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    // Visible only after the silent auto-retry already failed,
                    // so every one of these is a user staring at a placement
                    // test with missing content.
                    capture(CLIENT_EVENTS.PLACEMENT_CONTENT_RETRY, {
                      trigger: 'manual',
                    });
                    runEnsureTranslations();
                  }}
                  data-testid="placement-content-retry"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  {t('contentRetry.button')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="shrink-0 p-4">
        <div className="max-w-xl mx-auto">
          {!revealed ? (
            <Button
              size="lg"
              className="w-full"
              disabled={targetLoading}
              onClick={handleReveal}
              data-testid="placement-test-reveal"
            >
              <EyeOff className="h-4 w-4 mr-2" />
              {t('reveal')}
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <Button
                variant="outline"
                size="lg"
                onClick={() => answer(false)}
                data-testid="placement-test-didnt-know"
              >
                {t('iDidntKnow')}
              </Button>
              <Button
                size="lg"
                onClick={() => answer(true)}
                data-testid="placement-test-knew-it"
              >
                {t('iKnewIt')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden audio elements. Preload metadata only so we don't burn
          bandwidth before reveal. Source audio plays only on button-tap. */}
      {sentence?.sourceAudioUrl ? (
        <audio ref={sourceAudioRef} src={sentence.sourceAudioUrl} preload="auto" />
      ) : null}
      {sentence?.targetAudioUrl ? (
        <audio ref={targetAudioRef} src={sentence.targetAudioUrl} preload="auto" />
      ) : null}
    </div>
  );
}

// ─── Result screen ──────────────────────────────────────────────────────────

function PlacementResult({
  finalLevel,
  questionsAsked,
  targetLanguage,
  sourceLanguage,
  onContinue,
}: {
  finalLevel: number;
  questionsAsked: number;
  targetLanguage: string;
  sourceLanguage: string;
  onContinue: (adjustedLevel: number) => void;
}) {
  const t = useTranslations('Onboarding.placementTest.result');
  // Local adjustment. Easier / Harder nudge the level by ±1 within the
  // OGTE range without re-running the test. The user confirms with
  // "Continue" once they're happy with the displayed level.
  const [level, setLevel] = useState(finalLevel);
  const atFloor = level <= OGTE_MIN_LEVEL;
  const atCeil = level >= OGTE_MAX_LEVEL;
  const moveUp = () => setLevel((l) => Math.min(OGTE_MAX_LEVEL, l + 1));
  const moveDown = () => setLevel((l) => Math.max(OGTE_MIN_LEVEL, l - 1));

  return (
    <div
      data-testid="onboarding-step-placement-result"
      data-final-level={level}
      className="flex flex-col h-full overflow-hidden animate-in fade-in zoom-in-95 duration-300"
    >
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto w-full space-y-4 text-center">
          <h2 className="text-2xl font-bold pt-4">{t('title')}</h2>
          <p className="text-muted-foreground">{t('subtitle')}</p>
          <div className="rounded-2xl bg-primary/10 p-6">
            <div className="text-sm uppercase tracking-wide text-muted-foreground">
              {t('levelLabel')}
            </div>
            <div className="text-5xl font-bold tabular-nums my-2">
              {level.toString().padStart(2, '0')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('questionsAnswered', { count: questionsAsked })}
            </div>
            <div className="flex gap-2 justify-center mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={moveDown}
                disabled={atFloor}
                data-testid="placement-result-easier"
              >
                {t('easier')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={moveUp}
                disabled={atCeil}
                data-testid="placement-result-harder"
              >
                {t('harder')}
              </Button>
            </div>
          </div>
          <div className="card-surface p-4 text-left">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {t('samplesHeading')}
            </div>
            <div className="space-y-1.5">
              {[0, 1, 2, 3, 4].map((p) => (
                <ResultSample
                  // Key by `position` only so the component instance
                  // survives Easier/Harder clicks (the level prop changes
                  // in place). Re-keying by level would remount and
                  // skeleton-flash on every adjustment.
                  key={p}
                  level={level}
                  position={p}
                  targetLanguage={targetLanguage}
                  sourceLanguage={sourceLanguage}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="shrink-0 p-4 border-t bg-background">
        <Button
          size="lg"
          className="w-full max-w-md mx-auto block"
          onClick={() => onContinue(level)}
          data-testid="placement-result-continue"
        >
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}

function ResultSample({
  level,
  position,
  targetLanguage,
  sourceLanguage,
}: {
  level: number;
  position: number;
  targetLanguage: string;
  sourceLanguage: string;
}) {
  const sentence = useQuery(api.features.placementTest.getPlacementSentence, {
    level,
    position,
    targetLanguage,
    sourceLanguage,
  });
  // Hold onto the last good sentence so Easier/Harder doesn't blank the
  // row to a skeleton. The previous level's sentence stays visible until
  // the new level's query resolves, then swaps cleanly.
  const [lastGood, setLastGood] = useState<typeof sentence | null>(null);
  useEffect(() => {
    if (sentence) setLastGood(sentence);
  }, [sentence]);
  const display = sentence ?? lastGood;
  if (display === undefined || display === null) {
    return <div className="h-7 rounded bg-muted/40 animate-pulse" />;
  }
  const primary = display.targetText ?? display.sourceText;
  return (
    <div className="rounded bg-muted/50 px-3 py-2 text-sm">{primary}</div>
  );
}
