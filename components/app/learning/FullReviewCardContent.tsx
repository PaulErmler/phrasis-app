'use client';

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, FileText, Undo2 } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
import { AnnotationLines } from './AnnotationLines';
import type { CardPresentation } from './cardPresentation';
import { CardSpeedBadge } from './CardSpeedBadge';
import {
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PLAYBACK_SPEED,
} from '@/lib/constants/audioPlayback';
import { DiffDisplay } from './DiffDisplay';
import {
  answerCandidates,
  answersMatchExactly,
  bestCandidate,
  computeAccuracyPair,
  type AccuracyPair,
} from '@/lib/textCompare';
import { ClickableWords } from './ClickableWords';
import { useLearningChatToggle } from './LearningChatLayout';
import { useAction, useMutation } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { getUserTimezone } from '@/lib/timezone';
import { reportError } from '@/lib/report-error';
import { convexErrorCode, isPaymentPastDueError } from '@/lib/utils';
import { WritingFeedbackCard, type RowFeedback } from './WritingFeedbackCard';
import { WritingVoiceButton } from './WritingVoiceButton';
import {
  audioUrlForShownSentence,
  primeAfterSubmitAudioElement,
} from './shownSentenceAudio';
import { useLimitDialog } from '@/components/feature_tracking/useFeatureLock';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import {
  getLanguageByCode,
  getLocalizedLanguageNameByCode,
  getTextDirection,
  languageSupportsStt,
} from '@/lib/languages';
import { useImeSafeEnter } from '@/hooks/use-ime-safe-enter';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import { useCardPlayback, displayReviewCount } from './useCardPlayback';
import type {
  CardTranslation,
  CardTranslationAlternative,
  CardAudioRecording,
  WritingAccuracySummary,
} from './types';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';

type TargetAudioMode = 'always' | 'afterSubmit' | 'never';

const NO_ALTERNATIVES: CardTranslationAlternative[] = [];

interface LanguageInputState {
  submitted: boolean;
  userText: string;
}

interface FullReviewCardContentProps {
  /**
   * Shared card presentation: identity/content, flags, annotation toggles,
   * action callbacks + quota state, and the merged-audio bundle. See
   * `cardPresentation.ts`.
   */
  presentation: CardPresentation;
  targetAudioMode: TargetAudioMode;
  /**
   * Transcribe writing style: the merged target audio is the prompt and the
   * user types what they hear (vs. translating the base text).
   */
  transcribeMode?: boolean;
  /** Blur base-language text ("Hide base languages", writing-mode setting). */
  hideBaseLanguages?: boolean;
  /** Un-blur base text once every target translation is submitted. */
  autoRevealBaseOnSubmit?: boolean;
  /** Exclude punctuation from the accuracy score ("Ignore punctuation"). */
  ignorePunctuation?: boolean;
  /**
   * "AI feedback on answers" (courseSettings.aiWritingFeedback): grade
   * non-matching submitted answers with the LLM and show a coach card under
   * the diff. Requires `cardId`. Applies in both writing styles; in
   * transcribe the grader runs in transcription mode (see `mode` on
   * gradeWritingAnswer).
   */
  aiFeedbackEnabled?: boolean;
  /**
   * Turns the aiWritingFeedback course setting off. Offered on the
   * quota-reached line as the alternative to upgrading.
   */
  onDisableAiFeedback?: () => void;
  /**
   * Post-submit playback settings ("Translation Entered" timeline group), per
   * language. Missing entry = 1 play; speed falls back to the per-language
   * effective speed.
   */
  afterSubmitRepetitions?: Record<string, number>;
  afterSubmitRepetitionPauses?: Record<string, number>;
  afterSubmitPlaybackSpeeds?: Record<string, number>;
  /**
   * Never auto-start clip playback (e.g. while the settings sheet is open).
   * A settings change (writing style / target-audio mode) can otherwise make
   * an already-submitted input qualify for after-submit playback and blast
   * audio behind the sheet.
   */
  suppressAutoPlay?: boolean;
  allRevealed?: boolean;
  onAllSubmittedChange?: (allSubmitted: boolean) => void;
  onAccuracyChange?: (summary: WritingAccuracySummary | null) => void;
  bare?: boolean;
  /**
   * Registers a "revert one submitted translation" handler with the parent
   * for the stepwise-back shortcut (Left Arrow). The handler returns true
   * when it consumed the press (something was reverted); false lets the
   * parent fall through to undoing the last review. Unregistered (null) on
   * unmount.
   */
  onRegisterRevert?: (fn: (() => boolean) | null) => void;
  /**
   * "Show translation on new sentences": the answer is rendered above the
   * input for copy-typing ("Abschreiben"). Computed by LearningMode from the
   * course setting + the card's review count (see the firstExposure const
   * there) so onboarding and the main app share one predicate.
   */
  firstExposure?: boolean;
  /** Karaoke word highlighting toggle (defaults true). */
  highlightEnabled?: boolean;
  /** Course-level per-language general speed. */
  languagePlaybackSpeeds?: Record<string, number>;
}

