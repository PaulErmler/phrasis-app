'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { BookOpen, ChevronRight, Clock, Pause, Play, RotateCcw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { useNowMinute } from '@/hooks/use-now-minute';
import { formatTimeMs } from '@/lib/formatTime';
import { getLanguageByCode } from '@/lib/languages';
import { getUserTimezone } from '@/lib/timezone';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConfettiBurst } from '@/components/effects/ConfettiBurst';
import {
  PROGRESS_DISPLAY_DURATION_MS,
  PROGRESS_SOUND_URL,
} from '@/lib/constants/learning';
import {
  setupMediaSession,
  setMediaSessionPlaybackState,
} from '@/lib/audio/mediaSession';
import {
  formatCappedCount,
  mergedDueCount,
  REVIEWS_CAP,
} from '@/lib/constants/dueCounts';

type CardCounts = {
  new: number;
  learning: number;
  relearning: number;
  review: number;
  /** Writing-seed still filling the writing aggregates. Counts are a partial
   * prefix, not settled numbers. See countDueCardsByState in stats.ts. */
  preparingWriting?: boolean;
};

type LearnedWord = { language: string; display: string };

interface ProgressDisplayProps {
  sessionId: string;
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
  /** Auto-advance + auto-advance bar are audio-mode only. */
  reviewMode: 'audio' | 'full';
  /** Mirrors `courseSettings.autoAdvance`. Even in audio mode, the
   * celebration only auto-dismisses when the user has auto-advance on. */
  autoAdvance: boolean;
  onContinue: () => void;
  /**
   * True once the milestone-triggering mutation has resolved. While false,
   * the shell shows an empty placeholder, no audio, no animations, no
   * auto-advance bar.
   */
  ready?: boolean;
}

const NEW_WORDS_CAP = 200;

/**
 * Capped "+N[+]" new-words counter. `displayed` is the value actually shown
 * (possibly mid-animation, already clamped to NEW_WORDS_CAP); the trailing
 * "+" appears only when the true value exceeds the cap AND the displayed
 * value has reached it, so an animating counter gains its "+" on the final
 * tick, not before.
 */
function formatCappedNewWords(displayed: number, trueValue: number): string {
  const overflow =
    trueValue > NEW_WORDS_CAP && displayed >= NEW_WORDS_CAP ? '+' : '';
  return `+${displayed}${overflow}`;
}

// Counter timing tuned to the bundled audio file (progress-success.mp3 ≈ 3.4s).
// Hero lands ~700 ms before the audio finishes; supporting cells finish a hair
// earlier so the eye lands on the hero as the "final" beat of the swell.
const COUNTER_DELAY_MS = 320;
const COUNTER_DURATION_MS = 1850; // hero — finishes well before the audio ends
const SUB_COUNTER_DURATION_MS = 1400; // 450 ms shorter so hero finishes last

// Audio peaks (5 ms RMS-window analysis of progress-success.mp3): the last
// three "click" peaks land at 1290 ms, 1610 ms, and 1925 ms. The hero
// counter's final three integer ticks align with these so each click pairs
// with a visible increment.
const AUDIO_PEAK_3RD_LAST_MS = 1290;
const AUDIO_PEAK_2ND_LAST_MS = 1610;
const AUDIO_PEAK_LAST_MS = 1925;

/**
 * Builds the hero counter's easing function so the last three integer ticks
 * land on the last three peaks of the success audio.
 *
 *   N≥3 → ticks (N-2)/(N-1)/N land at t3/t2/t1; ticks 1..N-3 ramp in with ease-out cubic.
 *   N=2 → align last 2 ticks to the later 2 peaks (1610, 1925)
 *   N=1 → align the single tick to the last peak
 *   N≤0 → plain ease-out cubic (no ticks happen anyway)
 */
