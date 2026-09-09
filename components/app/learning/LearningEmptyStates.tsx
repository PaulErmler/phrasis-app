'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Filter, Loader2, Lock, MessageSquare, PenLine } from 'lucide-react';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { useCountdown } from '@/hooks/use-countdown';
import { minuteBoundaryAtOrAfter } from '@/hooks/use-now-minute';
import { nextReviewLine } from '@/lib/nextReview';
import { getUserTimezone } from '@/lib/timezone';

// ============================================================================
// No collection selected
// ============================================================================

interface NoCollectionStateProps {
  onGoHome: () => void;
}

export function NoCollectionState({ onGoHome }: NoCollectionStateProps) {
  const t = useTranslations('LearningMode');

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
      <div className="space-y-2 text-center">
        <h2 className="body-large font-medium">{t('empty.noCollection')}</h2>
        <p className="text-muted-sm">{t('empty.noCollectionDescription')}</p>
      </div>
      <Button onClick={onGoHome}>{t('empty.goHome')}</Button>
    </main>
  );
}

// ============================================================================
// Next-review countdown
// ============================================================================

/**
 * `Intl` options per `NextReviewLine.clock` discriminant.
 *
 * `hour: '2-digit'` rather than `'numeric'`: with `'numeric'`, German resolves a
 * bare time to "4:01" but a weekday time to "04:01", so the same screen would
 * show the hour two ways depending on how far off the review is. `'2-digit'` is
 * stable across all three shapes in both locales.
 */
