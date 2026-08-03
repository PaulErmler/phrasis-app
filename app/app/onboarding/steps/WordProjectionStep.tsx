'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BookOpen, CalendarDays, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getUserTimezone } from '@/lib/timezone';
import {
  addDays,
  dateInTimezone,
  daysBetween,
  endOfYear,
} from '@/lib/dateStrings';
import {
  DAILY_TIME_PRESETS,
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
} from '../types';
import { parseCustomGoal } from '@/lib/constants/dailyGoal';
import { GoalPresetTile } from '@/components/app/stats/GoalPresetTile';
import type { OnboardingSessionSummary } from '../components/OnboardingFirstLesson';

// Projection math + cap live in lib/projections.ts, shared with the
// homescreen's rotating projection slot so onboarding promises and in-app
// projections can never disagree.
import {
  MIN_DAYS_FOR_YEAR_HORIZON,
  PROJECTION_CAP_WORDS,
  projectFirstSession as project,
} from '@/lib/projections';

/**
 * Step 11 — "at this pace, here's where you'll be": a vertical timeline from
 * today's session through the next 30 days to Dec 31 (rolled to NEXT year's
 * end when this year's is closer than MIN_DAYS_FOR_YEAR_HORIZON, so a user
 * onboarding on Dec 1, 2026 is promised Dec 31, 2027 — never a 30-day "year"
 * promise). Renders only the projection (the celebration counter + word list
 * are already shown by the previous step).
 */
interface Props {
  summary: OnboardingSessionSummary | null;
  dailyTimeGoalMinutes: number;
  /** Persist a new daily-goal value back to the wizard. The goal picker on
   *  this page lets the user retune their goal after seeing the projection. */
  onDailyTimeChange?: (minutes: number) => void;
  onContinue: () => void;
}

