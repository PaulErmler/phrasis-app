'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { BookOpen, Clock, RotateCcw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { formatTimeMs } from '@/lib/formatTime';
import { getLanguageByCode } from '@/lib/languages';
import { getUserTimezone } from '@/lib/timezone';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PROGRESS_DISPLAY_DURATION_MS } from '@/lib/constants/learning';
import {
  setupMediaSession,
  setMediaSessionPlaybackState,
} from '@/lib/audio/mediaSession';

const SOUND_URL = '/sounds/progress-success.mp3';

type CardCounts = { new: number; learning: number; relearning: number; review: number };

type LearnedWord = { language: string; display: string };

interface ProgressDisplayProps {
  sessionId: string;
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
  practicedWordsThisSession: number;
  schedulingMode: 'learn_new' | 'learnAndReview';
  onContinue: () => void;
  /**
   * True once the milestone-triggering mutation has resolved. While false,
   * the shell shows an empty placeholder — no audio, no animations, no
   * auto-advance bar.
   */
  ready?: boolean;
}

const REVIEWS_CAP = 100;
const NEW_WORDS_CAP = 200;

// Counter timing tuned to the bundled audio file (progress-success.mp3 ≈ 3.4s).
// Hero lands ~700 ms before the audio finishes; supporting cells finish a hair
// earlier so the eye lands on the hero as the "final" beat of the swell.
const COUNTER_DELAY_MS = 320;
const COUNTER_DURATION_MS = 1850; // hero — finishes well before the audio ends
const SUB_COUNTER_DURATION_MS = 1400; // 450 ms shorter so hero finishes last

// Audio peaks (5 ms RMS-window analysis of progress-success.mp3): the last
// three "click" peaks land at 1290 ms, 1610 ms, and 1925 ms. The hero
// counter's final three integer ticks align with these so each click pairs
// with a visible increment. `HERO_TICK_OFFSET_MS` shifts the alignment a hair
// later so the visible tick lands just after the click is heard.
const AUDIO_PEAK_3RD_LAST_MS = 1290;
const AUDIO_PEAK_2ND_LAST_MS = 1610;
const AUDIO_PEAK_LAST_MS = 1925;
const HERO_TICK_OFFSET_MS = 50;

/**
 * Outer shell: holds an empty placeholder until the milestone mutation has
 * resolved AND the celebration's queries have returned. Only then does
 * CelebrationContent mount — so the success sound, the 5-second
 * auto-advance bar, and the counter animations all start together, against
 * fresh post-mutation data.
 */
export function ProgressDisplay(props: ProgressDisplayProps) {
  const { ready = true } = props;
  // Resolve user's IANA zone once per mount; it's a constant for the runtime.
  const timezone = useMemo(() => getUserTimezone(), []);
  const cardCountsQuery = useQuery(api.features.stats.getCardCounts, {});
  const celebrationWordsQuery = useQuery(
    api.features.stats.getNewWordsForCelebration,
    { sessionId: props.sessionId, timezone },
  );

  // `getCardCounts` returns `null` for unauthenticated / no-active-deck users
  // — that's a resolved value too (we just won't render the pills).
  const queriesResolved =
    cardCountsQuery !== undefined && celebrationWordsQuery !== undefined;

  if (!ready || !queriesResolved) {
    // Empty placeholder of identical size — no sound, no bar movement,
    // no counter ticking. Once both gates flip, CelebrationContent mounts
    // fresh and starts everything from t=0.
    return <div className="h-full" />;
  }

  return (
    <CelebrationContent
      {...props}
      cardCounts={cardCountsQuery ?? null}
      sessionWordsList={celebrationWordsQuery.session}
      todayWordsList={celebrationWordsQuery.today}
    />
  );
}

