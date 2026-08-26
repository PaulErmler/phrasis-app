'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { motion, AnimatePresence } from 'motion/react';
import { ReviewModeSwitcher } from '@/components/app/learning/ReviewModeSwitcher';
import { LandingLearningCardContent } from '@/components/landing/LandingLearningCardContent';
import { LandingCardShell } from '@/components/landing/LandingCardShell';
import { DiffDisplay } from '@/components/app/learning/DiffDisplay';
import {
  WritingFeedbackCard,
  type RowFeedback,
} from '@/components/app/learning/WritingFeedbackCard';
import { LandingAudioButton } from '@/components/landing/LandingAudioButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type {
  CardTranslation,
  CardAudioRecording,
} from '@/components/app/learning/types';
import type { ReviewMode } from '@/convex/types';
import { getLandingAudioUrl } from '@/lib/landing/audio';
import {
  getLanguageShortLabel,
  getLocalizedLanguageNameByCode,
} from '@/lib/languages';
import {
  Check,
  Ear,
  Languages,
  MousePointer2,
  NotebookPen,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { useLandingDemo } from '@/components/landing/landing-demo-context';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

const FEEDBACK_PENDING_MS = 800;
const FEEDBACK_DWELL_MS = 4000;

function landingWritingDemoFeedback(
  code: string,
  t: ReturnType<typeof useTranslations>,
): NonNullable<RowFeedback['result']> {
  if (code === 'fr') {
    return {
      verdict: 'minor',
      corrected: t('mock.fr'),
      notes: [{ type: 'punctuation', text: t('mock.feedbackFrPunctuation') }],
    };
  }
  return {
    verdict: 'minor',
    corrected: t('mock.es'),
    notes: [
      { type: 'spelling', text: t('mock.feedbackEsSpelling') },
      { type: 'punctuation', text: t('mock.feedbackEsPunctuation') },
    ],
  };
}

type FullReviewAnimPhase = 'typing' | 'cursorMoving' | 'cursorPressing';

function useMockCard(t: ReturnType<typeof useTranslations>, multi: boolean) {
  const locale = useLocale();
  const primaryBaseLang = locale.startsWith('de') ? 'de' : 'en';

  // Resolve the strings BEFORE memoizing so the deps are value-compared.
  // `t` itself is a fresh function per render under the test stub (and one
  // refactor away from it in the app); keying the memo on it rebuilds
  // `fullTargets` every render, and the reset effect below then loops
  // setState forever.
  const base = t('mock.base');
  const es = t('mock.es');
  const fr = t('mock.fr');
  const typedEs = t('mock.typedEs');
  const typedFr = t('mock.typedFr');

  return useMemo(() => {
    const basePrimary: CardTranslation = {
      language: primaryBaseLang,
      text: base,
      isBaseLanguage: true,
      isTargetLanguage: false,
    };

    if (!multi) {
      const target: CardTranslation = {
        language: 'es',
        text: es,
        isBaseLanguage: false,
        isTargetLanguage: true,
      };
      const translations = [basePrimary, target];
      const audioRecordings: CardAudioRecording[] = translations.map((tr) => ({
        language: tr.language,
        voiceName: null,
        url: null,
        wordTimings: null,
        ttsQuality: null,
      }));
      const fullTargets = [{ code: 'es', expected: es, typed: typedEs }];
      return {
        translations,
        audioRecordings,
        fullTargets,
        showRomanization: false,
      };
    }

    // Multi-language demo: 1 base + 2 targets, matching the Pro plan's
    // "up to 3 languages per course" cap.
    const targetEs: CardTranslation = {
      language: 'es',
      text: es,
      isBaseLanguage: false,
      isTargetLanguage: true,
    };
    const targetFr: CardTranslation = {
      language: 'fr',
      text: fr,
      isBaseLanguage: false,
      isTargetLanguage: true,
    };

    const translations = [basePrimary, targetEs, targetFr];
    const audioRecordings: CardAudioRecording[] = translations.map((tr) => ({
      language: tr.language,
      voiceName: null,
      url: null,
      wordTimings: null,
      ttsQuality: null,
    }));
    const fullTargets = [
      { code: 'es', expected: es, typed: typedEs },
      { code: 'fr', expected: fr, typed: typedFr },
    ];
    return {
      translations,
      audioRecordings,
      fullTargets,
      showRomanization: false,
    };
  }, [multi, primaryBaseLang, base, es, fr, typedEs, typedFr]);
}

export function ReviewModesDemo() {
  const t = useTranslations('LandingPage.reviewModes');
  const locale = useLocale();
  const { multiCourse: multi, setMultiCourse: setMulti } = useLandingDemo();
  const [reviewMode, setReviewMode] = useState<ReviewMode>('audio');
  const [playKey, setPlayKey] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  const { translations, audioRecordings, fullTargets, showRomanization } =
    useMockCard(t, multi);
  // Read inside effects via ref: `t` is not referentially stable, and
  // putting it in an effect's deps re-runs the reset/feedback effects every
  // render (see useMockCard).
  const tRef = useRef(t);
  tRef.current = t;

  const [typedMap, setTypedMap] = useState<Record<string, string>>({});
  const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, RowFeedback>>(
    {},
  );
  const [fullAnimPhase, setFullAnimPhase] =
    useState<FullReviewAnimPhase>('typing');
  const [activeLangIdx, setActiveLangIdx] = useState(0);
  const fullReviewWrapRef = useRef<HTMLDivElement>(null);
  const [cursorPath, setCursorPath] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [pressPos, setPressPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const cursorMoveAdvanceRef = useRef(false);
  const cursorPressAdvanceRef = useRef(false);

  useEffect(() => {
    if (reviewMode !== 'full') return;

    const codes = fullTargets.map((x) => x.code);
    const emptyTyped = Object.fromEntries(codes.map((c) => [c, '']));
    const emptySub = Object.fromEntries(codes.map((c) => [c, false]));

    if (reducedMotion) {
      setTypedMap(
        Object.fromEntries(fullTargets.map((x) => [x.code, x.typed])),
      );
      setSubmittedMap(
        Object.fromEntries(fullTargets.map((x) => [x.code, true])),
      );
      setFeedbackMap(
        Object.fromEntries(
          fullTargets.map((x) => [
            x.code,
            {
              status: 'done' as const,
              result: landingWritingDemoFeedback(x.code, tRef.current),
            },
          ]),
        ),
      );
      setActiveLangIdx(0);
      setFullAnimPhase('typing');
      setCursorPath(null);
      setPressPos(null);
      cursorMoveAdvanceRef.current = false;
      cursorPressAdvanceRef.current = false;
      return;
    }

    setTypedMap(emptyTyped);
    setSubmittedMap(emptySub);
    setFeedbackMap({});
    setActiveLangIdx(0);
    setFullAnimPhase('typing');
    setCursorPath(null);
    setPressPos(null);
    cursorMoveAdvanceRef.current = false;
    cursorPressAdvanceRef.current = false;
  }, [reviewMode, fullTargets, playKey, reducedMotion]);

  useEffect(() => {
    if (reviewMode !== 'full' || reducedMotion) return;
    if (fullAnimPhase !== 'typing') return;

    const tgt = fullTargets[activeLangIdx];
    if (!tgt) return;

    let cancelled = false;
    const timeouts: number[] = [];
    const startDelay = activeLangIdx === 0 ? 500 : 400;

    const step = (pos: number) => {
      if (cancelled) return;
      if (pos < tgt.typed.length) {
        setTypedMap((prev) => ({
          ...prev,
          [tgt.code]: tgt.typed.slice(0, pos + 1),
        }));
        timeouts.push(window.setTimeout(() => step(pos + 1), 42));
        return;
      }
      timeouts.push(
        window.setTimeout(() => {
          if (!cancelled) setFullAnimPhase('cursorMoving');
        }, 220),
      );
    };

    timeouts.push(window.setTimeout(() => step(0), startDelay));

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [
    reviewMode,
    fullAnimPhase,
    activeLangIdx,
    fullTargets,
    playKey,
    reducedMotion,
  ]);

  useLayoutEffect(() => {
    if (reviewMode !== 'full' || reducedMotion) return;
    if (fullAnimPhase !== 'cursorMoving') {
      if (fullAnimPhase !== 'cursorPressing') setCursorPath(null);
      return;
    }
    const wrap = fullReviewWrapRef.current;
    const tgt = fullTargets[activeLangIdx];
    const btn = wrap?.querySelector<HTMLElement>(
      tgt ? `[data-landing-full-submit="${tgt.code}"]` : '',
    );
    if (!wrap || !btn || !tgt) {
      const code = fullTargets[activeLangIdx]?.code;
      if (code) {
        cursorMoveAdvanceRef.current = false;
        cursorPressAdvanceRef.current = false;
        setSubmittedMap((prev) => ({ ...prev, [code]: true }));
        setFeedbackMap((prev) => ({
          ...prev,
          [code]: { status: 'pending' },
        }));
      }
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setCursorPath({
      from: { x: wr.width - 28, y: 36 },
      to: {
        x: br.left - wr.left + br.width / 2 - 6,
        y: br.top - wr.top + br.height / 2 - 4,
      },
    });
  }, [
    reviewMode,
    fullAnimPhase,
    activeLangIdx,
    fullTargets,
    reducedMotion,
    playKey,
  ]);

  const finishFullRowSubmit = useCallback(() => {
    const tgt = fullTargets[activeLangIdx];
    if (!tgt) return;
    setSubmittedMap((prev) => ({ ...prev, [tgt.code]: true }));
    setFeedbackMap((prev) => ({
      ...prev,
      [tgt.code]: { status: 'pending' },
    }));
    setCursorPath(null);
    setPressPos(null);
    cursorMoveAdvanceRef.current = false;
    cursorPressAdvanceRef.current = false;
  }, [fullTargets, activeLangIdx]);

  useEffect(() => {
    if (reviewMode !== 'full') return;
    const pending = Object.entries(feedbackMap).find(
      ([, row]) => row.status === 'pending',
    );
    if (!pending) return;
    const [code] = pending;
    const delay = reducedMotion ? 0 : FEEDBACK_PENDING_MS;
    const id = window.setTimeout(() => {
      setFeedbackMap((prev) => {
        if (prev[code]?.status !== 'pending') return prev;
        return {
          ...prev,
          [code]: {
            status: 'done',
            result: landingWritingDemoFeedback(code, tRef.current),
          },
        };
      });
      const idx = fullTargets.findIndex((x) => x.code === code);
      if (idx >= 0 && idx + 1 < fullTargets.length) {
        setActiveLangIdx(idx + 1);
        setFullAnimPhase('typing');
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [reviewMode, feedbackMap, reducedMotion, fullTargets]);

  const prevMulti = useRef(multi);
  useEffect(() => {
    if (prevMulti.current !== multi) {
      setPlayKey((k) => k + 1);
    }
    prevMulti.current = multi;
  }, [multi]);

  const prevMode = useRef(reviewMode);
  useEffect(() => {
    if (reviewMode === 'full' && prevMode.current !== 'full') {
      setPlayKey((k) => k + 1);
    }
    prevMode.current = reviewMode;
  }, [reviewMode]);

  const allFeedbackDone =
    reviewMode === 'full' &&
    fullTargets.length > 0 &&
    fullTargets.every((x) => feedbackMap[x.code]?.status === 'done');

  useEffect(() => {
    if (!allFeedbackDone) return;
    const id = window.setTimeout(
      () => setPlayKey((k) => k + 1),
      FEEDBACK_DWELL_MS,
    );
    return () => clearTimeout(id);
  }, [allFeedbackDone]);

  // Audio review demo plays exactly once per mount (or per Replay click) and
  // then stops, no auto-loop. The hands-free Radio panel below covers the
  // continuous-play story; the audio panel demonstrates a single review.

  const showLanguageLabel = fullTargets.length > 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <ReviewModeSwitcher value={reviewMode} onChange={setReviewMode} />
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <Label
            htmlFor="landing-multi-lang"
            className="text-sm font-medium cursor-pointer"
          >
            {t('multiLabel')}
          </Label>
          <Switch
            id="landing-multi-lang"
            checked={multi}
            onCheckedChange={setMulti}
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 lg:gap-10 items-start">
        <div className="space-y-3 order-1 lg:order-1">
          {reviewMode === 'audio' ? (
            <>
              <h3 className="text-lg font-semibold">{t('audioTitle')}</h3>
              <p className="text-muted-foreground leading-relaxed">
                {t('audioBody')}
              </p>
              {/* Two callouts framing the in-app scheduling choices that
                  pair with audio playback: Review mode (FSRS-driven) and
                  Radio mode (passive, no FSRS). Both live inside the audio
                  panel because their value prop is audio-specific. */}
              <p className="text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-4 mt-4">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  {t('reviewModeTitle')}:
                </span>{' '}
                {t('reviewModeBody')}
              </p>
              <p className="text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-4">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Radio className="h-4 w-4 text-primary" />
                  {t('radioTitle')}:
                </span>{' '}
                {t('radioBody')}
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold">{t('fullTitle')}</h3>
              <p className="text-muted-foreground leading-relaxed">
                {t('fullBody')}
              </p>
              {/* Three callouts framing the writing styles that pair with the
                  typing exercise: Translate (base audio → type the
                  translation), Transcribe (target audio → type what you
                  hear) and Free Study (endless shuffle, no FSRS). Same
                  framing as the Review/Radio callouts in the audio panel. */}
              <p className="text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-4 mt-4">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Languages className="h-4 w-4 text-primary" />
                  {t('translateTitle')}:
                </span>{' '}
                {t('translateBody')}
              </p>
              <p className="text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-4">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Ear className="h-4 w-4 text-primary" />
                  {t('transcribeTitle')}:
                </span>{' '}
                {t('transcribeBody')}
              </p>
              <p className="text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-4">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <NotebookPen className="h-4 w-4 text-primary" />
                  {t('freeStudyTitle')}:
                </span>{' '}
                {t('freeStudyBody')}
              </p>
            </>
          )}
        </div>

        <div className="order-2 lg:order-2 w-full max-w-lg mx-auto lg:mx-0 lg:ml-auto flex flex-col min-h-[24rem]">
          <div className="py-1 sm:py-2 flex-1 flex flex-col">
            {reviewMode === 'audio' ? (
              <div className="flex flex-1 flex-col justify-center">
                <LandingLearningCardContent
                  preReviewCount={2}
                  schedulingPhase="review"
                  fsrsState={{ reps: 1 }}
                  sourceText=""
                  translations={translations}
                  audioRecordings={audioRecordings}
                  isFavorite={false}
                  isPendingMaster={false}
                  isPendingHide={false}
                  onMaster={() => {}}
                  onHide={() => {}}
                  onFavorite={() => {}}
                  // No autoplay anywhere on the landing page. Audio only
                  // fires when the visitor clicks an audio button. Targets
                  // start blurred so the demo still has interaction value
                  // (click target text to reveal, click audio to listen).
                  hideTargetLanguages
                  audioDemoAutoUnlockSequence={false}
                  audioDemoSequenceKey={playKey}
                  autoRevealLanguages={false}
                  bare
                  showRomanization={showRomanization}
                />
              </div>
            ) : (
              <div ref={fullReviewWrapRef} className="relative flex flex-col">
                <LandingCardShell
                  bare
                  reviewCount={2}
                  sourceText=""
                  translations={translations}
                  audioRecordings={audioRecordings}
                  isFavorite={false}
                  isPendingMaster={false}
                  isPendingHide={false}
                  onMaster={() => {}}
                  onHide={() => {}}
                  onFavorite={() => {}}
                  showRomanization={showRomanization}
                >
                  {({ targetTranslations }) => (
                    <div className="space-y-3">
                      {targetTranslations.map((tr) => {
                        const submitted = submittedMap[tr.language] ?? false;
                        const typed = typedMap[tr.language] ?? '';
                        const ft = fullTargets.find(
                          (x) => x.code === tr.language,
                        );
                        const label = showLanguageLabel
                          ? getLocalizedLanguageNameByCode(tr.language, locale)
                          : null;

                        return (
                          <div key={tr.language} className="space-y-1">
                            {label ? (
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground uppercase">
                                  {label}
                                </span>
                                <LandingAudioButton
                                  url={getLandingAudioUrl(tr.text, tr.language)}
                                  language={getLanguageShortLabel(tr.language)}
                                />
                              </div>
                            ) : (
                              <div className="flex justify-end">
                                <LandingAudioButton
                                  url={getLandingAudioUrl(tr.text, tr.language)}
                                  language={getLanguageShortLabel(tr.language)}
                                />
                              </div>
                            )}
                            {/* min-h (not fixed h + overflow-hidden): the diff
                             * is taller than the input row it replaces. Its
                             * floating correction marks sit above the chips
                             * and were clipped by a fixed 36px box. */}
                            <div className="min-h-9">
                              {submitted && ft ? (
                                <DiffDisplay
                                  expected={ft.expected}
                                  actual={typed}
                                  language={tr.language}
                                  omitAccuracy
                                />
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Input
                                    readOnly
                                    value={typed}
                                    className="flex-1"
                                    placeholder="…"
                                    autoComplete="off"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-9 w-9 shrink-0 pointer-events-none opacity-50"
                                    aria-hidden
                                    tabIndex={-1}
                                    data-landing-full-submit={tr.language}
                                  >
                                    <span className="sr-only">Submit</span>
                                    <Check className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            {submitted && feedbackMap[tr.language] ? (
                              <WritingFeedbackCard
                                feedback={feedbackMap[tr.language]}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </LandingCardShell>

                <AnimatePresence mode="wait">
                  {fullAnimPhase === 'cursorMoving' &&
                    cursorPath &&
                    !reducedMotion && (
                      <motion.div
                        key="full-review-cursor-move"
                        className="pointer-events-none absolute left-0 top-0 z-30"
                        initial={{
                          x: cursorPath.from.x,
                          y: cursorPath.from.y,
                          opacity: 0,
                          scale: 0.85,
                        }}
                        animate={{
                          x: cursorPath.to.x,
                          y: cursorPath.to.y,
                          opacity: 1,
                          scale: 1,
                        }}
                        exit={{
                          opacity: 0,
                          scale: 0.95,
                          transition: { duration: 0.08 },
                        }}
                        transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
                        onAnimationComplete={() => {
                          if (cursorMoveAdvanceRef.current || !cursorPath)
                            return;
                          cursorMoveAdvanceRef.current = true;
                          setPressPos({
                            x: cursorPath.to.x,
                            y: cursorPath.to.y,
                          });
                          setFullAnimPhase('cursorPressing');
                        }}
                      >
                        <MousePointer2 className="h-9 w-9 fill-primary text-primary drop-shadow-lg" />
                      </motion.div>
                    )}
                  {fullAnimPhase === 'cursorPressing' &&
                    pressPos &&
                    !reducedMotion && (
                      <motion.div
                        key="full-review-cursor-press"
                        className="pointer-events-none absolute left-0 top-0 z-30"
                        initial={{
                          x: pressPos.x,
                          y: pressPos.y,
                          opacity: 1,
                          scale: 1,
                        }}
                        animate={{
                          opacity: 0,
                          scale: 0.86,
                        }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        onAnimationComplete={() => {
                          if (cursorPressAdvanceRef.current) return;
                          cursorPressAdvanceRef.current = true;
                          finishFullRowSubmit();
                        }}
                      >
                        <MousePointer2 className="h-9 w-9 fill-primary text-primary drop-shadow-lg" />
                      </motion.div>
                    )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