const CLOCK_FORMATS = {
  time: { hour: '2-digit', minute: '2-digit' },
  weekdayTime: { weekday: 'short', hour: '2-digit', minute: '2-digit' },
  dateTime: {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/**
 * "Next review in 7h 48m · tomorrow at 04:01", ticking down live.
 *
 * Its own component so the per-second tick in the last minute re-renders this
 * one paragraph instead of the whole empty state, whose Add button and
 * `FeatureBadge` run their own queries.
 *
 * The countdown targets the minute boundary at or after `dueDate`, not the raw
 * instant: the due queue is bounded by the minute-floored `useNowMinute`, so
 * that boundary is when the card actually arrives. Zero therefore coincides with
 * the tick that unmounts this screen, and no refresh button is needed.
 */
function NextReviewCountdown({ dueDate }: { dueDate: number }) {
  const t = useTranslations('LearningMode');
  const format = useFormatter();
  const target = minuteBoundaryAtOrAfter(dueDate);
  const line = useCountdown(target, (remaining) =>
    nextReviewLine(target, remaining, getUserTimezone()),
  );
  if (!line) return null;

  const time = line.time;
  const clock = line.clock
    ? format.dateTime(new Date(target), CLOCK_FORMATS[line.clock])
    : '';

  // One `t(...)` per variant rather than a computed key: next-intl types each
  // message against its own values, so a union of keys in a single call is a
  // fight with no upside. No `default` either, so adding a variant to
  // `NextReviewLine` fails the build here instead of falling back silently.
  let text: string;
  switch (line.key) {
    case 'nextReview':
      text = t('nextReview', { time });
      break;
    case 'empty.nextReviewToday':
      text = t('empty.nextReviewToday', { time, clock });
      break;
    case 'empty.nextReviewTomorrow':
      text = t('empty.nextReviewTomorrow', { time, clock });
      break;
    case 'empty.nextReviewOn':
      text = t('empty.nextReviewOn', { time, clock });
      break;
  }

  return (
    <p
      className="text-muted-sm tabular-nums"
      data-testid="next-review-countdown"
    >
      {text}
    </p>
  );
}

// ============================================================================
// No cards due
// ============================================================================

interface NoCardsDueStateProps {
  onAddCards: () => void;
  isAddingCards: boolean;
  batchSize: number;
  /** Remaining sentences quota. null means unlimited. */
  sentencesRemaining?: number | null;
  /** Remaining cards in the active collection. null means unknown. */
  remainingInCollection?: number | null;
  /** Called when the user clicks the upgrade button (limit reached). */
  onUpgrade?: () => void;
  /**
   * True when the user's deck has zero usable cards (`reason: 'no_cards'`
   * from `getCardForReviewEmptyReason`). Drives a different title/subtitle
   * so we don't tell a brand-new user they're "all caught up." CTA stays
   * Add Cards.
   */
  isDeckEmpty?: boolean;
  /**
   * If the content-source filter is currently hiding cards, the active source
   * is reported here. The empty-state copy + CTAs then key off three signals:
   *   • activeFilter             : which filter direction is active.
   *   • currentSourceHasAnyCards : does the user have ANY card in the source
   *                                they're filtering to? (false ⇒ "must add"
   *                                Flipping the filter alone won't help
   *                                long-term; the user needs to add cards.)
   *   • filterUnblockAvailable   : does the other source have a DUE card
   *                                right now? (true ⇒ surface the one-tap
   *                                "Include {other}" CTA.)
   */
  activeFilter?: 'custom' | 'course' | null;
  /**
   * Whether the user has at least one card in the currently-filtered-to
   * source. When false AND a filter is active, we render the must-add copy
   * regardless of whether the other source has due cards.
   */
  currentSourceHasAnyCards?: boolean;
  /** True iff flipping the filter to the other source would surface cards. */
  filterUnblockAvailable?: boolean;
  /**
   * True iff at least one of the user's active custom collections has
   * pending texts the auto-add pipeline could still pull in for free
   * (Phase 1 of `addCardsFromCollection`, no `SENTENCES` quota consumed).
   * Gates the upgrade button so a user with custom cards still queued
   * doesn't see a misleading paywall.
   */
  customCardsPendingAdd?: boolean;
  /**
   * When the earliest still-scheduled card comes due (`nextDueDate` from
   * `getCardForReviewEmptyReason`), driving the live "next review in X"
   * countdown. `null`/absent means there is nothing to count down to: free
   * play, Learn-new mode with every card graduated, or a deck with no cards.
   * The plain caught-up subtitle is the fallback.
   */
  nextDueDate?: number | null;
  /**
   * True while the enable-time writing-track seed is still running (reason
   * 'preparing_writing'): the queue only looks empty because cards aren't
   * seeded yet, so render a transient preparing state instead of "all caught
   * up" / add-cards CTAs.
   */
  isPreparingWriting?: boolean;
  /** Called when the user opts to include the other source (set filter to 'both'). */
  onIncludeOtherSource?: () => void;
  /**
   * Navigate to chat. Shown alongside `onCreateCustomCards` whenever the
   * active filter is 'custom' (both must-add and can-unblock variants),
   * because both paths actually create custom cards.
   */
  onCreateChatCards: () => void;
  /** Navigate to the custom-card creation page (same condition as above). */
  onCreateCustomCards: () => void;
}

export function NoCardsDueState({
  onAddCards,
  isAddingCards,
  batchSize,
  sentencesRemaining,
  remainingInCollection,
  onUpgrade,
  isDeckEmpty,
  activeFilter,
  currentSourceHasAnyCards,
  filterUnblockAvailable,
  customCardsPendingAdd,
  nextDueDate,
  isPreparingWriting,
  onIncludeOtherSource,
  onCreateChatCards,
  onCreateCustomCards,
}: NoCardsDueStateProps) {
  const t = useTranslations('LearningMode');
  const tFeature = useTranslations('FeatureTracking');

  if (isPreparingWriting) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <div className="space-y-2 text-center">
          <h2 className="body-large font-medium">
            {t('empty.preparingWriting.title')}
          </h2>
          <p className="text-muted-sm">
            {t('empty.preparingWriting.subtitle')}
          </p>
        </div>
      </main>
    );
  }

  // The upgrade button suppresses the auto-add CTA when sentences quota
  // hits zero, but only when the user actually needs the quota. Phase 1
  // of `addCardsFromCollection` (custom/chat) consumes nothing, so when
  // `customCardsPendingAdd` is true we let Add Cards render normally.
  // Likewise, when the filter is 'custom', Phase 2 (premade, the only
  // quota-gated source) never runs. The SENTENCES paywall is irrelevant.
  const sentencesQuotaApplies =
    !customCardsPendingAdd && activeFilter !== 'custom';
  const isLimitReached = sentencesRemaining === 0 && sentencesQuotaApplies;
  const displayCount = Math.min(
    batchSize,
    ...(sentencesRemaining != null && sentencesQuotaApplies
      ? [sentencesRemaining]
      : []),
    ...(remainingInCollection != null ? [remainingInCollection] : []),
  );
  const noCardsAvailable = displayCount === 0;

  // Two independent signals drive the filter-blocked variants:
  //   • subtitle copy : can-unblock when user has cards in the active source
  //                     (just not due now); must-add when they don't.
  //   • include-other : the "turn off the filter" CTA. Always shown when a
  //                     filter is active so the user has a one-tap escape
  //                     hatch back to the full deck: regardless of whether
  //                     the other source currently has a due card. (If the
  //                     deck is truly empty, the backend returns 'no_cards'
  //                     instead, so we never render this branch with zero
  //                     cards anywhere.)
  const isFilterBlocked = !!activeFilter;
  const subtitleVariant: 'canUnblock' | 'mustAdd' =
    currentSourceHasAnyCards === true ? 'canUnblock' : 'mustAdd';
  const showIncludeOther = isFilterBlocked;
  // Suppress unused-var lint: filterUnblockAvailable is part of the public
  // contract for consumers that may want to drive different copy/styling
  // in the future, even though the current layout shows the CTA regardless.
  void filterUnblockAvailable;

  let subtitleKey = 'empty.allDone';
  if (isFilterBlocked) {
    if (subtitleVariant === 'canUnblock') {
      subtitleKey =
        activeFilter === 'custom'
          ? 'empty.filterBlocked.subtitleCanUnblockCustom'
          : 'empty.filterBlocked.subtitleCanUnblockCourse';
    } else {
      subtitleKey =
        activeFilter === 'custom'
          ? 'empty.filterBlocked.subtitleMustAddCustom'
          : 'empty.filterBlocked.subtitleMustAddCourse';
    }
  } else if (isDeckEmpty) {
    subtitleKey = 'empty.noCardsInDeck';
  }

  const titleKey = isFilterBlocked
    ? activeFilter === 'custom'
      ? 'empty.filterBlocked.titleCustom'
      : 'empty.filterBlocked.titleCourse'
    : isDeckEmpty
      ? 'empty.deckEmptyTitle'
      : 'empty.noCardsDue';

  // Where the countdown goes depends on what it would displace. The plain
  // caught-up subtitle ("All caught up! Add more sentences…") says nothing the
  // Add button below it doesn't, so the countdown takes its place and the screen
  // stays two lines. The filter-blocked subtitles name which filter is hiding
  // what and whether the other source has cards, which a wait time does not
  // replace, so there the countdown is an extra line underneath.
  const countdown =
    nextDueDate != null ? <NextReviewCountdown dueDate={nextDueDate} /> : null;
  const showSubtitle = isFilterBlocked || countdown === null;

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
      <div className="text-center space-y-2">
        {isFilterBlocked && (
          <Filter className="mx-auto h-8 w-8 text-muted-foreground" />
        )}
        <h2 className="body-large font-medium">{t(titleKey)}</h2>
        {showSubtitle && <p className="text-muted-sm">{t(subtitleKey)}</p>}
        {countdown}
      </div>
      <div className="flex flex-col items-center gap-2">
        {isLimitReached ? (
          <Button
            size="lg"
            onClick={onUpgrade}
            className="gap-2"
            data-testid="empty-upgrade"
          >
            <Lock className="h-4 w-4" />
            {tFeature('upgrade')}
          </Button>
        ) : isFilterBlocked && activeFilter === 'custom' ? (
          // When filtered to custom, the regular auto-add pipeline doesn't
          // help. Custom cards come from the chat or the manual entry
          // page. Surface those two routes side-by-side, and stack the
          // "turn off the filter" CTA above them at the combined width.
          <div className="flex flex-col items-stretch gap-2">
            {showIncludeOther && onIncludeOtherSource && (
              <Button
                size="lg"
                onClick={onIncludeOtherSource}
                data-testid="filter-blocked-include-other"
                className="w-full"
              >
                {t('empty.filterBlocked.includeCourse')}
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                size="lg"
                variant={showIncludeOther ? 'outline' : 'default'}
                onClick={onCreateChatCards}
                className="flex-1 gap-2"
                data-testid="filter-blocked-create-chat"
              >
                <MessageSquare className="h-4 w-4" />
                {t('empty.filterBlocked.createChatCards')}
              </Button>
              <Button
                size="lg"
                variant={showIncludeOther ? 'outline' : 'default'}
                onClick={onCreateCustomCards}
                className="flex-1 gap-2"
                data-testid="filter-blocked-create-custom"
              >
                <PenLine className="h-4 w-4" />
                {t('empty.filterBlocked.createCustomCards')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {showIncludeOther && onIncludeOtherSource && (
              <Button
                size="lg"
                onClick={onIncludeOtherSource}
                data-testid="filter-blocked-include-other"
              >
                {t('empty.filterBlocked.includeCustom')}
              </Button>
            )}
            <Button
              size="lg"
              variant={showIncludeOther ? 'outline' : 'default'}
              onClick={onAddCards}
              disabled={isAddingCards || noCardsAvailable}
              className="gap-2"
              data-testid="empty-add-cards"
            >
              {isAddingCards ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('empty.adding')}
                </>
              ) : (
                t('empty.addCards', { count: displayCount })
              )}
            </Button>
          </>
        )}
        <FeatureBadge featureId={FEATURE_IDS.SENTENCES} />
      </div>
    </main>
  );
}