function buildHeroEasing(N: number): (t: number) => number {
  const t3 = (AUDIO_PEAK_3RD_LAST_MS - COUNTER_DELAY_MS) / COUNTER_DURATION_MS;
  const t2 = (AUDIO_PEAK_2ND_LAST_MS - COUNTER_DELAY_MS) / COUNTER_DURATION_MS;
  const t1 = (AUDIO_PEAK_LAST_MS - COUNTER_DELAY_MS) / COUNTER_DURATION_MS;

  // Anchor points within the animation must be in (0, 1) and ordered.
  const anchorsValid = t3 > 0 && t3 < t2 && t2 < t1 && t1 < 1;
  if (!anchorsValid || N <= 0) {
    return (t) => 1 - Math.pow(1 - t, 3);
  }

  if (N >= 3) {
    // Three-anchor: ticks N-2, N-1, N land at t3, t2, t1.
    const v3 = (N - 2.5) / N; // first crossing displays N-2
    const v2 = (N - 1.5) / N; // first crossing displays N-1
    const v1 = (N - 0.5) / N; // first crossing displays N
    return (t) => {
      if (t < t3) {
        const local = t / t3;
        const eased = 1 - Math.pow(1 - local, 3);
        return eased * v3;
      }
      if (t < t2) return v3 + ((t - t3) / (t2 - t3)) * (v2 - v3);
      if (t < t1) return v2 + ((t - t2) / (t1 - t2)) * (v1 - v2);
      return v1 + ((t - t1) / (1 - t1)) * (1 - v1);
    };
  }

  if (N === 2) {
    // Two-anchor: ticks 1 and 2 land at t2 and t1.
    const v2 = 0.25; // (N-1.5)/N = 0.25
    const v1 = 0.75; // (N-0.5)/N = 0.75
    return (t) => {
      if (t < t2) {
        const local = t / t2;
        const eased = 1 - Math.pow(1 - local, 3);
        return eased * v2;
      }
      if (t < t1) return v2 + ((t - t2) / (t1 - t2)) * (v1 - v2);
      return v1 + ((t - t1) / (1 - t1)) * (1 - v1);
    };
  }

  // N === 1: single tick at the last peak.
  const v1 = 0.5;
  return (t) => {
    if (t < t1) {
      const local = t / t1;
      const eased = 1 - Math.pow(1 - local, 3);
      return eased * v1;
    }
    return v1 + ((t - t1) / (1 - t1)) * (1 - v1);
  };
}

// Module-level guard against future regressions of the duplicate-mount bug
// fixed by the LearningChatLayout dedup. Dev-only. Production stays silent.
// If a layout change reintroduces double-mount (e.g. children rendered in
// two tree positions, or LearningMode mounted twice), this fires at mount
// time with a stack trace pointing at the offending caller.
const mountedInstances = new Set<number>();
let nextInstanceId = 0;

function useDuplicateMountGuard() {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = nextInstanceId++;
  useEffect(() => {
    const id = idRef.current!;
    mountedInstances.add(id);
    if (process.env.NODE_ENV !== 'production' && mountedInstances.size > 1) {
      console.error(
        '[ProgressDisplay] multiple instances mounted simultaneously — ' +
          'the LearningChatLayout dedup invariant has regressed. ' +
          `Instance count: ${mountedInstances.size}`,
      );
    }
    return () => {
      mountedInstances.delete(id);
    };
  }, []);
}

/**
 * Outer shell: holds an empty placeholder until the milestone mutation has
 * resolved AND the celebration's queries have returned. Only then does
 * CelebrationContent mount, so the success sound, the 5-second
 * auto-advance bar, and the counter animations all start together, against
 * fresh post-mutation data.
 */
