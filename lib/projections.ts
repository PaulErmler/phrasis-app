/**
 * Pure projection engine for the homescreen's rotating long-term motivation
 * indicators, shared between Convex (`convex/features/projections.ts`) and
 * app code (onboarding's WordProjectionStep imports the first-session math
 * from here so onboarding promises and in-app projections can never
 * disagree).
 *
 * Everything here is deterministic on its inputs — no clocks, no I/O.
 */

import { addDays, daysBetween, endOfMonth, endOfYear } from './dateStrings';

// ============================================================================
// Constants
// ============================================================================

/**
 * Long-horizon vocab projections are noisy and unrealistic past a certain
 * point — cap word milestones at a believable ceiling so the UI doesn't
 * promise "you'll know 73,412 words in a year" off a hot week.
 */
export const PROJECTION_CAP_WORDS = 10_000;

/**
 * A user's first session is unrealistically fast (all cards new, warm-up
 * reviews inflate early counts) — dampen first-session extrapolations by
 * this factor. Extracted from onboarding's WordProjectionStep.
 */
export const FIRST_SESSION_DAMPENER = 7;

/**
 * The 'goal' basis rate is all-time words per study-minute — measured over a
 * short lifetime it is just a first-session rate wearing an all-time hat, so
 * it gets the same dampener, faded out linearly as real history accumulates.
 * At or beyond this many minutes of total study the rate is trusted as-is.
 */
export const GOAL_BASIS_FULL_TRUST_MINUTES = 300;

/**
 * The year-end level walk has no natural ceiling the way word indicators have
 * PROJECTION_CAP_WORDS — an inflated pace would happily promise C2.4 to a
 * 15-minute-old account. Cap the projected climb at this many levels above
 * the current one (an ambitious but plausible year).
 */
export const MAX_LEVEL_JUMP_YEAR_END = 4;

/** Pace window: trailing days considered (or course age if younger). */
export const PACE_WINDOW_DAYS = 90;
/** Exponential decay half-life in days (recent days weigh more). */
export const PACE_HALF_LIFE_DAYS = 15;
export const PACE_DECAY = 0.5 ** (1 / PACE_HALF_LIFE_DAYS);

// Anti-demotivation floors: indicators whose numbers would read as "barely
// anything" are suppressed rather than shown small.
export const MIN_GAIN_LONG_HORIZON_WORDS = 100; // endOfYear / oneYear
export const MIN_GAIN_MONTH_WORDS = 20;
export const MIN_GAIN_LONG_HORIZON_SENTENCES = 30;
export const MIN_COUNTERFACTUAL_BOOST = 50;
export const MAX_ETA_DAYS = 365;
export const MIN_CARDS_PER_DAY_FOR_ETA = 0.2;
/** endOfYear needs this many days left in the year, else it duplicates the
 * month indicator (and Dec 20 "by end of year" is bathos). */
export const MIN_DAYS_FOR_YEAR_HORIZON = 45;
export const MIN_DAYS_FOR_MONTH_HORIZON = 5;

export const STUDY_HOUR_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const;

// ============================================================================
// Types
// ============================================================================

export type PaceBasis = 'observed' | 'firstSession' | 'goal' | 'empty';

export interface DailyEntry {
  date: string; // "YYYY-MM-DD"
  value: number;
}

export interface LevelInfo {
  code: string;
  totalTexts: number;
  cardsAdded: number;
  ignoredCount: number;
}

export interface ProjectionInputs {
  today: string;
  /** Whole days since course creation (≥ 1). */
  courseAgeDays: number;
  goalMinutes: number | null;
  currentWords: number;
  /** Total sentences (cards) in the deck. */
  currentSentences: number;
  totalTimeMs: number;
  /** New words learned today (target languages). */
  todayWords: number;
  dailyWords: DailyEntry[];
  dailyNewCards: DailyEntry[];
  dailyMinutes: DailyEntry[];
  /** Ordered premade levels (by `order`), or null when unavailable. */
  levels: LevelInfo[] | null;
  /** Index into `levels` of the active level, -1 when custom/chat is active. */
  activeLevelIndex: number;
}

