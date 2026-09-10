import { countdownDisplay } from './formatTime';
import { dateInTimezone, daysBetween } from './dateStrings';

/**
 * Below this, the countdown alone answers the question and a clock time would
 * only add noise. Above it, "in 14h 23m" is hard to turn into a decision, so the
 * line also names the wall-clock moment.
 */
const CLOCK_THRESHOLD_MS = 60 * 60 * 1000;

/** How far ahead a weekday name still reads as a date the user can place. */
const WEEKDAY_HORIZON_DAYS = 7;

export type NextReviewLine = {
  /** `LearningMode` message key for the whole line. */
  key:
    | 'nextReview'
    | 'empty.nextReviewToday'
    | 'empty.nextReviewTomorrow'
    | 'empty.nextReviewOn';
  /** The `{time}` value: the relative countdown. */
  time: string;
  /** How the `{clock}` value should be formatted; `null` for `nextReview`. */
  clock: 'time' | 'weekdayTime' | 'dateTime' | null;
  /** ms until this line changes, i.e. when the caller should re-render. */
  staleInMs: number;
};

/**
 * Which "next review in …" line to render, given how long the wait is and where
 * it lands on the user's calendar.
 *
 * Pure so the wording rules are testable without a clock or a React tree: the
 * caller supplies `remainingMs` from its own ticker and formats `{clock}`
 * according to the returned discriminant.
 *
 * Day gaps are counted on local calendar dates, not on raw milliseconds. A
 * 5-hour wait from 23:00 lands "tomorrow", and 20 hours from 06:00 does too.
 */
export function nextReviewLine(
  targetMs: number,
  remainingMs: number,
  timezone: string,
): NextReviewLine {
  const { text, staleInMs } = countdownDisplay(remainingMs);
  if (remainingMs < CLOCK_THRESHOLD_MS) {
    return { key: 'nextReview', time: text, clock: null, staleInMs };
  }

  const nowMs = targetMs - remainingMs;
  const days = daysBetween(
    dateInTimezone(nowMs, timezone),
    dateInTimezone(targetMs, timezone),
  );
  if (days <= 0) {
    return {
      key: 'empty.nextReviewToday',
      time: text,
      clock: 'time',
      staleInMs,
    };
  }
  if (days === 1) {
    return {
      key: 'empty.nextReviewTomorrow',
      time: text,
      clock: 'time',
      staleInMs,
    };
  }
  return {
    key: 'empty.nextReviewOn',
    time: text,
    clock: days < WEEKDAY_HORIZON_DAYS ? 'weekdayTime' : 'dateTime',
    staleInMs,
  };
}