export function ProgressDisplay(props: ProgressDisplayProps) {
  useDuplicateMountGuard();
  const { ready = true } = props;
  // Resolve user's IANA zone once per mount; it's a constant for the runtime.
  const timezone = useMemo(() => getUserTimezone(), []);
  // Minute-stable `now` per the no-wall-clock query guideline; the re-subscribe
  // gap on a minute tick is bridged by the lastCardCountsRef cache below.
  const now = useNowMinute();
  const userSettings = useQuery(api.features.courses.getUserSettings);
  const hideDueCounts = userSettings?.hideDueCounts === true;
  const cardCountsQuery = useQuery(
    api.features.stats.getCardCounts,
    hideDueCounts ? 'skip' : { now },
  );
  const celebrationWordsQuery = useQuery(
    api.features.stats.getNewWordsForCelebration,
    { sessionId: props.sessionId, timezone },
  );

  // Cache the most-recent resolved query results so a Convex re-subscription
  // doesn't unmount `CelebrationContent`. Re-subscriptions happen when args
  // change. Most notably when another tab rotates `currentSessionId`
  // (via its own celebration dismiss), which propagates to this tab's
  // `courseSettingsQuery` → flows into `props.sessionId` → forces
  // `celebrationWordsQuery` to re-subscribe. While the new subscription is
  // loading, `useQuery` returns `undefined`. Without the cache the
  // `queriesResolved` gate flips false and `CelebrationContent` unmounts,
  // wiping `isPausedRef` and restarting the 7-second auto-advance clock
  // from 0, i.e. a paused celebration silently resumes.
  const lastCardCountsRef = useRef<CardCounts | null | undefined>(undefined);
  const lastWordsRef = useRef<
    { session: LearnedWord[]; today: LearnedWord[] } | undefined
  >(undefined);
  // Provisional counts (separateModeTracking writing seed still sweeping,
  // `preparingWriting`) are a partial prefix of the writing queue, so showing
  // them would read as a confident "nothing left". Same handling as
  // DueCountsPills: never cache them, and fall back to the last settled counts,
  // or collapse the pills slot (null) if none ever settled.
  const isProvisional = cardCountsQuery?.preparingWriting === true;
  if (cardCountsQuery !== undefined && !isProvisional)
    lastCardCountsRef.current = cardCountsQuery;
  if (celebrationWordsQuery !== undefined) lastWordsRef.current = celebrationWordsQuery;

  const effectiveCardCounts = hideDueCounts
    ? null
    : cardCountsQuery !== undefined
      ? isProvisional
        ? lastCardCountsRef.current ?? null
        : cardCountsQuery
      : lastCardCountsRef.current;
  const effectiveWords =
    celebrationWordsQuery !== undefined
      ? celebrationWordsQuery
      : lastWordsRef.current;

  // `getCardCounts` returns `null` for unauthenticated / no-active-deck users.
  // That's a resolved value too (we just won't render the pills). When the
  // user hides due counts we skip that query entirely and treat counts as
  // resolved-null so the celebration doesn't wait on a number we won't show.
  const queriesResolved =
    (hideDueCounts || effectiveCardCounts !== undefined) &&
    effectiveWords !== undefined;

  if (!ready || !queriesResolved) {
    // Empty placeholder of identical size, no sound, no bar movement,
    // no counter ticking. Once both gates flip, CelebrationContent mounts
    // fresh and starts everything from t=0.
    return <div className="h-full" />;
  }

  return (
    <CelebrationContent
      {...props}
      cardCounts={effectiveCardCounts ?? null}
      sessionWordsList={effectiveWords.session}
      todayWordsList={effectiveWords.today}
    />
  );
}