function CelebrationContent({
  dailyReviewsToday,
  dailyTimeMsToday,
  dailyNewWordsToday,
  practicedWordsThisSession,
  schedulingMode,
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
  // length == count). Sorted desc to match the previous `getNewWordsForSession`
  // shape.
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

  // Hero metric selection: session new-words → today's new-words → practiced this session.
  const hero = useMemo(() => {
    if (sessionWordCounts.total > 0) {
      return { kind: 'sessionNew' as const, value: sessionWordCounts.total };
    }
    if (dailyNewWordsToday > 0) {
      return { kind: 'todayNew' as const, value: dailyNewWordsToday };
    }
    return { kind: 'practiced' as const, value: practicedWordsThisSession };
  }, [sessionWordCounts.total, dailyNewWordsToday, practicedWordsThisSession]);

  // For "new words" hero kinds, clamp the animated target so the counter
  // never ticks past the cap. `practiced` is uncapped — the hero text label
  // changes, and a high practiced count is fine.
  const heroAnimTarget =
    hero.kind === 'practiced' ? hero.value : Math.min(hero.value, NEW_WORDS_CAP);
  const heroOverflowed = hero.kind !== 'practiced' && hero.value > NEW_WORDS_CAP;

  // Hero easing aligns the last three integer ticks with the last three peaks
  // of the success audio (1290 / 1610 / 1925 ms). For target N≥3, the
  // (N-2)/(N-1)/N ticks land at the three peaks; ticks 1..N-3 ramp in with
  // ease-out cubic. Falls back gracefully:
  //   N=2  → align last 2 ticks to the later 2 peaks (1610, 1925)
  //   N=1  → align the single tick to the last peak
  //   N≤0  → ease-out cubic (no ticks happen anyway)
  // Memoised so the counter doesn't restart on every render.
  const heroEasing = useMemo(() => {
    const N = heroAnimTarget;
    const t3 =
      (AUDIO_PEAK_3RD_LAST_MS + HERO_TICK_OFFSET_MS - COUNTER_DELAY_MS) / COUNTER_DURATION_MS;
    const t2 =
      (AUDIO_PEAK_2ND_LAST_MS + HERO_TICK_OFFSET_MS - COUNTER_DELAY_MS) / COUNTER_DURATION_MS;
    const t1 =
      (AUDIO_PEAK_LAST_MS + HERO_TICK_OFFSET_MS - COUNTER_DELAY_MS) / COUNTER_DURATION_MS;

    // Anchor points within the animation must be in (0, 1) and ordered.
    const anchorsValid = t3 > 0 && t3 < t2 && t2 < t1 && t1 < 1;
    if (!anchorsValid || N <= 0) {
      return (t: number) => 1 - Math.pow(1 - t, 3);
    }

    if (N >= 3) {
      // Three-anchor: ticks N-2, N-1, N land at t3, t2, t1.
      const v3 = (N - 2.5) / N; // first crossing displays N-2
      const v2 = (N - 1.5) / N; // first crossing displays N-1
      const v1 = (N - 0.5) / N; // first crossing displays N
      return (t: number) => {
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
      return (t: number) => {
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
    return (t: number) => {
      if (t < t1) {
        const local = t / t1;
        const eased = 1 - Math.pow(1 - local, 3);
        return eased * v1;
      }
      return v1 + ((t - t1) / (1 - t1)) * (1 - v1);
    };
  }, [heroAnimTarget]);

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
  const todayWordsOverflowed = dailyNewWordsToday > NEW_WORDS_CAP;

  // ----- Sound + Media Session (mounts only when ready) -----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSessionTitle = t('mediaSessionTitle');
  useEffect(() => {
    const audio = new Audio(SOUND_URL);
    audio.preload = 'auto';
    audioRef.current = audio;
    audio.play().catch(() => {
      // Autoplay may be blocked — silently ignore; the visual celebration still runs.
    });

    const teardown = setupMediaSession({
      title: mediaSessionTitle,
      artist: 'Flexling',
      onPlay: () => audio.play().catch(() => {}),
      onPause: () => audio.pause(),
      onNextTrack: () => onContinue(),
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
  }, [onContinue, mediaSessionTitle]);

  // ----- Auto-advance after 5s -----
  useEffect(() => {
    const timer = setTimeout(onContinue, PROGRESS_DISPLAY_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onContinue]);

  // ----- Confetti burst on the final ding -----
  // Fires once at the moment of the last hero integer tick. Aligned to the
  // last audio peak so the burst lands with the click.
  const [confettiBurst, setConfettiBurst] = useState(false);
  useEffect(() => {
    const fireAt = AUDIO_PEAK_LAST_MS + HERO_TICK_OFFSET_MS;
    const timer = setTimeout(() => setConfettiBurst(true), fireAt);
    return () => clearTimeout(timer);
  }, []);

  const showPerLanguagePills =
    hero.kind === 'sessionNew' && sessionWordCounts.perLanguage.length > 1;

  const heroDisplay =
    hero.kind === 'practiced'
      ? String(animHero)
      : `+${animHero}${heroOverflowed && animHero >= NEW_WORDS_CAP ? '+' : ''}`;

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
                : t('practicedThisSession')}
          </p>

          {/* Per-language flags — fixed-height slot keeps layout stable. */}
          <div className="mt-2 min-h-[1.25rem] flex items-center">
            {showPerLanguagePills && (
              <div
                className="flex flex-wrap justify-center"
                style={{ rowGap: '0.25rem', columnGap: '1rem' }}
              >
                {sessionWordCounts.perLanguage.map((lw) => {
                  const lang = getLanguageByCode(lw.language);
                  const capped = Math.min(lw.count, NEW_WORDS_CAP);
                  const overflow = lw.count > NEW_WORDS_CAP ? '+' : '';
                  return (
                    <span
                      key={lw.language}
                      className="inline-flex items-center text-sm tabular-nums whitespace-nowrap"
                      aria-label={`${lang?.name ?? lw.language}: ${lw.count}`}
                    >
                      <span aria-hidden>{lang?.flag ?? '🌐'}</span>
                      <span aria-hidden>+{capped}{overflow}</span>
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
              value={`+${animTodayWords}${todayWordsOverflowed && animTodayWords >= NEW_WORDS_CAP ? '+' : ''}`}
            />
          </div>
        </motion.div>

        {/* Word display — between the stats row and the state pills. Skipped
            entirely when there are no words to celebrate. */}
        {(sessionWordsList.length > 0 || todayWordsList.length > 0) && (
          <motion.div className="w-full max-w-sm" variants={CHILD_VARIANTS}>
            <WordsMultilineTicker
              sessionWords={sessionWordsList}
              todayWords={todayWordsList}
            />
          </motion.div>
        )}

        {/* Anki-style state pills — shown when we have card counts. The slot
            collapses entirely when counts are unavailable (no active deck). */}
        {cardCounts && (
          <motion.div
            className="flex flex-col items-center gap-1.5 max-w-sm w-full"
            variants={CHILD_VARIANTS}
          >
            <p className="text-muted-xs">{t('comingUp')}</p>
            <div
              className={cn(
                'grid w-full',
                schedulingMode === 'learn_new' ? 'grid-cols-2' : 'grid-cols-3',
              )}
            >
              <StatePill
                label={t('stateNew')}
                value={cardCounts.new}
                colorClass="text-accent-orange"
              />
              <StatePill
                label={t('stateLearning')}
                value={cardCounts.learning + cardCounts.relearning}
                colorClass="text-primary"
              />
              {schedulingMode !== 'learn_new' && (
                <StatePill
                  label={t('stateReview')}
                  value={cardCounts.review}
                  colorClass="text-success"
                  cap={REVIEWS_CAP}
                />
              )}
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Bottom: Continue button + 5s auto-advance bar */}
      <motion.div
        className="flex flex-col items-stretch gap-3 max-w-sm w-full mx-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.4, ease: 'easeOut' }}
      >
        <Button onClick={onContinue} variant="default" size="lg" className="w-full">
          {t('continue')}
        </Button>
        <AutoAdvanceBarInner />
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
  const display = cap != null && value > cap ? `${cap}+` : String(value);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-lg font-semibold tabular-nums ${colorClass}`}>{display}</span>
      <span className="text-muted-xs">{label}</span>
    </div>
  );
}

// =====================================================================
// Confetti — a single radial burst with a "mixed" piece set.
// =====================================================================

const CONFETTI_COLORS = ['var(--primary)', 'var(--accent-orange)', '#fbbf24'];
const BURST_EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

// Deterministic pseudo-random helpers keyed by piece index, so the burst
// looks scattered without using Math.random (which would break SSR).
const r1 = (i: number) => (((i * 7919) % 100) / 100 - 0.5) * 2; // -1..1
const r2 = (i: number) => ((i * 6151) % 100) / 100; // 0..1

function mixedShape(i: number): React.CSSProperties {
  // Cycle through rect / circle / streamer so the burst reads as varied.
  if (i % 3 === 0) return { width: 7, height: 9 };
  if (i % 3 === 1) return { width: 6, height: 6, borderRadius: 999 };
  return { width: 3, height: 14 };
}

function ConfettiBurst() {
  const COUNT = 28;
  const pieces = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const angle = (i / COUNT) * Math.PI * 2 + r1(i) * 0.2;
        const dist = 90 + r2(i) * 70;
        return {
          index: i,
          color: CONFETTI_COLORS[i % 3],
          delay: r2(i) * 0.08,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist + 60,
          rotate: r1(i) * 360,
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      {pieces.map((p) => (
        <motion.span
          key={p.index}
          className="absolute block rounded-sm"
          style={{ ...mixedShape(p.index), backgroundColor: p.color }}
          initial={{ x: 0, y: 0, rotate: 0, scale: 0.4, opacity: 1 }}
          animate={{ x: p.x, y: p.y, rotate: p.rotate, scale: 1, opacity: 0 }}
          transition={{ duration: 1.1, delay: p.delay, ease: BURST_EASE }}
        />
      ))}
    </div>
  );
}

function AutoAdvanceBarInner() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.width = '0%';
    void el.offsetWidth;
    el.style.transition = `width ${PROGRESS_DISPLAY_DURATION_MS}ms linear`;
    el.style.width = '100%';
  }, []);
  return (
    <div
      className="bg-primary/20 relative h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-hidden="true"
    >
      <div ref={ref} className="bg-primary h-full" style={{ width: '0%' }} />
    </div>
  );
}

// =====================================================================
// Word display — multiline ticker (the chosen production variant).
// =====================================================================

interface WordVariantProps {
  sessionWords: LearnedWord[];
  todayWords: LearnedWord[];
}

// Distribute words across up to 3 rows. Each row that has enough words to
// overflow scrolls left-to-right; shorter rows just sit statically. Reads
// like a stack of scrolling banners.
function WordsMultilineTicker({ sessionWords, todayWords }: WordVariantProps) {
  // Flag rendering is gated on having multiple target languages — single-
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
  // round-robin — rather than packing the first row to capacity and leaving
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
        const items = shouldScroll ? [...row, ...row] : row;
        // Alternate scroll direction per row so it doesn't look monolithic.
        const direction = rowIdx % 2 === 0 ? -1 : 1;
        return (
          <div
            key={rowIdx}
            className="relative w-full overflow-hidden rounded-md border bg-muted/20 py-1.5"
          >
            <motion.div
              className={cn(
                'flex gap-3 whitespace-nowrap px-2',
                !shouldScroll && 'justify-center',
              )}
              animate={
                shouldScroll
                  ? { x: direction === -1 ? ['0%', '-50%'] : ['-50%', '0%'] }
                  : undefined
              }
              transition={
                shouldScroll
                  ? {
                    duration: 14 + rowIdx * 3,
                    ease: 'linear',
                    repeat: Infinity,
                  }
                  : undefined
              }
            >
              {items.map((w, i) => (
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
              ))}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
