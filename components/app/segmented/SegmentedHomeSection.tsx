'use client';

import * as React from 'react';
import { usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';
import { useUpdateStudyContentFilter } from '@/hooks/use-update-study-content-filter';
import { useTranslations } from 'next-intl';
import type { Id } from '@/convex/_generated/dataModel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { PremadeTab } from './PremadeTab';
import { CustomTab } from './CustomTab';

interface SegmentedHomeSectionProps {
  activeCourseId: Id<'courses'> | null;
  onNavigateToContent: () => void;
  onNavigateToChat: () => void;
}
export function SegmentedHomeSection({
  activeCourseId,
  onNavigateToContent,
  onNavigateToChat,
}: SegmentedHomeSectionProps) {
  // Preloaded server-side in app/app/layout.tsx so the section renders with
  // real data on the first paint; usePreloadedQuery still subscribes to live
  // updates after hydration. Using the preloaded course settings (instead of
  // a fresh useQuery) avoids a flash where the "Off" pill on the excluded
  // source tab only appears after a brief delay.
  const { preloadedHomeSummary, preloadedCourseSettings } = useAppData();
  const summary = usePreloadedQuery(preloadedHomeSummary);
  const settings = usePreloadedQuery(preloadedCourseSettings);
  const updateSettings = useUpdateStudyContentFilter();
  const t = useTranslations('AppPage.collections.carousel');
  const [currentTab, setCurrentTab] = React.useState<'premade' | 'custom'>('premade');

  if (summary === undefined) {
    return <SegmentedSkeleton />;
  }
  if (summary === null) {
    return null;
  }

  // Filter-driven badges: only the *excluded* source gets an "Off" pill.
  // The badge is purely informational — the user is still free to browse
  // either tab regardless of filter.
  const filter = settings?.studyContentFilter ?? 'both';
  const courseOff = filter === 'custom'; // course tab is off when filter='custom'
  const customOff = filter === 'course'; // custom tab is off when filter='course'

  const reenable = async (target: 'premade' | 'custom') => {
    if (!settings) return;
    // Re-enabling either side means we no longer filter to only one source.
    await updateSettings({
      courseId: settings.courseId,
      studyContentFilter: 'both',
    });
    setCurrentTab(target);
  };

  return (
    <Tabs
      value={currentTab}
      onValueChange={(v) => setCurrentTab(v as 'premade' | 'custom')}
      className="flex flex-col gap-3"
    >
      <TabsList className="w-full">
        <TabsTrigger value="premade" className="flex-1">
          {/* Invisible mirror on the left so the label stays exactly centered
              within the trigger; the real badge sits to the right of the text. */}
          {courseOff && <OffBadgeSpacer label={t('sourceBadgeOff')} />}
          {t('tabPremade')}
          {courseOff && (
            <OffBadge
              isCurrent={currentTab === 'premade'}
              onReenable={() => reenable('premade')}
              sourceLabel={t('tabPremade')}
            />
          )}
        </TabsTrigger>
        <TabsTrigger value="custom" className="flex-1">
          {customOff && <OffBadgeSpacer label={t('sourceBadgeOff')} />}
          {t('tabCustom')}
          {customOff && (
            <OffBadge
              isCurrent={currentTab === 'custom'}
              onReenable={() => reenable('custom')}
              sourceLabel={t('tabCustom')}
            />
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="premade" className="flex flex-col gap-3">
        <PremadeTab summary={summary} activeCourseId={activeCourseId} />
      </TabsContent>

      <TabsContent value="custom" className="flex flex-col gap-3">
        <CustomTab
          customCollections={summary.customCollections}
          activeCourseId={activeCourseId}
          onNavigateToContent={onNavigateToContent}
          onNavigateToChat={onNavigateToChat}
        />
      </TabsContent>
    </Tabs>
  );
}

// ============================================================================
// Premade tab — CEFR-grouped rail + inline detail card (original preview)
// ============================================================================

function OffBadgeSpacer({ label }: { label: string }) {
  return (
    <Badge
      aria-hidden
      variant="outline"
      className="invisible h-4 px-1.5 text-[10px] font-medium"
    >
      {label}
    </Badge>
  );
}

/**
 * "Off" pill rendered inside a switcher tab whose source is currently
 * excluded by the content-source filter. Clicking behavior is gated by
 * whether the parent tab is selected:
 *
 *   - Tab NOT selected: pill click bubbles → Tabs swaps to this tab.
 *     We do nothing in the handler so the click bubbles naturally to
 *     TabsTrigger.
 *   - Tab IS selected: pill click opens a popover with a one-tap
 *     re-enable CTA. We stopPropagation so Tabs doesn't see the click.
 *
 * The popover is anchored (not triggered) by the badge — using
 * PopoverTrigger here would intercept every click and either fight with
 * the tab-switch (preventDefault skips Radix's TabsTrigger composeHandler)
 * or open the popover when the user just meant to switch tabs.
 */
function OffBadge({
  isCurrent,
  onReenable,
  sourceLabel,
}: {
  isCurrent: boolean;
  onReenable: () => void;
  sourceLabel: string;
}) {
  const t = useTranslations('AppPage.collections.carousel');
  const [open, setOpen] = React.useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (!isCurrent) {
      // Let the click bubble untouched so TabsTrigger switches tabs.
      return;
    }
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Badge
          variant="outline"
          // role+tabIndex make the badge keyboard-focusable so screen
          // readers can announce the reactivate affordance.
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!isCurrent) return;
              e.stopPropagation();
              setOpen(true);
            }
          }}
          className="h-4 cursor-pointer px-1.5 text-[10px] font-medium text-muted-foreground"
          data-testid="source-badge-off"
        >
          {t('sourceBadgeOff')}
        </Badge>
      </PopoverAnchor>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('reenablePopover.title', { source: sourceLabel })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('reenablePopover.description')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            {t('reenablePopover.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              onReenable();
            }}
            data-testid="source-badge-reenable"
          >
            {t('reenablePopover.confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SegmentedSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
        <div className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pt-2 pb-5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex shrink-0 flex-col gap-1.5">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="flex gap-1">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="h-14 w-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