function CelebrationContent({
  dailyReviewsToday,
  dailyTimeMsToday,
  dailyNewWordsToday,
  reviewMode,
  autoAdvance,
  onContinue,
  cardCounts,
  sessionWordsList,
  todayWordsList,
}: Omit<ProgressDisplayProps, 'sessionId' | 'ready'> & {
  cardCounts: CardCounts | null;
  sessionWordsList: LearnedWord[];
  todayWordsList: LearnedWord[];
}) {
  const t = useTranslations('LearningMode.progressDisplay');

  // Per-language counts for this session, derived from the celebration word
  // list (every userWords row is unique per (language, normalized word) so
  // length == count). Sorted desc.
  const sessionWordCounts = useMemo(() => {
    const perLang = new Map<string, number>();
    for (const w of sessionWordsList) {
      perLang.set(w.language, (perLang.get(w.language) ?? 0) + 1);
    }
    return {
      total: sessionWordsList.length,
      perLanguage: [...perLang.entries()]
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [sessionWordsList]);

  // Hero metric selection: session new-words → today's new-words → today's
  // review count. The review-count fallback ensures users with no new
  // vocab still get a positive hero number.
  const hero = useMemo(() => {
    if (sessionWordCounts.total > 0) {
      return { kind: 'sessionNew' as const, value: sessionWordCounts.total };
    }
    if (dailyNewWordsToday > 0) {
      return { kind: 'todayNew' as const, value: dailyNewWordsToday };
    }
    return { kind: 'reviewsToday' as const, value: dailyReviewsToday };
  }, [sessionWordCounts.total, dailyNewWordsToday, dailyReviewsToday]);

  // For "new words" hero kinds, clamp the animated target so the counter
  // never ticks past the cap. `reviewsToday` is uncapped. Review counts
  // can legitimately reach the hundreds.
  const heroAnimTarget =
    hero.kind === 'reviewsToday' ? hero.value : Math.min(hero.value, NEW_WORDS_CAP);

  // Memoised so the counter doesn't restart on every render.
  const heroEasing = useMemo(() => buildHeroEasing(heroAnimTarget), [heroAnimTarget]);

  const animHero = useAnimatedCounter(heroAnimTarget, 0, COUNTER_DURATION_MS, COUNTER_DELAY_MS, true, heroEasing);
  const animReviews = useAnimatedCounter(dailyReviewsToday, 0, SUB_COUNTER_DURATION_MS, COUNTER_DELAY_MS, true);
  const animTime = useAnimatedCounter(dailyTimeMsToday, 0, SUB_COUNTER_DURATION_MS, COUNTER_DELAY_MS, true);
  const animTodayWords = useAnimatedCounter(
    Math.min(dailyNewWordsToday, NEW_WORDS_CAP),
    0,
    SUB_COUNTER_DURATION_MS,
    COUNTER_DELAY_MS,
    true,
  );

  // ----- Sound + Media Session + Auto-advance (mounts only when ready) -----
  // Pause state. The REF (`isPausedRef`) is the source of truth for any
  // non-React code path. Media session callbacks, audio event listeners,
  // the auto-advance interval. The REACT STATE (`isPaused`) only drives
  // rendering (icon swap). Both are updated synchronously in `pauseSync` /
  // `resumeSync`.
  //
  // Auto-advance mirrors the regular card's pause pattern: the card's
  // "clock" is the audio element itself, and `audio.pause()` freezes the
  // clock so the `ended` event never fires. Here the clock is a single
  // `setInterval` that reads `isPausedRef.current` on every tick, when
  // paused, the tick is a no-op so the accumulated playtime doesn't
  // advance. There is no separate `setTimeout` to race against the pause
  // click; the only way the celebration auto-dismisses is for the tick
  // loop to observe `accumulated >= DURATION`, and that can't happen
  // while pause is held.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onContinueRef = useRef(onContinue);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const mediaSessionTitle = t('mediaSessionTitle');

  useEffect(() => {
    onContinueRef.current = onContinue;
  }, [onContinue]);

  // The celebration only auto-advances when the underlying review flow
  // does (audio mode + the user's `autoAdvance` setting). In every other
  // case, including onboarding's first-lesson recap which passes
  // `autoAdvance={false}`. The screen stays up until the user taps
  // Continue. The play/pause + bar pattern is layered on top of the
  // auto-advancing variant ONLY.
  const celebrationAutoAdvances = reviewMode === 'audio' && autoAdvance;
  const [progressPct, setProgressPct] = useState(0);
  // Accumulated "playing" time. The tick interval reads / writes this
  // ref directly; pause/resume don't touch it. The bar reads `progressPct`,
  // which the tick keeps in sync.
  const accumulatedMsRef = useRef(0);

  const pauseSync = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
    audioRef.current?.pause();
    setMediaSessionPlaybackState('paused');
  }, []);

  const resumeSync = useCallback(() => {
    isPausedRef.current = false;
    setIsPaused(false);
    // Don't resume past natural end. `audio.play()` on an ended element
    // restarts from 0 in some browsers, which we don't want for a one-
    // shot ding. The visual auto-advance interval will keep ticking.
    const audio = audioRef.current;
    if (audio && !audio.ended && audio.currentTime < audio.duration) {
      audio.play().catch(() => {});
    }
    setMediaSessionPlaybackState('playing');
  }, []);

  const togglePause = useCallback(() => {
    if (isPausedRef.current) resumeSync();
    else pauseSync();
  }, [pauseSync, resumeSync]);

  useEffect(() => {
    const audio = new Audio(PROGRESS_SOUND_URL);
    audio.preload = 'auto';
    audioRef.current = audio;
    audio.play().catch(() => {
      // Autoplay may be blocked. Silently ignore; the visual celebration still runs.
    });

    const teardown = setupMediaSession({
      title: mediaSessionTitle,
      artist: 'Flexling',
      onPlay: () => resumeSync(),
      onPause: () => pauseSync(),
      // Guarded against the user's explicit pause: if they paused the
      // celebration, an OS-level / auto-fired `nexttrack` must not
      // dismiss it. The user can still resume + tap the on-screen Next
      // button. `isPausedRef` is updated SYNCHRONOUSLY in `pauseSync`
      // (no useEffect lag), so even a `nexttrack` fired ~1 ms after the
      // pause click observes the correct value.
      onNextTrack: () => {
        if (isPausedRef.current) return;
        onContinueRef.current();
      },
      onPreviousTrack: () => {},
    });
    setMediaSessionPlaybackState('playing');

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
      setMediaSessionPlaybackState('none');
      teardown();
    };
  }, [mediaSessionTitle, pauseSync, resumeSync]);

  // Single ticking clock. On every tick: bank the wall-clock delta since
  // the last tick into `accumulatedMsRef`, unless paused, in which case
  // the tick is a no-op (`lastTickAt` advances so the next active tick
  // doesn't retroactively credit the paused interval). When accumulated
  // playtime reaches DURATION, dismiss. No separate timeout exists, so
  // pause is "free": flipping `isPausedRef.current` halts the clock with
  // no clearTimeout needed.
  useEffect(() => {
    if (!celebrationAutoAdvances) return;

    let lastTickAt = Date.now();
    const tickId = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickAt;
      lastTickAt = now;

      if (isPausedRef.current) return;

      const next = Math.min(
        PROGRESS_DISPLAY_DURATION_MS,
        accumulatedMsRef.current + delta,
      );
      accumulatedMsRef.current = next;
      setProgressPct((next / PROGRESS_DISPLAY_DURATION_MS) * 100);

      if (next >= PROGRESS_DISPLAY_DURATION_MS) {
        clearInterval(tickId);
        onContinueRef.current();
      }
    }, 50);

    return () => clearInterval(tickId);
  }, [celebrationAutoAdvances]);

  // ----- Confetti burst on the final ding -----
  // Fires once at the moment of the last hero integer tick. Aligned to the
  // last audio peak so the burst lands with the click.
  const [confettiBurst, setConfettiBurst] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setConfettiBurst(true), AUDIO_PEAK_LAST_MS);
    return () => clearTimeout(timer);
  }, []);

  const showPerLanguagePills =
    hero.kind === 'sessionNew' && sessionWordCounts.perLanguage.length > 1;

  const heroDisplay =
    hero.kind === 'reviewsToday'
      ? animHero.toLocaleString()
      : formatCappedNewWords(animHero, hero.value);

  return (
    <div
      className="h-full flex flex-col items-stretch px-4 py-6 gap-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('continue')}
    >
      <motion.div
        className="flex-1 flex flex-col items-center justify-center gap-6"
        initial="hidden"
        animate="visible"
        variants={CONTAINER_VARIANTS}
      >
        {/* Hero metric */}
        <motion.div
          className="flex flex-col items-center gap-2 text-center"
          variants={CHILD_VARIANTS}
        >
          <div className="relative">
            <p className="text-6xl font-bold tabular-nums text-primary leading-none">
              {heroDisplay}
            </p>
            {confettiBurst && <ConfettiBurst />}
          </div>
          <p className="text-sm text-muted-foreground">
            {hero.kind === 'sessionNew'
              ? t('sessionNewWords')
              : hero.kind === 'todayNew'
                ? t('todayNewWords')
                : t('reviewsTodayHero')}
          </p>

          {/* Per-language flags. Fixed-height slot keeps layout stable. */}
          <div className="mt-2 min-h-[1.25rem] flex items-center">
            {showPerLanguagePills && (
              <div
                className="flex flex-wrap justify-center"
                style={{ rowGap: '0.25rem', columnGap: '1rem' }}
              >
                {sessionWordCounts.perLanguage.map((lw) => {
                  const lang = getLanguageByCode(lw.language);
                  return (
                    <span
                      key={lw.language}
                      className="inline-flex items-center text-sm tabular-nums whitespace-nowrap"
                      aria-label={`${lang?.name ?? lw.language}: ${lw.count}`}
                    >
                      <span aria-hidden>{lang?.flag ?? '🌐'}</span>
                      <span aria-hidden>
                        {formatCappedNewWords(
                          Math.min(lw.count, NEW_WORDS_CAP),
                          lw.count,
                        )}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* Always-shown stats row */}
        <motion.div
          className="card-surface p-4 w-full max-w-sm"
          variants={CHILD_VARIANTS}
        >
          <div className="grid grid-cols-3 gap-4">
            <StatCell
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label={t('reviewsToday')}
              value={animReviews.toLocaleString()}
            />
            <StatCell
              icon={<Clock className="h-3.5 w-3.5" />}
              label={t('timeToday')}
              value={formatTimeMs(animTime)}
            />
            <StatCell
              icon={<BookOpen className="h-3.5 w-3.5" />}
              label={t('newWordsToday')}
              value={formatCappedNewWords(animTodayWords, dailyNewWordsToday)}
            />
          </div>
        </motion.div>

        {/* Word display. Between the stats row and the state pills. Skipped
            entirely when there are no words to celebrate. */}
        {(sessionWordsList.length > 0 || todayWordsList.length > 0) && (
          <motion.div className="w-full max-w-sm" variants={CHILD_VARIANTS}>
            <p className="text-muted-xs text-center mb-1.5">Words you learned</p>
            <WordsMultilineTicker
              sessionWords={sessionWordsList}
              todayWords={todayWordsList}
            />
          </motion.div>
        )}

        {/* New vs review pills. Shown when we have card counts. The slot
            collapses entirely when counts are unavailable (no active deck). */}
        {cardCounts && (
          <motion.div
            className="flex flex-col items-center gap-1.5 max-w-sm w-full"
            variants={CHILD_VARIANTS}
          >
            <p className="text-muted-xs">{t('comingUp')}</p>
            <div className="flex justify-center gap-x-4">
              <StatePill
                label={t('stateNew')}
                value={cardCounts.new}
                colorClass="text-accent-orange"
              />
              <StatePill
                label={t('stateReview')}
                value={mergedDueCount(cardCounts)}
                colorClass="text-success"
                cap={REVIEWS_CAP}
              />
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Bottom controls. In auto-advancing mode (main app, audio +
          autoAdvance) we show a pausable progress bar with play/pause +
          next buttons so the user can stop to read the stats and tap
          next to skip. In every other mode. Most importantly
          onboarding's StatsRecapStep. We keep the original full-width
          Continue button so the existing UX is byte-identical. */}
      <motion.div
        className="flex flex-col items-stretch gap-3 max-w-sm w-full mx-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.4, ease: 'easeOut' }}
      >
        {celebrationAutoAdvances ? (
          <>
            <div
              className="bg-primary/20 relative h-1.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-hidden="true"
            >
              <div
                className="bg-primary h-full transition-[width] ease-linear duration-100"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                size="icon"
                onClick={togglePause}
                aria-label={isPaused ? t('resume') : t('pause')}
                className="flex-[2]"
                data-testid="progress-display-play-pause"
              >
                {isPaused ? <Play /> : <Pause />}
              </Button>
              <Button
                variant="default"
                size="lg"
                onClick={onContinue}
                aria-label={t('continue')}
                className="flex-[1]"
                data-testid="progress-display-continue"
              >
                <ChevronRight />
              </Button>
            </div>
          </>
        ) : (
          <Button
            onClick={onContinue}
            variant="default"
            size="lg"
            className="w-full"
            data-testid="progress-display-continue"
          >
            {t('continue')}
          </Button>
        )}
      </motion.div>
    </div>
  );
}

const CONTAINER_VARIANTS = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.04,
    },
  },
};

const CHILD_VARIANTS = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

function StatCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-0.5">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      <p className="text-muted-xs leading-none">{label}</p>
    </div>
  );
}