export function FullReviewCardContent({
  presentation,
  targetAudioMode,
  transcribeMode = false,
  hideBaseLanguages = false,
  autoRevealBaseOnSubmit = true,
  ignorePunctuation = false,
  aiFeedbackEnabled = false,
  onDisableAiFeedback,
  afterSubmitRepetitions,
  afterSubmitRepetitionPauses,
  afterSubmitPlaybackSpeeds,
  suppressAutoPlay = false,
  allRevealed = false,
  onAllSubmittedChange,
  onAccuracyChange,
  bare = false,
  onRegisterRevert,
  firstExposure = false,
  highlightEnabled = true,
  languagePlaybackSpeeds,
}: FullReviewCardContentProps) {
  const {
    cardId,
    preReviewCount,
    schedulingPhase,
    fsrsState,
    translations,
    audioRecordings,
    onAudioPlay,
    showRomanization = true,
    showIpa = false,
    showFurigana = true,
    mergedPlayback,
    audioSpeedOverrides,
    onSpeedCycle,
    resetSignal,
    replayTargetSignal,
  } = presentation;
  const t = useTranslations('LearningMode');
  const locale = useLocale();

  const { buttonPlayback, activeClip, clockBinding } =
    useCardPlayback(mergedPlayback);

  // Reveal-sweep / post-submit auto-play uses raw <Audio> elements; route their
  // progress through the shared button-playback channel so <ClickableWords>
  // lights up just like it does for manual AudioButton clicks.
  const buttonTimeUpdateRef = useRef(buttonPlayback.onTimeUpdate);
  buttonTimeUpdateRef.current = buttonPlayback.onTimeUpdate;
  const buttonStopRef = useRef(buttonPlayback.onStop);
  buttonStopRef.current = buttonPlayback.onStop;

  // Fingerprint of everything derived from `translations` below. The role flag is
  // part of it because `targetTranslations` filters on it: two languages could
  // swap base/target roles with their text unchanged, and the key has to move
  // for that (it also has to rebuild the inputs map, which it now does).
  const translationKey = translations
    .map(
      (tr) =>
        `${tr.language}\u0000${tr.isTargetLanguage ? 'T' : 'B'}\u0000${tr.text}`,
    )
    .join('|');

  // `translations` is a fresh array on every render, so keying on the fingerprint
  // rather than the array is what lets the accuracy memo below actually memoize.
  // Depending on `translations` here is precisely the thing being avoided. The
  // disable is load-bearing, not an oversight.
  const targetTranslations = useMemo(
    () => translations.filter((tr) => tr.isTargetLanguage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translationKey],
  );
  const showLanguageLabel = targetTranslations.length > 1;

  // Accepted alternatives per target language. DELIBERATELY outside
  // `translationKey`: storing a new alternative mid-card must not trip the
  // key-change reset that wipes typed answers and feedback. Own fingerprint,
  // so a freshly stored alternative still flows in reactively. Empty in
  // transcribe mode — there the answer must match the audio, alternatives
  // must not grant credit.
  const alternativesKey = transcribeMode
    ? ''
    : translations
        .map(
          (tr) =>
            `${tr.language}\u0000${JSON.stringify(tr.alternatives ?? [])}`,
        )
        .join('|');
  const alternativesByLanguage = useMemo(() => {
    const map = new Map<string, CardTranslationAlternative[]>();
    if (transcribeMode) return map;
    for (const tr of translations) {
      if (
        tr.isTargetLanguage &&
        tr.alternatives &&
        tr.alternatives.length > 0
      ) {
        map.set(tr.language, tr.alternatives);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alternativesKey]);

  const [inputs, setInputs] = useState<Map<string, LanguageInputState>>(
    () =>
      new Map(
        targetTranslations.map((tr) => [
          tr.language,
          { submitted: false, userText: '' },
        ]),
      ),
  );

  const [submissionOrder, setSubmissionOrder] = useState<string[]>([]);
  // Base languages the viewer manually un-blurred by tapping (only relevant
  // with "Hide base languages" on).
  const [manuallyRevealedBase, setManuallyRevealedBase] = useState<Set<string>>(
    () => new Set(),
  );
  // AI feedback per submitted language row. An entry existing (any status)
  // marks the row as handled, so the kick-off effect below never double-fires
  // a request. Cleared on card change, reset, and per-row revert.
  const [feedback, setFeedback] = useState<Map<string, RowFeedback>>(
    () => new Map(),
  );

  const revealAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealAbortedRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const inputRefsByLanguage = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );
  const submissionOrderRef = useRef<string[]>([]);
  submissionOrderRef.current = submissionOrder;
  // `inputs` gets a new identity on every keystroke, so the accuracy memo below
  // re-runs while the learner types the NEXT language, with nothing changed
  // about the answers already submitted. Keyed on the actual comparison inputs,
  // so each distinct answer is diffed exactly once. Pure cache (same key always
  // yields the same value), so a StrictMode double render is harmless. Cleared
  // when the card changes, below.
  const pairCacheRef = useRef(new Map<string, AccuracyPair>());
  // Per-language grade-request sequence. Each kick-off bumps the row's
  // counter and a resolution lands only while its number is still current.
  // Entry existence alone cannot guard this: a revert deletes the entry, but
  // a resubmit re-creates it, and the older request's verdict (for the old
  // answer) must not attach to the new one — including through `.catch`,
  // where a stale USAGE_LIMIT would mark the fresh request 'limit'.
  const feedbackRequestSeqRef = useRef<Map<string, number>>(new Map());

  // Keyed on the translation content AND the card id: two consecutive cards
  // can carry byte-identical translations (duplicate sentences across
  // collections), and a reset that only watched the text would keep the old
  // card's `submitted: true` inputs alive — the grade kick-off effect below
  // would then re-grade the previous card's answers against the new cardId,
  // spending quota and attaching verdicts to the wrong card.
  const [prevTranslationKey, setPrevTranslationKey] = useState(translationKey);
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (translationKey !== prevTranslationKey || cardId !== prevCardId) {
    setPrevTranslationKey(translationKey);
    setPrevCardId(cardId);
    setInputs(
      new Map(
        targetTranslations.map((tr) => [
          tr.language,
          { submitted: false, userText: '' },
        ]),
      ),
    );
    setSubmissionOrder([]);
    setManuallyRevealedBase(new Set());
    setFeedback(new Map());
    // Invalidate any in-flight grades: their sequence numbers no longer match,
    // so a reply from before the reset can't land on a fresh submission.
    feedbackRequestSeqRef.current = new Map();
    pairCacheRef.current.clear();
  }

  const allSubmitted =
    targetTranslations.length > 0 &&
    targetTranslations.every((tr) => inputs.get(tr.language)?.submitted);

  // After submit the translation <input> unmounts and the browser parks
  // focus on the nearest tabbable: a speaker, Undo, a clickable word
  // (`role="button"`), or a coach-card action. LearningControls then
  // ignores Enter, so next-card dies. Park focus on this sentinel instead.
  const cardSentinelRef = useRef<HTMLDivElement>(null);
  const feedbackFocusKey = [...feedback.entries()]
    .map(([lang, row]) => `${lang}:${row.status}:${row.result?.verdict ?? ''}`)
    .sort()
    .join('|');
  useLayoutEffect(() => {
    if (!allSubmitted) return;
    cardSentinelRef.current?.focus({ preventScroll: true });
  }, [allSubmitted, feedbackFocusKey]);

  const onAllSubmittedChangeRef = useRef(onAllSubmittedChange);
  onAllSubmittedChangeRef.current = onAllSubmittedChange;
  useEffect(() => {
    onAllSubmittedChangeRef.current?.(allSubmitted);
  }, [allSubmitted]);

  // Accuracy across the target languages submitted SO FAR. Deliberately not
  // gated on `allSubmitted`: the auto-rating needs a running figure as each
  // language lands, and the consumer decides separately when to persist a stat.
  //
  // Note `ignorePunctuation` is absent from the deps, both variants are always
  // computed, so the summary is setting-independent and both stat series can be
  // populated in parallel. The setting only picks which one is acted on.
  const accuracySummary = useMemo<WritingAccuracySummary | null>(() => {
    if (targetTranslations.length === 0) return null;

    const pairs = targetTranslations
      .filter((tr) => inputs.get(tr.language)?.submitted)
      .map((tr) => {
        // AI grader accepted the answer (a fresh alsoCorrect, or a server
        // 'correct' — a primary/alternative match, including the zh/ko
        // romanized equality the client gate can't see): the row counts as
        // fully correct so auto-rating doesn't punish a legitimate answer.
        const fb = feedback.get(tr.language);
        if (
          fb?.status === 'done' &&
          (fb.result?.verdict === 'alsoCorrect' ||
            fb.result?.verdict === 'correct')
        ) {
          return { withPunctuation: 100, withoutPunctuation: 100 };
        }
        const userText = inputs.get(tr.language)?.userText ?? '';
        // Best pair across the same candidate list the closest-answer diff
        // uses (answerCandidates + bestCandidate, shared via
        // lib/textCompare/bestMatch), so this summary is always computed
        // against the sentence the diff shows — two phases: before grading
        // it ranks the primary + stored alternatives; once the grader
        // responds, its corrected sentence joins the ranking here AND in
        // the diff (this memo depends on `feedback`, so the rescore and
        // the re-preselected rating follow automatically).
        const candidates = answerCandidates(
          tr.text,
          (alternativesByLanguage.get(tr.language) ?? []).map((a) => a.text),
          fb?.status === 'done' ? fb.result?.corrected : undefined,
        );
        return bestCandidate(candidates, userText, tr.language, (candidate) => {
          const cacheKey = `${tr.language}\u0000${candidate}\u0000${userText}`;
          let pair = pairCacheRef.current.get(cacheKey);
          if (!pair) {
            pair = computeAccuracyPair(candidate, userText, tr.language);
            pairCacheRef.current.set(cacheKey, pair);
          }
          return pair;
        }).pair;
      });

    const base = {
      allSubmitted,
      submittedCount: pairs.length,
      targetCount: targetTranslations.length,
    };
    if (pairs.length === 0) {
      return {
        ...base,
        avgWithPunctuation: null,
        avgWithoutPunctuation: null,
        minWithPunctuation: null,
        minWithoutPunctuation: null,
      };
    }

    const mean = (ns: number[]) =>
      Math.round(ns.reduce((sum, n) => sum + n, 0) / ns.length);
    const strict = pairs.map((p) => p.withPunctuation);
    const lenient = pairs.map((p) => p.withoutPunctuation);

    return {
      ...base,
      avgWithPunctuation: mean(strict),
      avgWithoutPunctuation: mean(lenient),
      minWithPunctuation: Math.min(...strict),
      minWithoutPunctuation: Math.min(...lenient),
    };
  }, [
    allSubmitted,
    inputs,
    targetTranslations,
    feedback,
    alternativesByLanguage,
  ]);

  const onAccuracyChangeRef = useRef(onAccuracyChange);
  onAccuracyChangeRef.current = onAccuracyChange;
  // Emit only on STRUCTURAL change, not referential. `inputs` gets a new identity
  // on every keystroke, so the memo above re-produces a new (but equal) object
  // whenever the learner types into a language that isn't submitted yet.
  // Emitting that unconditionally makes the parent store it in state and
  // re-render on every character. (The old code emitted a bare number and was
  // saved by React's same-value bailout; an object needs the comparison done
  // explicitly.)
  const lastEmittedSummaryRef = useRef<WritingAccuracySummary | null>(null);
  useEffect(() => {
    const prev = lastEmittedSummaryRef.current;
    const unchanged =
      prev === accuracySummary ||
      (prev != null &&
        accuracySummary != null &&
        prev.allSubmitted === accuracySummary.allSubmitted &&
        prev.submittedCount === accuracySummary.submittedCount &&
        prev.targetCount === accuracySummary.targetCount &&
        prev.avgWithPunctuation === accuracySummary.avgWithPunctuation &&
        prev.avgWithoutPunctuation === accuracySummary.avgWithoutPunctuation &&
        prev.minWithPunctuation === accuracySummary.minWithPunctuation &&
        prev.minWithoutPunctuation === accuracySummary.minWithoutPunctuation);
    if (unchanged) return;
    lastEmittedSummaryRef.current = accuracySummary;
    onAccuracyChangeRef.current?.(accuracySummary);
  }, [accuracySummary]);

  const onAudioPlayRef = useRef(onAudioPlay);
  onAudioPlayRef.current = onAudioPlay;
  const suppressAutoPlayRef = useRef(suppressAutoPlay);
  suppressAutoPlayRef.current = suppressAutoPlay;

  useEffect(() => {
    if (!allRevealed) return;
    // In afterSubmit mode, target clips play only from TargetLanguageInput on submit (see docs/review_modes).
    // A reveal sweep here duplicates that audio (e.g. last submit + full sequence). never disables target auto-play.
    if (targetAudioMode === 'afterSubmit' || targetAudioMode === 'never')
      return;

    const unsubmittedAudio = targetTranslations
      .filter((tr) => !inputs.get(tr.language)?.submitted)
      .map((tr) => ({
        language: tr.language,
        url:
          audioRecordings.find((a) => a.language === tr.language)?.url ?? null,
      }))
      .filter(
        (entry): entry is { language: string; url: string } =>
          entry.url != null,
      );

    if (unsubmittedAudio.length === 0) return;

    // Settings change mid-card (e.g. switching target audio to 'always'
    // behind the open sheet): never start the sweep. Nothing to queue for
    // sheet-close either — this effect doesn't re-run on suppressAutoPlay
    // (deliberately read via ref), so skipping is already final.
    if (suppressAutoPlayRef.current) {
      return;
    }

    revealAbortedRef.current = false;
    onAudioPlayRef.current?.();

    let idx = 0;
    let raf = 0;
    let activeLanguage: string | null = null;

    const stopTracking = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (activeLanguage) {
        buttonStopRef.current(activeLanguage);
        activeLanguage = null;
      }
    };

    const playNext = () => {
      stopTracking();
      if (revealAbortedRef.current || idx >= unsubmittedAudio.length) {
        revealAudioRef.current = null;
        return;
      }
      const entry = unsubmittedAudio[idx];
      const audio = new Audio(entry.url);
      revealAudioRef.current = audio;
      activeLanguage = entry.language;
      const tick = () => {
        buttonTimeUpdateRef.current(entry.language, audio.currentTime);
        raf = requestAnimationFrame(tick);
      };
      audio.onended = () => {
        stopTracking();
        idx++;
        playNext();
      };
      audio
        .play()
        .then(() => {
          raf = requestAnimationFrame(tick);
        })
        .catch((err) => {
          // Deliberately not reportError: autoplay-policy rejections are an
          // expected browser state, not an exception (see lib/report-error).
          if (err.name !== 'AbortError')
            console.error('Reveal auto-play failed:', err);
          stopTracking();
          idx++;
          playNext();
        });
    };
    playNext();

    return () => {
      revealAbortedRef.current = true;
      stopTracking();
      revealAudioRef.current?.pause();
      revealAudioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRevealed, translationKey, targetAudioMode]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      firstInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [translationKey]);

  const handleInputChange = useCallback((language: string, text: string) => {
    setInputs((prev) => {
      const next = new Map(prev);
      next.set(language, { submitted: false, userText: text });
      return next;
    });
  }, []);

  const applyRevertToLanguage = useCallback((language: string) => {
    setInputs((prev) => {
      const current = prev.get(language);
      if (!current?.submitted) return prev;
      const next = new Map(prev);
      next.set(language, { submitted: false, userText: '' });
      return next;
    });
    // Drop the row's AI feedback; an in-flight grade sees the missing entry
    // and discards its result instead of resurrecting it.
    setFeedback((prev) => {
      if (!prev.has(language)) return prev;
      const next = new Map(prev);
      next.delete(language);
      return next;
    });
    requestAnimationFrame(() => {
      inputRefsByLanguage.current[language]?.focus({ preventScroll: true });
    });
  }, []);

  const revertLanguage = useCallback(
    (language: string) => {
      const prev = submissionOrderRef.current;
      const i = prev.lastIndexOf(language);
      if (i < 0) return;
      const next = [...prev];
      next.splice(i, 1);
      setSubmissionOrder(next);
      applyRevertToLanguage(language);
    },
    [applyRevertToLanguage],
  );

  const revertLastSubmitted = useCallback(() => {
    const prev = submissionOrderRef.current;
    if (prev.length === 0) return;
    const language = prev[prev.length - 1];
    setSubmissionOrder(prev.slice(0, -1));
    applyRevertToLanguage(language);
  }, [applyRevertToLanguage]);

  // Left Arrow itself is bound centrally in LearningControls; this component
  // only contributes the "revert one submission" step of the stepwise-back
  // behavior via the registration channel.
  const onRegisterRevertRef = useRef(onRegisterRevert);
  onRegisterRevertRef.current = onRegisterRevert;
  useEffect(() => {
    const register = onRegisterRevertRef.current;
    if (!register) return;
    register(() => {
      if (submissionOrderRef.current.length === 0) return false;
      revertLastSubmitted();
      return true;
    });
    return () => register(null);
  }, [revertLastSubmitted]);

  // Restart-card signal: back to the freshly-dealt state. Initialized to the
  // mount value so a stale nonce never wipes a fresh card (same contract as
  // revealAllSignal in LearningCardContent).
  const lastResetSignalRef = useRef(resetSignal);
  useEffect(() => {
    if (
      resetSignal === undefined ||
      resetSignal === lastResetSignalRef.current
    ) {
      return;
    }
    lastResetSignalRef.current = resetSignal;
    setInputs(
      new Map(
        targetTranslations.map((tr) => [
          tr.language,
          { submitted: false, userText: '' },
        ]),
      ),
    );
    setSubmissionOrder([]);
    setManuallyRevealedBase(new Set());
    setFeedback(new Map());
    // Invalidate any in-flight grades by bumping, never clearing. This reset
    // stays on the same card, so the card-id half of the staleness check
    // can't help: a cleared map would hand the next submission seq 1 — the
    // same number an in-flight request already holds — and its late reply
    // would pass the check and land on the fresh submission.
    for (const [language, seq] of feedbackRequestSeqRef.current) {
      feedbackRequestSeqRef.current.set(language, seq + 1);
    }
    const raf = requestAnimationFrame(() => {
      firstInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [resetSignal, targetTranslations]);

  // "Hide base languages" (writing mode): blur base rows until every target is
  // submitted (when auto-reveal-on-submit is on), the post-rating reveal fires,
  // or the viewer taps a row. Revealing per submitted language would hand the
  // remaining inputs the meaning for free, so the signal is all-or-nothing.
  const revealBaseAll = (autoRevealBaseOnSubmit && allSubmitted) || allRevealed;
  const revealedBaseLanguages = useMemo<ReadonlySet<string>>(
    () =>
      revealBaseAll
        ? new Set(
            translations
              .filter((tr) => tr.isBaseLanguage)
              .map((tr) => tr.language),
          )
        : new Set<string>(),
    [revealBaseAll, translations],
  );
  const handleRevealBase = useCallback((language: string) => {
    setManuallyRevealedBase((prev) => {
      if (prev.has(language)) return prev;
      const next = new Set(prev);
      next.add(language);
      return next;
    });
  }, []);

  const handleSubmit = useCallback((language: string) => {
    setInputs((prev) => {
      const current = prev.get(language);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(language, { ...current, submitted: true });
      return next;
    });
    setSubmissionOrder((prev) => [...prev, language]);
  }, []);

  // ----- AI writing feedback -------------------------------------------------
  // On in both writing styles. Transcribe sends mode 'transcribe', where the
  // server grades against the audio's exact sentence ("also correct" has no
  // meaning there, alternatives grant no credit, nothing is stored).
  // First-exposure copy-typing rows stay ON: a fresh course is ALL
  // first-exposure cards, and an exact copy resolves in the free local gate
  // anyway, so only mistyped copies reach the LLM — which is exactly when a
  // note helps.
  const feedbackActive = aiFeedbackEnabled && !!cardId;
  const gradeWritingAnswer = useAction(
    api.features.writingFeedback.gradeWritingAnswer,
  );
  const cardIdForFeedbackRef = useRef(cardId);
  cardIdForFeedbackRef.current = cardId;

  // Turning the setting off mid-card (e.g. via the quota line's "Turn off"
  // button) clears what's already on screen instead of leaving stale
  // limit/pending rows around until the next card.
  useEffect(() => {
    if (!feedbackActive) {
      setFeedback((prev) => (prev.size > 0 ? new Map() : prev));
    }
  }, [feedbackActive]);

  // "Make default" on an alsoCorrect result: replace the card's sentence for
  // that language with the grader's corrected text through the normal edit
  // flow (audit log, curriculum fork, audio regeneration, card_edits quota).
  // The answer stays a stored accepted alternative either way. Rethrows so
  // the coach card's prompt resets instead of showing a false success.
  const editCardMutation = useMutation(api.features.scheduling.editCard);
  const cardEditsLock = useLimitDialog(FEATURE_IDS.CARD_EDITS);
  const openCardEditsLimitDialog = cardEditsLock.openLimitDialog;
  const handleMakeDefault = useCallback(
    async (language: string, text: string) => {
      if (!cardId) return;
      try {
        await editCardMutation({
          cardId,
          translations: [{ language, text }],
          timezone: getUserTimezone(),
        });
      } catch (error) {
        // A spent card_edits balance is the upgrade path, not a retry: the
        // generic "please try again" toast would misdirect (retrying cannot
        // succeed). Same routing as EditCardDialog, the other editCard caller.
        if (convexErrorCode(error) === 'USAGE_LIMIT') {
          openCardEditsLimitDialog();
        } else if (!isPaymentPastDueError(error)) {
          toast.error(t('feedback.makeDefaultError'));
        }
        throw error;
      }
    },
    [cardId, editCardMutation, openCardEditsLimitDialog, t],
  );

  // Kick-off runs as an effect over committed state (not inside handleSubmit)
  // so the voice path — onInputChange immediately followed by onSubmit — sees
  // the final text. An existing `feedback` entry marks a row as handled.
  useEffect(() => {
    if (!feedbackActive || !cardId) return;
    for (const tr of targetTranslations) {
      const state = inputs.get(tr.language);
      if (!state?.submitted || feedback.has(tr.language)) continue;
      const answer = state.userText.trim();
      if (!answer) continue;

      const language = tr.language;
      // Local gate, mirroring the server's (writingAnswersMatch): exact
      // punctuation/case-insensitive EQUALITY against the primary or any
      // stored accepted alternative needs no grader. Deliberately not a
      // rounded accuracy >= 100: that let a one-character typo in a long
      // sentence round to 100 and skip the grader, where the server's gate
      // is documented to hand typos to the LLM for a 'minor' verdict.
      const localMatch = [
        { text: tr.text, matched: 'primary' as const },
        ...(alternativesByLanguage.get(language) ?? []).map((a) => ({
          text: a.text,
          matched: 'alternative' as const,
        })),
      ].find((c) => answersMatchExactly(c.text, answer));
      if (localMatch) {
        setFeedback((prev) =>
          new Map(prev).set(language, {
            status: 'done',
            result: { verdict: 'correct', matched: localMatch.matched },
          }),
        );
        continue;
      }

      setFeedback((prev) => new Map(prev).set(language, { status: 'pending' }));
      const requestCardId = cardId;
      const requestSeq = (feedbackRequestSeqRef.current.get(language) ?? 0) + 1;
      feedbackRequestSeqRef.current.set(language, requestSeq);
      // Stale = the card changed, or a revert+resubmit issued a newer request
      // for this row. Checked at resolution time so the slower of two
      // in-flight requests can never overwrite the newer one's slot.
      const isStale = () =>
        cardIdForFeedbackRef.current !== requestCardId ||
        feedbackRequestSeqRef.current.get(language) !== requestSeq;
      gradeWritingAnswer({
        cardId,
        language,
        userAnswer: answer,
        mode: transcribeMode ? 'transcribe' : 'translate',
      })
        .then((result) => {
          if (isStale()) return;
          setFeedback((prev) => {
            // Reverted (entry deleted) while in flight: discard.
            if (!prev.has(language)) return prev;
            return new Map(prev).set(language, {
              status: result.verdict === 'error' ? 'error' : 'done',
              result,
            });
          });
        })
        .catch((error) => {
          if (isStale()) return;
          const status: RowFeedback['status'] =
            convexErrorCode(error) === 'USAGE_LIMIT' ? 'limit' : 'error';
          // USAGE_LIMIT and payment-past-due are expected product states
          // with their own surfaces (quota line / overdue dialog), not
          // exceptions.
          if (status === 'error' && !isPaymentPastDueError(error)) {
            reportError(error, { op: 'gradeWritingAnswer', language });
          }
          setFeedback((prev) => {
            if (!prev.has(language)) return prev;
            return new Map(prev).set(language, { status });
          });
        });
    }
  }, [
    feedbackActive,
    cardId,
    inputs,
    feedback,
    targetTranslations,
    alternativesByLanguage,
    gradeWritingAnswer,
    transcribeMode,
  ]);

  const assignInputRef = useCallback(
    (language: string, index: number) => (el: HTMLInputElement | null) => {
      inputRefsByLanguage.current[language] = el;
      if (index === 0) {
        firstInputRef.current = el;
      }
    },
    [],
  );

  return (
    <div
      ref={cardSentinelRef}
      tabIndex={-1}
      data-tutorial={TUTORIAL_ANCHORS.cardContentFull}
      data-testid="writing-review-card"
      className="flex flex-col flex-1 min-h-0 outline-none"
    >
      <CardShell
        presentation={presentation}
        reviewCount={displayReviewCount(
          preReviewCount,
          schedulingPhase,
          fsrsState,
        )}
        bare={bare}
        highlightEnabled={highlightEnabled}
        activeClip={activeClip}
        clockBinding={clockBinding}
        onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
        onButtonStop={buttonPlayback.onStop}
        languagePlaybackSpeeds={languagePlaybackSpeeds}
        hideBaseLanguages={hideBaseLanguages}
        autoRevealBaseLanguages={true}
        revealedLanguages={revealedBaseLanguages}
        manuallyRevealedLanguages={manuallyRevealedBase}
        onRevealLanguage={handleRevealBase}
        // Writing mode's word-tap tip anchor. Audio mode tags its target row
        // instead (LearningCardContent); here the target row is the answer
        // and isn't on screen before submit, so the base sentence is the
        // clickable text the tip is actually about.
        baseCoachmarkAnchorForLongestWord="word-tap"
      >
        {({ targetTranslations: targets }) => (
          <div className="space-y-4">
            {targets.map((translation, index) => {
              const audio = audioRecordings.find(
                (a) => a.language === translation.language,
              );
              const state = inputs.get(translation.language) ?? {
                submitted: false,
                userText: '',
              };

              const override =
                audioSpeedOverrides?.[translation.language] ?? null;
              const generalSpeed =
                languagePlaybackSpeeds?.[translation.language] ??
                DEFAULT_PLAYBACK_SPEED;
              const effectiveSpeed = override ?? generalSpeed;
              // Post-submit playback ("Translation Entered" group): missing
              // entry = play once at the effective speed.
              const afterSubmitPlayback = {
                reps: afterSubmitRepetitions?.[translation.language] ?? 1,
                pauseSec:
                  afterSubmitRepetitionPauses?.[translation.language] ??
                  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
                speed:
                  afterSubmitPlaybackSpeeds?.[translation.language] ??
                  effectiveSpeed,
              };

              return (
                <TargetLanguageInput
                  key={translation.language}
                  translation={translation}
                  audioUrl={audio?.url ?? null}
                  wordTimings={audio?.wordTimings ?? null}
                  state={state}
                  feedback={feedback.get(translation.language) ?? null}
                  feedbackActive={feedbackActive}
                  transcribeMode={transcribeMode}
                  alternatives={
                    alternativesByLanguage.get(translation.language) ??
                    NO_ALTERNATIVES
                  }
                  onDisableAiFeedback={onDisableAiFeedback}
                  onMakeDefault={handleMakeDefault}
                  targetAudioMode={targetAudioMode}
                  onInputChange={handleInputChange}
                  onSubmit={handleSubmit}
                  onRevert={() => revertLanguage(translation.language)}
                  onAudioPlay={onAudioPlay}
                  submitLabel={t('submitAnswer')}
                  placeholder={t(
                    transcribeMode ? 'typeTranscription' : 'typeTranslation',
                  )}
                  revertLabel={t('revertSubmission')}
                  revertTooltip={t('revertSubmissionTooltip')}
                  showLanguageLabel={showLanguageLabel}
                  locale={locale}
                  inputRef={assignInputRef(translation.language, index)}
                  autoFocus={index === 0}
                  isFirstTarget={index === 0}
                  playSignal={index === 0 ? replayTargetSignal : undefined}
                  allRevealed={allRevealed}
                  firstExposure={firstExposure}
                  showRomanization={showRomanization}
                  showIpa={showIpa}
                  showFurigana={showFurigana}
                  ignorePunctuation={ignorePunctuation}
                  highlightEnabled={highlightEnabled}
                  activeClip={activeClip}
                  clockBinding={clockBinding}
                  onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
                  onButtonStop={buttonPlayback.onStop}
                  speed={effectiveSpeed}
                  afterSubmitPlayback={afterSubmitPlayback}
                  suppressAutoPlay={suppressAutoPlay}
                  speedOverride={override}
                  generalSpeed={generalSpeed}
                  onSpeedCycle={
                    onSpeedCycle
                      ? (next) => onSpeedCycle(translation.language, next)
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </CardShell>
      {/* card_edits paywall for make-default (opened from handleMakeDefault). */}
      {cardEditsLock.limitDialog}
    </div>
  );
}

interface TargetLanguageInputProps {
  translation: CardTranslation;
  audioUrl: string | null;
  wordTimings: CardAudioRecording['wordTimings'];
  state: LanguageInputState;
  /** AI feedback for this row; null = none requested (yet). */
  feedback: RowFeedback | null;
  /**
   * AI grading is on for this card. After-submit autoplay waits for a local
   * match or a finished grade so it doesn't play the default clip while the
   * answer may still be accepted as an alternative.
   */
  feedbackActive?: boolean;
  /** Transcribe writing style; the Discuss chat action grades as transcription. */
  transcribeMode?: boolean;
  /** Accepted alternatives for this language (empty in transcribe mode). */
  alternatives: CardTranslationAlternative[];
  /** Turns the aiWritingFeedback setting off (quota-reached line). */
  onDisableAiFeedback?: () => void;
  /** Replaces the card's sentence for a language (alsoCorrect make-default). */
  onMakeDefault?: (language: string, text: string) => Promise<void>;
  targetAudioMode: TargetAudioMode;
  onInputChange: (language: string, text: string) => void;
  onSubmit: (language: string) => void;
  onRevert: () => void;
  onAudioPlay?: () => void;
  submitLabel: string;
  placeholder: string;
  revertLabel: string;
  revertTooltip: string;
  showLanguageLabel: boolean;
  locale: string;
  inputRef?: React.RefCallback<HTMLInputElement | null>;
  autoFocus?: boolean;
  isFirstTarget?: boolean;
  /** Keyboard replay nonce, forwarded to this row's AudioButton (first target only). */
  playSignal?: number;
  allRevealed?: boolean;
  /**
   * Card's first-ever exposure: show the target sentence above the input so
   * the first rep is a copy-through instead of an impossible recall test.
   */
  firstExposure?: boolean;
  showRomanization?: boolean;
  /** IPA line toggle (from courseSettings.showIpa; default OFF). */
  showIpa?: boolean;
  /** Furigana ruby over kanji (courseSettings.showFurigana; default ON). */
  showFurigana?: boolean;
  ignorePunctuation?: boolean;
  highlightEnabled: boolean;
  activeClip: ButtonPlaybackActive | null;
  clockBinding?: ClockBinding;
  onButtonTimeUpdate: (language: string, localTime: number) => void;
  onButtonStop: (language: string) => void;
  /** Effective playback speed (override ?? general ?? 1). */
  speed: number;
  /** Reps/pause/speed for the post-submit auto-play of this language. */
  afterSubmitPlayback: { reps: number; pauseSec: number; speed: number };
  /** Never auto-start after-submit playback (settings sheet open). */
  suppressAutoPlay?: boolean;
  /** Stored override value, or null when none is stored. */
  speedOverride: number | null;
  /** Course-level general speed for this language. */
  generalSpeed: number;
  /** Cycle handler; null clears the override. */
  onSpeedCycle?: (next: number | null) => void;
}

function TargetLanguageInput({
  translation,
  audioUrl,
  wordTimings,
  state,
  feedback,
  feedbackActive = false,
  transcribeMode = false,
  alternatives,
  onDisableAiFeedback,
  onMakeDefault,
  targetAudioMode,
  onInputChange,
  onSubmit,
  onRevert,
  onAudioPlay,
  submitLabel,
  placeholder,
  revertLabel,
  revertTooltip,
  showLanguageLabel,
  locale,
  inputRef,
  autoFocus,
  isFirstTarget = false,
  playSignal,
  allRevealed = false,
  firstExposure = false,
  showRomanization = true,
  showIpa = false,
  showFurigana = true,
  ignorePunctuation = false,
  highlightEnabled,
  activeClip,
  clockBinding,
  onButtonTimeUpdate,
  onButtonStop,
  speed,
  afterSubmitPlayback,
  suppressAutoPlay = false,
  speedOverride,
  generalSpeed,
  onSpeedCycle,
}: TargetLanguageInputProps) {
  const isActive = activeClip?.language === translation.language;
  const t = useTranslations('LearningMode');
  const tChat = useTranslations('Chat');
  // Nullable. Absent outside learning mode (e.g. landing demo); the Discuss
  // button simply doesn't render then.
  const chatContext = useLearningChatToggle();
  const { compositionProps, isComposingEvent } = useImeSafeEnter();
  const [showClean, setShowClean] = useState(false);
  const autoPlayAudioRef = useRef<HTMLAudioElement | null>(null);
  // Read via ref inside the playback effect: the object is rebuilt each
  // render, and putting it in the deps would tear down a running clip.
  const afterSubmitPlaybackRef = useRef(afterSubmitPlayback);
  afterSubmitPlaybackRef.current = afterSubmitPlayback;
  // Same reason: not referentially stable across renders.
  const onAudioPlayPropRef = useRef(onAudioPlay);
  onAudioPlayPropRef.current = onAudioPlay;
  // Which clip after-submit autoplay last started. URL-level on purpose:
  // the shown sentence can change from the card default to a matching
  // alternative once the grader returns, and that must start a new clip.
  const autoPlayedUrlRef = useRef<string | null>(null);
  // After-submit autoplay disarmed for the rest of this submission: the row
  // came to qualify behind the open settings sheet (see the suppress branch
  // below), so sheet-close must not start the clip — not even one whose URL
  // settles only after the sheet closed. Re-arms when the row returns to
  // editing (submit revert, card/text reset).
  const autoPlayDisarmedRef = useRef(false);

  const hasUserText = !!state.userText.trim();
  const gradedCorrected =
    feedback?.status === 'done' ? feedback.result?.corrected : undefined;
  const diffCandidates = useMemo(
    () =>
      answerCandidates(
        translation.text,
        alternatives.map((a) => a.text),
        gradedCorrected,
      ),
    [translation.text, alternatives, gradedCorrected],
  );
  const closest = useMemo(() => {
    if (!hasUserText) return null;
    return bestCandidate(diffCandidates, state.userText, translation.language);
  }, [diffCandidates, hasUserText, state.userText, translation.language]);
  const closestExpected = closest?.text ?? translation.text;
  const acceptedItems = useMemo<CardTranslationAlternative[]>(
    () => [
      {
        text: translation.text,
        romanization: translation.romanization,
        ipa: translation.ipa,
        furigana: translation.furigana,
        audioUrl,
      },
      ...alternatives,
    ],
    [
      translation.text,
      translation.romanization,
      translation.ipa,
      translation.furigana,
      audioUrl,
      alternatives,
    ],
  );
  const correctedForDiff =
    !showClean && closestExpected !== translation.text ? closestExpected : null;

  // The grader may still accept this answer as an alternative. The local
  // match mirrors the server's free gate; an empty answer never reaches the
  // grader (the kick-off skips it), so it counts as settled.
  const answer = state.userText.trim();
  const matchedLocally =
    answersMatchExactly(translation.text, answer) ||
    alternatives.some((a) => answersMatchExactly(a.text, answer));
  const gradeExpected = feedbackActive && answer !== '';
  const gradeSettled =
    feedback?.status === 'done' ||
    feedback?.status === 'error' ||
    feedback?.status === 'limit';
  // alsoCorrect + savedAlternative: the corrected sentence WILL become an
  // accepted alternative, but its row + TTS land seconds after the grade.
  // Until then it matches nothing in `acceptedItems`, and the primary
  // fallback in audioUrlForShownSentence would say the old sentence — then
  // the alternative clip would start on top when the row lands. Hold both
  // speakers at null for that window instead.
  const awaitingSavedAlternative =
    feedback?.status === 'done' &&
    feedback.result?.verdict === 'alsoCorrect' &&
    feedback.result.savedAlternative === true &&
    !!feedback.result.corrected &&
    !answersMatchExactly(translation.text, feedback.result.corrected) &&
    !alternatives.some((a) =>
      answersMatchExactly(a.text, feedback.result!.corrected!),
    );

  const shownAudioUrl = awaitingSavedAlternative
    ? null
    : audioUrlForShownSentence(
        correctedForDiff ?? translation.text,
        translation.text,
        audioUrl,
        acceptedItems,
      );
  // The clip after-submit autoplay should be running, or null while we are
  // still waiting (grade in flight, or an accepted alternative's audio not
  // generated yet). Resolved in render — keyed off `closestExpected`, not
  // the showClean-dependent `correctedForDiff`, so the ShowCleanToggle can't
  // start a clip — and compared by value in the effect deps, so a feedback
  // state change that does NOT change the clip cannot tear down a running
  // one.
  const autoPlayUrl =
    !state.submitted ||
    targetAudioMode !== 'afterSubmit' ||
    awaitingSavedAlternative ||
    (!matchedLocally && gradeExpected && !gradeSettled)
      ? null
      : audioUrlForShownSentence(
          closestExpected,
          translation.text,
          audioUrl,
          acceptedItems,
        );

  useEffect(() => {
    if (!state.submitted) {
      setShowClean(false);
    }
  }, [state.submitted]);

  useEffect(() => {
    if (!state.submitted) {
      autoPlayedUrlRef.current = null;
      autoPlayDisarmedRef.current = false;
      autoPlayAudioRef.current?.pause();
      autoPlayAudioRef.current = null;
      return;
    }

    // A settings change (writing style / target-audio mode) can make an
    // already-submitted input qualify here while the sheet is open: never
    // start audio behind the sheet, and don't queue it for sheet-close.
    // Latched (not just skipped) because this effect re-runs when the sheet
    // closes — suppressAutoPlay is a dep — and the gate below only knows
    // URLs it has itself started.
    if (suppressAutoPlay) {
      autoPlayDisarmedRef.current = true;
      return;
    }
    if (autoPlayDisarmedRef.current) return;

    // Null while the clip is undecided (grade in flight, alternative audio
    // still generating) or autoplay doesn't apply; see the render-time
    // derivation.
    if (!autoPlayUrl) return;
    if (autoPlayedUrlRef.current === autoPlayUrl) return;

    autoPlayedUrlRef.current = autoPlayUrl;
    onAudioPlayPropRef.current?.();
    // Reuse the element primed on Enter/submit. A fresh `new Audio()` here
    // is outside the user-gesture window (the grader and TTS have already
    // run) and the browser would swallow play() — alternative clips
    // never started.
    const audio = primeAfterSubmitAudioElement(autoPlayAudioRef.current);
    autoPlayAudioRef.current = audio;
    audio.loop = false;
    audio.muted = false;
    // src FIRST: assigning it runs the media load algorithm, which resets
    // playbackRate to defaultPlaybackRate — a rate set before this line is
    // silently lost (the first play of every clip ran at 1×).
    audio.src = autoPlayUrl;
    audio.preservesPitch = true;
    const audioEl = audio as HTMLAudioElement & {
      webkitPreservesPitch?: boolean;
    };
    audioEl.webkitPreservesPitch = true;
    audio.defaultPlaybackRate = afterSubmitPlaybackRef.current.speed;
    audio.playbackRate = afterSubmitPlaybackRef.current.speed;

    let raf = 0;
    let playsDone = 0;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      onButtonTimeUpdate(translation.language, audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    audio.onended = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      onButtonStop(translation.language);
      playsDone++;
      // Re-read reps/pause from the ref so timeline edits made mid-playback
      // apply to the remaining repetitions.
      const { reps, pauseSec } = afterSubmitPlaybackRef.current;
      if (playsDone < reps) {
        pauseTimer = setTimeout(() => {
          pauseTimer = null;
          audio.currentTime = 0;
          audio.playbackRate = afterSubmitPlaybackRef.current.speed;
          audio
            .play()
            .then(() => {
              raf = requestAnimationFrame(tick);
            })
            .catch((err) => {
              // Autoplay-policy path; excluded from reportError by design.
              if (err.name !== 'AbortError')
                console.error('Auto-play failed:', err);
            });
        }, pauseSec * 1000);
      }
    };
    audio
      .play()
      .then(() => {
        raf = requestAnimationFrame(tick);
      })
      .catch((err) => {
        // Autoplay-policy path; excluded from reportError by design.
        if (err.name !== 'AbortError') console.error('Auto-play failed:', err);
      });

    return () => {
      // Only runs for genuine transitions (clip change, revert, the settings
      // sheet opening): `autoPlayUrl` is value-compared, so a feedback state
      // change that resolves to the same clip never re-runs this effect —
      // pausing here is safe and keeps a torn-down clip from lingering.
      if (raf) cancelAnimationFrame(raf);
      if (pauseTimer) clearTimeout(pauseTimer);
      audio.pause();
      audio.currentTime = 0;
      onButtonStop(translation.language);
    };
  }, [
    autoPlayUrl,
    state.submitted,
    translation.language,
    suppressAutoPlay,
    onButtonTimeUpdate,
    onButtonStop,
  ]);

  // Keep an already-running afterSubmit auto-play element in sync when its
  // speed changes mid-playback. Mirrors the pattern in AudioButton; without
  // this the rate set at element creation is sticky for the life of that clip.
  useEffect(() => {
    if (autoPlayAudioRef.current) {
      autoPlayAudioRef.current.playbackRate = afterSubmitPlayback.speed;
    }
  }, [afterSubmitPlayback.speed]);

  useEffect(() => {
    return () => {
      autoPlayAudioRef.current?.pause();
    };
  }, []);

  const primeAfterSubmitAudio = () => {
    if (targetAudioMode !== 'afterSubmit' || suppressAutoPlay) return;
    autoPlayAudioRef.current = primeAfterSubmitAudioElement(
      autoPlayAudioRef.current,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME users (ja/zh/ko/vi) press Enter to confirm a conversion. That
    // keystroke is typing, not a submit. See `useImeSafeEnter`.
    if (e.key === 'Enter' && !state.submitted && !isComposingEvent(e)) {
      e.preventDefault();
      primeAfterSubmitAudio();
      onSubmit(translation.language);
    }
  };

  const languageDisplayName = showLanguageLabel
    ? getLocalizedLanguageNameByCode(translation.language, locale)
    : null;

  // BCP-47 tag (not the internal `zh_traditional`-style code) so the OS offers
  // the right IME / keyboard layout when this field is focused.
  const inputLang = getLanguageByCode(translation.language)?.displayCode;

  const handleDiscuss = useCallback(() => {
    if (!chatContext) return;
    const attempt = state.userText.trim();
    // Full attempt goes in the payload; the visible bubble label is truncated
    // so it can never trip the message length limit.
    const attemptLabel =
      attempt.length > 120 ? `${attempt.slice(0, 120)}…` : attempt;
    // What the grader already told the user, so the chat builds on it
    // instead of repeating or contradicting it. Bounded by construction
    // (verdict + <=3 capped notes + a card-length corrected sentence).
    const graded =
      feedback?.status === 'done' &&
      feedback.result &&
      feedback.result.verdict !== 'error' &&
      feedback.result.verdict !== 'correct'
        ? feedback.result
        : undefined;
    const aiFeedback = graded
      ? [
          `verdict: ${graded.verdict}`,
          graded.corrected ? `corrected: "${graded.corrected}"` : null,
          ...(graded.notes ?? []).map((n) => `note (${n.type}): ${n.text}`),
        ]
          .filter(Boolean)
          .join('; ')
      : undefined;
    chatContext.openChatWithAction(
      {
        kind: 'discussAnswer',
        userAnswer: attempt,
        expected: translation.text,
        language: translation.language,
        // Transcribe: the chat judges the attempt as a transcription of the
        // audio, not as a possibly-also-correct translation.
        ...(transcribeMode ? { transcribe: true } : {}),
        ...(aiFeedback ? { aiFeedback } : {}),
      },
      tChat('discuss.message', { attempt: attemptLabel }),
    );
  }, [
    chatContext,
    state.userText,
    translation.text,
    translation.language,
    transcribeMode,
    feedback,
    tChat,
  ]);

  // "Also correct?" exists to dispute an answer the diff marked wrong, at a
  // displayed 100% there is nothing to dispute, so the button is noise.
  // `isPerfectAnswer` reads the same pair the accuracy footer shows
  // (including the ignore-punctuation setting), so button and label can't
  // disagree.
  const isPerfectAnswer =
    closest !== null &&
    (ignorePunctuation
      ? closest.pair.withoutPunctuation
      : closest.pair.withPunctuation) >= 100;

  // The coach card carries its own "Discuss in detail" button; the standalone
  // link only remains for rows without feedback (off, errored, or over quota).
  const feedbackHandled =
    feedback?.status === 'pending' ||
    (feedback?.status === 'done' && feedback.result?.verdict !== 'error');

  const discussButton =
    hasUserText && chatContext && !isPerfectAnswer && !feedbackHandled ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto px-2 py-1 text-xs text-primary"
        data-testid="discuss-answer-button"
        onClick={handleDiscuss}
      >
        {tChat('discuss.label')}
      </Button>
    ) : null;

  // Kept in the sentence column (under the text/diff, above accuracy) so
  // the action buttons and coach card can't push it down the card.
  const annotations = (
    <AnnotationLines
      romanization={translation.romanization}
      ipa={translation.ipa}
      showRomanization={showRomanization}
      showIpa={showIpa}
    />
  );

  if (allRevealed && !state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget
          ? { 'data-tutorial': TUTORIAL_ANCHORS.targetInputFull }
          : {})}
      >
        <TargetRowHeader
          languageDisplayName={languageDisplayName}
          audioUrl={audioUrl}
          language={translation.language}
          onAudioPlay={onAudioPlay}
          onButtonTimeUpdate={onButtonTimeUpdate}
          onButtonStop={onButtonStop}
          speed={speed}
          playSignal={playSignal}
          speedOverride={speedOverride}
          generalSpeed={generalSpeed}
          onSpeedCycle={onSpeedCycle}
        />
        {hasUserText ? (
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <DiffDisplay
                expected={translation.text}
                actual={state.userText}
                language={translation.language}
                hideAccuracy={false}
                hideErrors={showClean}
                ignorePunctuation={ignorePunctuation}
                furigana={showFurigana ? translation.furigana : undefined}
                afterText={annotations}
              />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
              <ShowCleanToggle
                showClean={showClean}
                onToggle={() => setShowClean((v) => !v)}
                showCorrectionsLabel={t('showCorrections')}
                showSentenceLabel={t('showSentence')}
              />
              {discussButton}
            </div>
          </div>
        ) : (
          <>
            <ClickableWords
              text={translation.text || '...'}
              language={translation.language}
              wordTimings={wordTimings}
              localTime={activeClip?.localTime ?? 0}
              clockBinding={isActive ? clockBinding : undefined}
              isActive={isActive}
              enabled={highlightEnabled}
              furigana={showFurigana ? translation.furigana : undefined}
              className="body-large text-muted-foreground"
            />
            {annotations}
          </>
        )}
      </div>
    );
  }

  const diffTargetItem = correctedForDiff
    ? (acceptedItems.find((item) => item.text === correctedForDiff) ?? null)
    : null;
  // Annotations follow the sentence the diff is showing: the matched
  // alternative's when the diff targets one, none for an unstored grader
  // correction (its romanization doesn't exist), the card's otherwise.
  const diffAnnotations = correctedForDiff ? (
    diffTargetItem ? (
      <AnnotationLines
        romanization={diffTargetItem.romanization}
        ipa={diffTargetItem.ipa}
        showRomanization={showRomanization}
        showIpa={showIpa}
      />
    ) : null
  ) : (
    annotations
  );

  // The accepted answers the diff is NOT currently showing, listed under the
  // row (each with its own audio + annotations) so the learner sees the
  // card's sentence and their other stored phrasings at a glance.
  const otherAccepted = state.submitted
    ? acceptedItems.filter(
        (item) => item.text !== (correctedForDiff ?? translation.text),
      )
    : [];

  if (state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget
          ? { 'data-tutorial': TUTORIAL_ANCHORS.targetInputFull }
          : {})}
      >
        <TargetRowHeader
          languageDisplayName={languageDisplayName}
          audioUrl={shownAudioUrl}
          language={translation.language}
          onAudioPlay={onAudioPlay}
          onButtonTimeUpdate={onButtonTimeUpdate}
          onButtonStop={onButtonStop}
          speed={speed}
          playSignal={playSignal}
          speedOverride={speedOverride}
          generalSpeed={generalSpeed}
          onSpeedCycle={onSpeedCycle}
          audioTestId="shown-sentence-audio"
        />
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {hasUserText ? (
              <DiffDisplay
                expected={correctedForDiff ?? translation.text}
                actual={state.userText}
                language={translation.language}
                hideAccuracy={false}
                hideErrors={showClean}
                ignorePunctuation={ignorePunctuation}
                furigana={
                  showFurigana
                    ? correctedForDiff
                      ? diffTargetItem?.furigana
                      : translation.furigana
                    : undefined
                }
                afterText={diffAnnotations}
              />
            ) : (
              <>
                <ClickableWords
                  text={translation.text || '...'}
                  language={translation.language}
                  wordTimings={wordTimings}
                  localTime={activeClip?.localTime ?? 0}
                  clockBinding={isActive ? clockBinding : undefined}
                  isActive={isActive}
                  enabled={highlightEnabled}
                  furigana={showFurigana ? translation.furigana : undefined}
                  className="body-large text-muted-foreground"
                />
                {annotations}
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onRevert}
                    className="h-9 w-9 shrink-0"
                    aria-label={revertLabel}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{revertTooltip}</TooltipContent>
              </Tooltip>
              {hasUserText && (
                <ShowCleanToggle
                  showClean={showClean}
                  onToggle={() => setShowClean((v) => !v)}
                  showCorrectionsLabel={t('showCorrections')}
                  showSentenceLabel={t('showSentence')}
                />
              )}
            </div>
            {discussButton}
          </div>
        </div>
        {otherAccepted.length > 0 && (
          <div
            className="flex flex-col gap-1.5 pt-1"
            data-testid="writing-feedback-other-accepted"
          >
            {otherAccepted.map((item) => (
              <div key={item.text} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <ClickableWords
                    text={item.text}
                    language={translation.language}
                    wordTimings={null}
                    localTime={0}
                    isActive={false}
                    enabled={false}
                    furigana={showFurigana ? item.furigana : undefined}
                    className="text-sm text-muted-foreground"
                  />
                  <AnnotationLines
                    romanization={item.romanization}
                    ipa={item.ipa}
                    showRomanization={showRomanization}
                    showIpa={showIpa}
                  />
                </div>
                <div
                  data-testid="accepted-audio"
                  data-audio-url={item.audioUrl ?? ''}
                >
                  <AudioButton
                    url={item.audioUrl ?? null}
                    language={translation.language}
                    onPlay={onAudioPlay}
                    onTimeUpdate={onButtonTimeUpdate}
                    onStop={onButtonStop}
                    speed={speed}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {feedback && hasUserText && (
          <WritingFeedbackCard
            feedback={feedback}
            onDiscuss={chatContext ? handleDiscuss : undefined}
            onTurnOff={onDisableAiFeedback}
            onMakeDefault={
              onMakeDefault &&
              feedback.status === 'done' &&
              feedback.result?.corrected
                ? () =>
                    onMakeDefault(
                      translation.language,
                      feedback.result!.corrected!,
                    )
                : undefined
            }
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-1"
      {...(isFirstTarget
        ? { 'data-tutorial': TUTORIAL_ANCHORS.targetInputFull }
        : {})}
    >
      {firstExposure ? (
        // First exposure: the answer to copy shares the row with its audio
        // button (mirrors the audio-mode target-row layout), the header row
        // would leave the button floating alone above the sentence.
        <>
          {languageDisplayName && (
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
          )}
          <div
            className="flex items-start gap-2"
            data-testid="first-exposure-answer"
          >
            <div className="flex-1 min-w-0">
              <ClickableWords
                text={translation.text || '...'}
                language={translation.language}
                wordTimings={wordTimings}
                localTime={activeClip?.localTime ?? 0}
                clockBinding={isActive ? clockBinding : undefined}
                isActive={isActive}
                enabled={highlightEnabled}
                furigana={showFurigana ? translation.furigana : undefined}
                className="body-large text-muted-foreground"
              />
              {annotations}
            </div>
            <div className="flex items-center">
              <AudioButton
                url={audioUrl}
                language={translation.language}
                onPlay={onAudioPlay}
                onTimeUpdate={onButtonTimeUpdate}
                onStop={onButtonStop}
                speed={speed}
                playSignal={playSignal}
              />
              {onSpeedCycle && (
                <CardSpeedBadge
                  override={speedOverride}
                  generalSpeed={generalSpeed}
                  onCycle={onSpeedCycle}
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <TargetRowHeader
          languageDisplayName={languageDisplayName}
          audioUrl={audioUrl}
          language={translation.language}
          onAudioPlay={onAudioPlay}
          onButtonTimeUpdate={onButtonTimeUpdate}
          onButtonStop={onButtonStop}
          speed={speed}
          playSignal={playSignal}
          speedOverride={speedOverride}
          generalSpeed={generalSpeed}
          onSpeedCycle={onSpeedCycle}
        />
      )}
      <div
        className="flex items-center gap-2"
        {...(isFirstTarget
          ? { 'data-tutorial': TUTORIAL_ANCHORS.targetInputAndSubmit }
          : {})}
      >
        <Input
          ref={inputRef ?? undefined}
          autoFocus={autoFocus}
          value={state.userText}
          onChange={(e) => onInputChange(translation.language, e.target.value)}
          onKeyDown={handleKeyDown}
          {...compositionProps}
          // FSI/PDI-isolate the placeholder: the input's dir follows the
          // target language, but the placeholder is UI-locale text, for RTL
          // targets the bidi algorithm would otherwise drag the trailing
          // "..." to the visual start.
          placeholder={`\u{2068}${placeholder}\u{2069}`}
          lang={inputLang}
          dir={getTextDirection(translation.language)}
          className="flex-1 text-left"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          {...(isFirstTarget
            ? { 'data-testid': 'learn-translation-input' }
            : {})}
        />
        {/* Azure Fast Transcription rejects some locales outright (el-GR,
            sw-TZ — the supportsStt:false languages); rendering the mic there
            would consume a transcription quota unit and then fail every time. */}
        {languageSupportsStt(translation.language) && (
          <WritingVoiceButton
            language={translation.language}
            onTranscript={(text) => {
              // Stop = submit: the transcript fills the input and submits in
              // one gesture. Both land as committed state before the AI
              // feedback kick-off effect reads them. A row the user already
              // submitted by keyboard mid-transcription keeps their answer.
              if (state.submitted) return;
              // An empty transcript (silence, mic picked up nothing) must
              // not submit an empty answer — the card would grade a blank
              // as wrong. Tell the user instead and leave the row open.
              if (!text.trim()) {
                toast.info(tChat('voice.nothingDetected'));
                return;
              }
              primeAfterSubmitAudio();
              onInputChange(translation.language, text);
              onSubmit(translation.language);
            }}
          />
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            primeAfterSubmitAudio();
            onSubmit(translation.language);
          }}
          className="h-9 w-9 shrink-0"
          aria-label={submitLabel}
          {...(isFirstTarget
            ? {
                'data-tutorial': TUTORIAL_ANCHORS.submitAnswer,
                'data-testid': 'learn-submit-translation',
              }
            : {})}
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface TargetRowHeaderProps {
  /** Localized language name, or null when the label row is hidden. */
  languageDisplayName: string | null;
  audioUrl: string | null;
  language: string;
  onAudioPlay?: () => void;
  onButtonTimeUpdate: (language: string, localTime: number) => void;
  onButtonStop: (language: string) => void;
  /** Effective playback speed. */
  speed?: number;
  /** Keyboard replay nonce forwarded to the AudioButton (first target only). */
  playSignal?: number;
  /** Stored override value, or null when none is stored. */
  speedOverride: number | null;
  /** Course-level general speed for this language. */
  generalSpeed: number;
  /** Cycle handler; null clears the override. */
  onSpeedCycle?: (next: number | null) => void;
  /** Optional test id on the header audio wrapper (submitted shown-sentence clip). */
  audioTestId?: string;
}

/** Label + audio-button header row shared by the three TargetLanguageInput branches. */
function TargetRowHeader({
  languageDisplayName,
  audioUrl,
  language,
  onAudioPlay,
  onButtonTimeUpdate,
  onButtonStop,
  speed,
  playSignal,
  speedOverride,
  generalSpeed,
  onSpeedCycle,
  audioTestId,
}: TargetRowHeaderProps) {
  const audio = (
    <div
      className="flex items-center"
      {...(audioTestId
        ? { 'data-testid': audioTestId, 'data-audio-url': audioUrl ?? '' }
        : {})}
    >
      <AudioButton
        url={audioUrl}
        language={language}
        onPlay={onAudioPlay}
        onTimeUpdate={onButtonTimeUpdate}
        onStop={onButtonStop}
        speed={speed}
        playSignal={playSignal}
      />
      {onSpeedCycle && (
        <CardSpeedBadge
          override={speedOverride}
          generalSpeed={generalSpeed}
          onCycle={onSpeedCycle}
        />
      )}
    </div>
  );
  return languageDisplayName ? (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground uppercase">
        {languageDisplayName}
      </span>
      {audio}
    </div>
  ) : (
    <div className="flex justify-end">{audio}</div>
  );
}

/** Toggle between the corrected diff and the clean sentence for a submitted answer. */
function ShowCleanToggle({
  showClean,
  onToggle,
  showCorrectionsLabel,
  showSentenceLabel,
}: {
  showClean: boolean;
  onToggle: () => void;
  showCorrectionsLabel: string;
  showSentenceLabel: string;
}) {
  const label = showClean ? showCorrectionsLabel : showSentenceLabel;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={onToggle}
          className={`h-9 w-9 shrink-0 ${showClean ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
          aria-label={label}
        >
          <FileText className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
