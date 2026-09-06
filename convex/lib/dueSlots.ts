import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { SchedulingTrack } from '../types';
import {
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DUE_BY_DAY,
  DUE_SLOT_WINDOW_MS,
  type StudyDay,
} from '../../lib/scheduling';
import { isValidTimezone } from './dateUtils';
import { fetchTrackCardAtDue } from './dueQueue';

/** Probes before giving up on a free slot. Each probe is one point lookup on
 * the due index. With 60,000 slots per day, a second collision in a row is
 * already a one-in-hundreds-of-thousands event for any realistic deck. */
const MAX_SLOT_PROBES = 16;

/**
 * The learner's study-day boundary for a review. Undefined when day
 * snapping is off for them or the zone is unusable, and the review then
 * keeps FSRS's exact instant rather than failing. Shared by `reviewCard`
 * and the snap sweep so the two can't disagree on the rule.
 */
export function studyDayFromSettings(
  settings: Pick<Doc<'userSettings'>, 'dueByDay' | 'dayStartHour'> | null,
  timezone: string,
): StudyDay | undefined {
  if ((settings?.dueByDay ?? DEFAULT_DUE_BY_DAY) === false) return undefined;
  if (!isValidTimezone(timezone)) return undefined;
  const hour = settings?.dayStartHour;
  return {
    timezone,
    dayStartHour:
      hour !== undefined && Number.isInteger(hour) && hour >= 0 && hour < 24
        ? hour
        : DEFAULT_DAY_START_HOUR,
  };
}

/**
 * A due date inside `[dayStart, dayStart + DUE_SLOT_WINDOW_MS)` that no other
 * active card of the deck holds on the given track. Null when sixteen
 * consecutive probes were all taken, and callers keep the exact instant.
 *
 * The draw is random within the window, so the order cards come up on the
 * day is random by design. Uniqueness holds by construction. The candidate
 * is checked with a point lookup on the track's due index, and a hit moves
 * the probe forward one millisecond. The index is deck-scoped and the merge
 * in `fetchTrackDueCards` sorts by due date, so a unique slot is what makes
 * "which card is served next" unambiguous. Writes earlier in the same
 * transaction are visible to the lookup, so a batch assigning many slots
 * stays unique too.
 *
 * Only active cards are checked, neither hidden nor mastered. That matches
 * the range every due query reads. A hidden card holding the same instant
 * would need a millisecond-exact match against a random draw.
 */
export async function pickUniqueDueSlot(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  track: SchedulingTrack,
  dayStart: number,
  random: () => number = Math.random,
): Promise<number | null> {
  let slot = dayStart + Math.floor(random() * DUE_SLOT_WINDOW_MS);
  for (let probe = 0; probe < MAX_SLOT_PROBES; probe++) {
    const taken = await fetchTrackCardAtDue(ctx, deckId, track, slot);
    if (!taken) return slot;
    slot += 1;
  }
  return null;
}