export type ProjectionIndicator =
  | { kind: 'endOfYearWords'; words: number; capped: boolean; year: string }
  | { kind: 'oneYearWords'; words: number; capped: boolean }
  | { kind: 'endOfMonthWords'; words: number; capped: boolean; monthDate: string }
  | {
      kind: 'counterfactualWords';
      boostedWords: number;
      baselineWords: number;
      capped: boolean;
      horizonDate: string;
    }
  | { kind: 'sessionYield'; words: number; goalMinutes: number }
  | { kind: 'endOfYearSentences'; sentences: number; year: string }
  | { kind: 'sentencesPerHour'; rate: number }
  | {
      kind: 'nextLevel';
      currentCode: string;
      nextCode: string | null;
      etaDays: number;
      etaDate: string;
    }
  | { kind: 'levelByYearEnd'; code: string; year: string }
  | { kind: 'nextWordMilestone'; milestone: number; etaDays: number; etaDate: string }
  | { kind: 'studyTimeMilestone'; hours: number; etaDays: number; etaDate: string }
  | { kind: 'empty' };

export interface ProjectionResult {
  basis: PaceBasis;
  indicators: ProjectionIndicator[];
}

// ============================================================================
// Pace
// ============================================================================

/**
 * Exponentially weighted daily pace over the trailing window. Missing days
 * count as ZERO — a pause honestly craters the pace instead of averaging
 * only active days. The denominator is truncated at the course age so a
 * 3-day-old account isn't diluted by phantom empty days.
 */
export function decayedDailyPace(
  entries: DailyEntry[],
  today: string,
  courseAgeDays: number,
): number {
  const byDate = new Map<string, number>();
  for (const e of entries) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.value);

  let numerator = 0;
  for (let d = 0; d < PACE_WINDOW_DAYS; d++) {
    const v = byDate.get(addDays(today, -d)) ?? 0;
    if (v !== 0) numerator += v * PACE_DECAY ** d;
  }
  const effectiveDays = Math.min(PACE_WINDOW_DAYS, Math.max(1, courseAgeDays));
  let denominator = 0;
  for (let d = 0; d < effectiveDays; d++) denominator += PACE_DECAY ** d;
  return numerator / denominator;
}

/**
 * Unrounded dampened first-session pace in words/day. Kept fractional on
 * purpose: rounding here would floor a slow first session (e.g. 2 words in
 * 12 min at a 5-min goal ≈ 0.12 words/day) to 0 and blank the projections,
 * or inflate 1.5 → 2 and overstate a year by ~33%. Round only for display.
 */
export function firstSessionDailyRate(
  newWords: number,
  sessionMinutes: number,
  dailyTimeGoalMinutes: number,
): number {
  if (sessionMinutes <= 0) return 0;
  const wordsPerMin = newWords / sessionMinutes;
  return (wordsPerMin * dailyTimeGoalMinutes) / FIRST_SESSION_DAMPENER;
}

/**
 * First-session extrapolation — same rounded-total contract onboarding's
 * WordProjectionStep has always shown, layered over the shared rate above
 * so both surfaces promise the same numbers.
 */
export function projectFirstSession(
  newWords: number,
  sessionMinutes: number,
  dailyTimeGoalMinutes: number,
  days: number,
): number {
  const rate = firstSessionDailyRate(newWords, sessionMinutes, dailyTimeGoalMinutes);
  return Math.min(PROJECTION_CAP_WORDS, Math.round(rate * days));
}

/** Round to a friendly precision so "~" stays honest: <100 → 5s, <1000 → 10s, else 50s. */
export function roundFriendly(n: number): number {
  const step = n < 100 ? 5 : n < 1000 ? 10 : 50;
  return Math.round(n / step) * step;
}

