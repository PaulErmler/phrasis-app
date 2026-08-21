'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Filter, Loader2, Lock, MessageSquare, PenLine } from 'lucide-react';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { FEATURE_IDS } from '@/convex/features/featureIds';

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

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
      <div className="text-center space-y-2">
        {isFilterBlocked && (
          <Filter className="mx-auto h-8 w-8 text-muted-foreground" />
        )}
        <h2 className="body-large font-medium">{t(titleKey)}</h2>
        <p className="text-muted-sm">{t(subtitleKey)}</p>
      </div>
      <div className="flex flex-col items-center gap-2">
        {isLimitReached ? (
          <Button
            size="lg"
            onClick={onUpgrade}
            className="gap-2"
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