export function WordProjectionStep({
  summary,
  dailyTimeGoalMinutes,
  onDailyTimeChange,
  onContinue,
}: Props) {
  const t = useTranslations('Onboarding.wordProjection');
  // Snapshot's `dailyTimeMsToday` is captured BEFORE the last card's review
  // mutation lands (auto-advance fires `onCardRated` synchronously while
  // the mutation is in flight), so it consistently undercounts by one
  // card. Pull the post-commit value via `getTodayStats` instead; fall
  // back to the snapshot until the query resolves.
  //
  // The same problem affects the new-words count when the user reaches
  // this screen via the skip path on an abort/restart cycle: `summary`
  // is null (skip wipes it), so falling back to `summary?.dailyNewWords`
  // would always show 0 even though today's actual count is positive.
  // Pull words live from `getNewWordsForCelebration`, summing BOTH
  // buckets — the query splits today's unique words into `session`
  // (current session id) and `today` (other sessions). They're disjoint,
  // so the total is `session.length + today.length`. Using only one
  // bucket undercounts the projection — e.g. abort + restart + rate one
  // more card would put 5 prior-session words in `today` and 1 in
  // `session`, so `today.length` alone reports 5 / `session.length`
  // alone reports 1 instead of the correct total of 6.
  const timezone = useMemo(() => getUserTimezone(), []);
  const todayStats = useQuery(api.features.courses.getTodayStats, { timezone });
  const celebrationWords = useQuery(
    api.features.stats.getNewWordsForCelebration,
    {
      sessionId: summary?.sessionId ?? 'onboarding-skip',
      timezone,
    },
  );
  const newWords = celebrationWords
    ? celebrationWords.session.length + celebrationWords.today.length
    : (summary?.dailyNewWordsToday ?? 0);
  const liveTimeMs = todayStats?.timeMs ?? summary?.dailyTimeMsToday ?? 0;
  const sessionMinutes = liveTimeMs > 0 ? Math.max(1, liveTimeMs / 60_000) : 3;
  const minutes = Math.round(sessionMinutes);
  // Local mirror so the slider feels instant; the wizard's persist call
  // happens on every drag step, which also updates `dailyTimeGoalMinutes`
  // via re-render — keep them in sync.
  const [localGoal, setLocalGoal] = useState(dailyTimeGoalMinutes);
  // Reconcile if the prop changes externally (e.g. after persist commits).
  if (localGoal !== dailyTimeGoalMinutes && !onDailyTimeChange) {
    setLocalGoal(dailyTimeGoalMinutes);
  }
  const activeGoal = onDailyTimeChange ? localGoal : dailyTimeGoalMinutes;
  const handleGoalChange = (next: number) => {
    setLocalGoal(next);
    onDailyTimeChange?.(next);
  };

  return (
    <div
      data-testid="onboarding-step-word-projection"
      className="flex flex-col h-full overflow-hidden animate-in fade-in duration-300"
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto w-full space-y-6">
          <div className="text-center pt-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('summary', { words: newWords, minutes })}
            </p>
            <h2 className="text-2xl font-bold">{t('headline')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('perDay', { minutes: activeGoal })}
            </p>
          </div>
          <ProjectionTimeline
            newWords={newWords}
            sessionMinutes={sessionMinutes}
            goal={activeGoal}
          />

          {onDailyTimeChange ? (
            <GoalPresetPicker
              activeGoal={activeGoal}
              onChange={handleGoalChange}
            />
          ) : null}
        </div>
      </div>
      <div className="shrink-0 border-t bg-background py-3 px-4">
        <Button
          size="lg"
          className="w-full max-w-md mx-auto block"
          onClick={onContinue}
          data-testid="word-projection-continue"
        >
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Vertical, horizontally-centered timeline: Today → In 30 days → Dec 31.
 * The year-end stop shows its full date (month first, then year — e.g.
 * "Dec 31, 2027", locale-formatted) and rolls to next year's end when this
 * year's is closer than MIN_DAYS_FOR_YEAR_HORIZON.
 */
function ProjectionTimeline({
  newWords,
  sessionMinutes,
  goal,
}: {
  newWords: number;
  sessionMinutes: number;
  goal: number;
}) {
  const t = useTranslations('Onboarding.wordProjection');
  const format = useFormatter();

  // Date math is render-stable per mount; the projections re-run on goal
  // changes only. Uses the same UTC date-string arithmetic as the in-app
  // projections (lib/dateStrings) so the two surfaces can never disagree
  // around DST or year boundaries — and the Date handed to next-intl (whose
  // formatter is pinned to UTC) is anchored at UTC noon, so it renders as
  // "Dec 31" in every timezone instead of "Dec 30" east of UTC.
  const { yearEnd, daysToYearEnd } = useMemo(() => {
    const today = dateInTimezone(Date.now(), getUserTimezone());
    let end = endOfYear(today);
    let days = Math.max(1, daysBetween(today, end));
    if (days < MIN_DAYS_FOR_YEAR_HORIZON) {
      end = endOfYear(addDays(end, 1));
      days = Math.max(1, daysBetween(today, end));
    }
    return { yearEnd: new Date(`${end}T12:00:00Z`), daysToYearEnd: days };
  }, []);

  const wordsLabel = (value: number, capped: boolean) =>
    `${value.toLocaleString()}${capped ? '+' : ''} ${t('wordsUnit')}`;

  const in30 = project(newWords, sessionMinutes, goal, 30);
  const atYearEnd = project(newWords, sessionMinutes, goal, daysToYearEnd);

  const stops = [
    {
      key: 'today',
      Icon: BookOpen,
      when: t('timelineToday'),
      value: wordsLabel(newWords, false),
      sub: t('timelineTodaySub'),
    },
    {
      key: 'in30',
      Icon: CalendarDays,
      when: t('timelineIn30Days'),
      value: wordsLabel(in30, in30 >= PROJECTION_CAP_WORDS),
      sub: t('timelineIn30DaysSub'),
    },
    {
      key: 'yearEnd',
      Icon: Sparkles,
      // Month before year, with the year always visible for this stop —
      // "Dec 31, 2027" (locale-ordered elsewhere, e.g. "31. Dez. 2027").
      when: format.dateTime(yearEnd, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      value: wordsLabel(atYearEnd, atYearEnd >= PROJECTION_CAP_WORDS),
      sub: t('timelineYearEndSub', { days: daysToYearEnd }),
    },
  ] as const;

  return (
    <div className="flex justify-center" data-testid="projection-timeline">
      <div className="relative space-y-6 py-2 text-left">
        <div
          className="absolute left-[11px] top-3 bottom-3 w-px bg-border"
          aria-hidden
        />
        {stops.map(({ key, Icon, when, value, sub }) => (
          <div key={key} className="relative flex items-start gap-4">
            <span className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-background">
              <Icon
                className="h-3.5 w-3.5"
                style={{ color: 'var(--primary)' }}
              />
            </span>
            <div className="-mt-0.5">
              <div className="text-xs text-muted-foreground">{when}</div>
              <div className="text-lg font-bold tabular-nums leading-tight">
                {value}
              </div>
              <div className="text-[11px] text-muted-foreground">{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stepped goal picker: the shared preset tiles (5/10/20/30/60, same list as
 * the home-screen quick-edit) plus a "Custom" tile revealing a free minute
 * input. The projection timeline above re-renders live on every change.
 */
function GoalPresetPicker({
  activeGoal,
  onChange,
}: {
  activeGoal: number;
  onChange: (minutes: number) => void;
}) {
  const t = useTranslations('Onboarding.wordProjection');
  const isPreset = (DAILY_TIME_PRESETS as readonly number[]).includes(
    activeGoal,
  );
  // Custom stays open once the user opts into it (or arrived with a
  // non-preset goal), so applying a value doesn't collapse the input.
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [customValue, setCustomValue] = useState(
    isPreset ? '' : String(activeGoal),
  );

  const parsedCustom = parseCustomGoal(customValue);

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t('adjustLabel')}</span>
        <span className="font-semibold tabular-nums">
          {t('perDay', { minutes: activeGoal })}
        </span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {DAILY_TIME_PRESETS.map((minutes) => (
          <GoalPresetTile
            key={minutes}
            active={!customOpen && activeGoal === minutes}
            onClick={() => {
              setCustomOpen(false);
              setCustomValue('');
              onChange(minutes);
            }}
            data-testid={`goal-preset-${minutes}`}
          >
            {minutes}
          </GoalPresetTile>
        ))}
        <GoalPresetTile
          active={customOpen}
          onClick={() => setCustomOpen(true)}
          data-testid="goal-preset-custom"
        >
          {t('custom')}
        </GoalPresetTile>
      </div>
      {customOpen && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsedCustom != null) onChange(parsedCustom);
          }}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={DAILY_TIME_CUSTOM_MIN}
            max={DAILY_TIME_CUSTOM_MAX}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            // Commit on blur too: tapping the wizard's Continue (outside this
            // form) blurs the input first, so a typed-but-unsubmitted value
            // is persisted instead of silently discarded.
            onBlur={() => {
              if (parsedCustom != null && parsedCustom !== activeGoal) {
                onChange(parsedCustom);
              }
            }}
            placeholder={t('customPlaceholder')}
            className="h-8 flex-1 text-xs"
            data-testid="goal-custom-input"
          />
          <span className="text-muted-xs">{t('minutesUnit')}</span>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={parsedCustom == null}
            className="h-8 px-2.5 text-xs"
          >
            {t('set')}
          </Button>
        </form>
      )}
    </div>
  );
}