const sum = (entries: DailyEntry[]) =>
  entries.reduce((acc, e) => acc + e.value, 0);

/** ceil with a float-noise guard so 46/5·… ≈ 10.0000000002 stays 10 days. */
const ceilDays = (x: number) => Math.ceil(x - 1e-9);

// ============================================================================
// Indicator engine
// ============================================================================

export function computeIndicators(inputs: ProjectionInputs): ProjectionResult {
  const {
    today,
    courseAgeDays,
    goalMinutes,
    currentWords,
    currentSentences,
    totalTimeMs,
    todayWords,
    dailyWords,
    dailyNewCards,
    dailyMinutes,
    levels,
    activeLevelIndex,
  } = inputs;

  const windowWords = sum(dailyWords);
  const windowCards = sum(dailyNewCards);
  const windowMinutes = sum(dailyMinutes);
  const activeDays = new Set(
    dailyMinutes.filter((e) => e.value > 0).map((e) => e.date),
  ).size;

  // ---- basis ladder --------------------------------------------------------
  let basis: PaceBasis;
  let wordsPerDay: number;
  let cardsPerDay: number;
  let minutesPerDay: number;
  /** Words per study-minute, from the user's own history. */
  let wordsPerMinute: number;

  if (activeDays >= 3) {
    basis = 'observed';
    wordsPerDay = decayedDailyPace(dailyWords, today, courseAgeDays);
    cardsPerDay = decayedDailyPace(dailyNewCards, today, courseAgeDays);
    minutesPerDay = decayedDailyPace(dailyMinutes, today, courseAgeDays);
    wordsPerMinute = windowWords / Math.max(windowMinutes, 5);
  } else if (activeDays >= 1 && windowMinutes > 0) {
    // Fresh account: dampened first-session extrapolation (matches the
    // numbers onboarding just promised).
    basis = 'firstSession';
    // Average ACTUAL study time per active day — not the daily goal. A user
    // who studies 17 minutes against a 5-minute goal would otherwise see
    // their pace cut 3.5× by the goal scaling on top of the ÷7 dampener,
    // compounding into a day-one level ETA (~4 months for a level their
    // real throughput clears in days) that reads as broken next to the
    // day's own stats.
    const minutesPerActiveDay = windowMinutes / activeDays;
    // Unrounded rates — see firstSessionDailyRate for why rounding a
    // per-day pace here would zero out slow sessions or overstate fast ones.
    wordsPerDay = Math.min(
      PROJECTION_CAP_WORDS,
      firstSessionDailyRate(windowWords, windowMinutes, minutesPerActiveDay),
    );
    cardsPerDay =
      windowCards <= 0
        ? 0
        : Math.min(
            PROJECTION_CAP_WORDS,
            firstSessionDailyRate(windowCards, windowMinutes, minutesPerActiveDay),
          );
    minutesPerDay = minutesPerActiveDay;
    wordsPerMinute = windowWords / Math.max(windowMinutes, 5) / FIRST_SESSION_DAMPENER;
  } else if (currentWords > 0 && totalTimeMs > 60_000 && goalMinutes != null) {
    // Long pause: no recent activity, but real all-time history. Frame
    // everything as goal-conditional ("if you hit your goal daily…").
    // An all-time rate measured over a short lifetime is as inflated as a
    // first session (all cards new, warm-up reviews), so it gets the same
    // dampener, fading to 1 as history approaches full trust — without this,
    // a user who studied 15 minutes and stopped lands here once the pace
    // window empties and is promised thousands of words a year.
    basis = 'goal';
    const totalMinutes = totalTimeMs / 60_000;
    const trust = Math.min(1, totalMinutes / GOAL_BASIS_FULL_TRUST_MINUTES);
    const dampener = FIRST_SESSION_DAMPENER - (FIRST_SESSION_DAMPENER - 1) * trust;
    const allTimeWpm = currentWords / totalMinutes / dampener;
    wordsPerDay = allTimeWpm * goalMinutes;
    cardsPerDay = (currentSentences / totalMinutes / dampener) * goalMinutes;
    minutesPerDay = goalMinutes;
    wordsPerMinute = allTimeWpm;
  } else {
    return { basis: 'empty', indicators: [{ kind: 'empty' }] };
  }

  const indicators: ProjectionIndicator[] = [];
  // The ceiling applies to the projected GAIN, not the total. Capping the
  // total showed anyone who already knows more than PROJECTION_CAP_WORDS a
  // "target" BELOW their current count (12,000 known → "~10,000 by end of
  // August"), while the uncapped nextWordMilestone simultaneously promised
  // 13,000. The cap exists to stop the extrapolation running away, which is a
  // property of how much is added — not of where the user started.
  const wordCeiling = currentWords + PROJECTION_CAP_WORDS;
  const cap = (raw: number) => roundFriendly(Math.min(wordCeiling, raw));
  const isCapped = (raw: number) => raw >= wordCeiling;

  const yearEndDate = endOfYear(today);
  const daysToYearEnd = daysBetween(today, yearEndDate);
  const monthEndDate = endOfMonth(today);
  const daysToMonthEnd = daysBetween(today, monthEndDate);
  const year = today.slice(0, 4);

  // ---- words ---------------------------------------------------------------
  if (wordsPerDay > 0) {
    const eoyRaw = currentWords + wordsPerDay * daysToYearEnd;
    if (
      daysToYearEnd >= MIN_DAYS_FOR_YEAR_HORIZON &&
      eoyRaw - currentWords >= MIN_GAIN_LONG_HORIZON_WORDS
    ) {
      indicators.push({
        kind: 'endOfYearWords',
        words: cap(eoyRaw),
        capped: isCapped(eoyRaw),
        year,
      });
    }

    const oneYearRaw = currentWords + wordsPerDay * 365;
    if (oneYearRaw - currentWords >= MIN_GAIN_LONG_HORIZON_WORDS) {
      indicators.push({
        kind: 'oneYearWords',
        words: cap(oneYearRaw),
        capped: isCapped(oneYearRaw),
      });
    }

    const eomRaw = currentWords + wordsPerDay * daysToMonthEnd;
    if (
      daysToMonthEnd >= MIN_DAYS_FOR_MONTH_HORIZON &&
      eomRaw - currentWords >= MIN_GAIN_MONTH_WORDS
    ) {
      indicators.push({
        kind: 'endOfMonthWords',
        words: cap(eomRaw),
        capped: isCapped(eomRaw),
        monthDate: monthEndDate,
      });
    }
  }

  // Counterfactual "if every day were like today" — positive-only, observed
  // basis only (a goal/firstSession baseline makes the comparison unfair).
  if (basis === 'observed' && todayWords >= Math.max(5, 1.25 * wordsPerDay)) {
    const horizonDate =
      daysToYearEnd >= MIN_DAYS_FOR_YEAR_HORIZON
        ? yearEndDate
        : addDays(today, 90);
    const horizonDays = daysBetween(today, horizonDate);
    const boostedRaw = currentWords + todayWords * horizonDays;
    const baselineRaw = currentWords + wordsPerDay * horizonDays;
    const boosted = cap(boostedRaw);
    const baseline = cap(baselineRaw);
    if (boosted - baseline >= MIN_COUNTERFACTUAL_BOOST) {
      indicators.push({
        kind: 'counterfactualWords',
        boostedWords: boosted,
        baselineWords: baseline,
        capped: isCapped(boostedRaw),
        horizonDate,
      });
    }
  }

  // "+X words per Y-min session" — what one goal-length session yields.
  if (goalMinutes != null && goalMinutes > 0 && wordsPerMinute > 0) {
    const words = Math.round(wordsPerMinute * goalMinutes);
    if (words >= 1) {
      indicators.push({ kind: 'sessionYield', words, goalMinutes });
    }
  }

  // ---- sentences -----------------------------------------------------------
  if (cardsPerDay > 0) {
    const eoySentencesRaw = currentSentences + cardsPerDay * daysToYearEnd;
    if (
      daysToYearEnd >= MIN_DAYS_FOR_YEAR_HORIZON &&
      eoySentencesRaw - currentSentences >= MIN_GAIN_LONG_HORIZON_SENTENCES
    ) {
      indicators.push({
        kind: 'endOfYearSentences',
        sentences: roundFriendly(eoySentencesRaw),
        year,
      });
    }
  }

  // Present-tense efficiency: sentences per study-hour over the window.
  // Observed basis only (needs ≥1h of real recent study).
  if (basis === 'observed' && windowMinutes >= 60 && windowCards > 0) {
    const rate = windowCards / (windowMinutes / 60);
    if (rate >= 1) {
      indicators.push({ kind: 'sentencesPerHour', rate: Math.round(rate) });
    }
  }

  // ---- levels & milestones -------------------------------------------------
  const remainingOf = (l: LevelInfo) =>
    Math.max(0, l.totalTexts - l.cardsAdded - l.ignoredCount);

  if (
    levels != null &&
    activeLevelIndex >= 0 &&
    cardsPerDay >= MIN_CARDS_PER_DAY_FOR_ETA
  ) {
    const active = levels[activeLevelIndex];
    const remaining = remainingOf(active);
    if (remaining > 0) {
      const etaDays = ceilDays(remaining / cardsPerDay);
      if (etaDays <= MAX_ETA_DAYS) {
        indicators.push({
          kind: 'nextLevel',
          currentCode: active.code,
          nextCode: levels[activeLevelIndex + 1]?.code ?? null,
          etaDays,
          etaDate: addDays(today, etaDays),
        });
      }
    }

    // Walk the level ladder with the year's remaining card budget, capped at
    // MAX_LEVEL_JUMP_YEAR_END steps — the word indicators have
    // PROJECTION_CAP_WORDS to keep a hot week honest; this is the level
    // equivalent, so an inflated pace can't promise the top of the ladder.
    if (daysToYearEnd >= MIN_DAYS_FOR_YEAR_HORIZON) {
      let budget = cardsPerDay * daysToYearEnd;
      let idx = activeLevelIndex;
      const maxIdx = Math.min(
        levels.length - 1,
        activeLevelIndex + MAX_LEVEL_JUMP_YEAR_END,
      );
      while (idx < maxIdx && budget >= remainingOf(levels[idx])) {
        budget -= remainingOf(levels[idx]);
        idx++;
      }
      if (idx > activeLevelIndex) {
        indicators.push({ kind: 'levelByYearEnd', code: levels[idx].code, year });
      }
    }
  }

  if (wordsPerDay > 0 && currentWords >= 0) {
    const milestone = Math.max(1000, Math.ceil((currentWords + 1) / 1000) * 1000);
    const etaDays = ceilDays((milestone - currentWords) / wordsPerDay);
    if (etaDays >= 1 && etaDays <= MAX_ETA_DAYS) {
      indicators.push({
        kind: 'nextWordMilestone',
        milestone,
        etaDays,
        etaDate: addDays(today, etaDays),
      });
    }
  }

  if (minutesPerDay > 0) {
    const currentHours = totalTimeMs / 3_600_000;
    const nextMilestone = STUDY_HOUR_MILESTONES.find((h) => h > currentHours);
    if (nextMilestone != null) {
      const etaDays = ceilDays(
        ((nextMilestone - currentHours) * 60) / minutesPerDay,
      );
      if (etaDays >= 1 && etaDays <= MAX_ETA_DAYS) {
        indicators.push({
          kind: 'studyTimeMilestone',
          hours: nextMilestone,
          etaDays,
          etaDate: addDays(today, etaDays),
        });
      }
    }
  }

  if (indicators.length === 0) {
    return { basis, indicators: [{ kind: 'empty' }] };
  }
  return { basis, indicators };
}