function StatePill({
  label,
  value,
  colorClass,
  cap,
}: {
  label: string;
  value: number;
  colorClass: string;
  cap?: number;
}) {
  const display = cap != null ? formatCappedCount(value, cap) : String(value);
  // `min-w` enforces label separation. Relying on row-level `gap-x-*` alone
  // is fragile because each pill's intrinsic width tracks its label
  // ("review" ≈ 44 px, "new" ≈ 28 px), so the gap is between label edges
  // not pill centers, and long labels can run together regardless of gap.
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-24">
      <span className={`text-lg font-semibold tabular-nums ${colorClass}`}>{display}</span>
      <span className="text-muted-xs">{label}</span>
    </div>
  );
}

// =====================================================================
// Word display. Multiline ticker (the chosen production variant).
// =====================================================================

interface WordVariantProps {
  sessionWords: LearnedWord[];
  todayWords: LearnedWord[];
}

// Distribute words across up to 3 rows. Each row that has enough words to
// overflow scrolls left-to-right; shorter rows just sit statically. Reads
// like a stack of scrolling banners.
function WordsMultilineTicker({ sessionWords, todayWords }: WordVariantProps) {
  // Flag rendering is gated on having multiple target languages. Single-
  // language users would just see the same flag repeated, which adds clutter
  // without information.
  const showFlags = useMemo(() => {
    const langs = new Set(
      [...sessionWords, ...todayWords].map((w) => w.language),
    );
    return langs.size > 1;
  }, [sessionWords, todayWords]);

  const all = [
    ...sessionWords.map((w) => ({ ...w, tone: 'session' as const })),
    ...todayWords.map((w) => ({ ...w, tone: 'today' as const })),
  ];
  // A new row only opens up after the previous one is "full" (PER_ROW_FILL).
  // Once we commit to N rows, the words are redistributed evenly across them
  // round-robin, rather than packing the first row to capacity and leaving
  // a sparse last row.
  const PER_ROW_FILL = 5;
  const MAX_ROWS = 3;
  const rowCount = Math.min(
    MAX_ROWS,
    Math.max(1, Math.ceil(all.length / PER_ROW_FILL)),
  );
  const rows: typeof all[] = Array.from({ length: rowCount }, () => []);
  all.forEach((w, i) => rows[i % rowCount].push(w));
  // After redistribution a row scrolls only if it actually overflows; the
  // fill threshold doubles as the scroll threshold so the two notions stay
  // consistent.
  const SCROLL_THRESHOLD = PER_ROW_FILL;
  return (
    <div className="space-y-1.5 w-full">
      {rows.map((row, rowIdx) => {
        const shouldScroll = row.length >= SCROLL_THRESHOLD;
        // Alternate scroll direction per row so it doesn't look monolithic.
        const direction = rowIdx % 2 === 0 ? -1 : 1;

        const renderItem = (w: typeof row[number], i: number) => (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1.5 text-sm shrink-0',
              w.tone === 'session'
                ? 'text-primary font-medium'
                : 'text-muted-foreground',
            )}
          >
            {showFlags && (
              <span aria-hidden className="text-xs">
                {getLanguageByCode(w.language)?.flag ?? '🌐'}
              </span>
            )}
            <span>{w.display}</span>
          </span>
        );

        return (
          <div
            key={rowIdx}
            className="relative w-full overflow-hidden rounded-md border bg-muted/20 py-1.5"
          >
            {shouldScroll ? (
              // Canonical seamless marquee (Ryan Mulligan technique):
              // two identical groups laid back-to-back with the inter-item
              // gap baked into each group's trailing padding. The animated
              // wrapper has `w-max` so its width = sum of children, and
              // each group's effective width = `(N items) + (N gaps)`.
              // Translating by -50% therefore lands the second group's
              // first item exactly where the first group's first item was,
              // making the wrap pixel-perfect, no padding on the animated
              // element to throw off the percentage math.
              <motion.div
                className="flex w-max whitespace-nowrap"
                animate={{
                  x: direction === -1 ? ['0%', '-50%'] : ['-50%', '0%'],
                }}
                transition={{
                  // Doubled relative to the previous tuning. The old marquee
                  // animated `-50%` of an `auto`-width container (= parent
                  // width), so it scrolled roughly half a viewport per cycle.
                  // With `w-max` the same `-50%` covers a full per-copy
                  // distance (≈ 2× the viewport for a typical filled row),
                  // so the duration has to scale up to keep the same on-
                  // screen px/sec speed.
                  duration: 28 + rowIdx * 6,
                  ease: 'linear',
                  repeat: Infinity,
                }}
              >
                {([0, 1] as const).map((copyIdx) => (
                  <div
                    key={copyIdx}
                    className="flex shrink-0 gap-3 pr-3"
                    aria-hidden={copyIdx === 1 ? 'true' : undefined}
                  >
                    {row.map(renderItem)}
                  </div>
                ))}
              </motion.div>
            ) : (
              <div className="flex justify-center gap-3 px-2">
                {row.map(renderItem)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
