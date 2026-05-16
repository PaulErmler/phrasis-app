'use client';

import * as React from 'react';
import { Settings2 } from 'lucide-react';
import { useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';

import { api } from '@/convex/_generated/api';
import { useUpdateStudyContentFilter } from '@/hooks/use-update-study-content-filter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FilterValue = 'both' | 'custom' | 'course';

const FIXED_TRIGGER_WIDTH = { width: '140px' } as const;

/**
 * Subtle inline dropdown that picks the content-source filter for the active
 * course. Designed to sit flush-right under the Audio/Full toggle inside the
 * StartLearningButton block (placement-B / variant I).
 *
 * The trigger has a fixed width so the row layout stays stable as the user
 * cycles through values of different lengths. The constraint "cannot disable
 * both sources" is implicit — Select can't pick a no-op value.
 */
export function ContentFilterDropdown() {
  const settings = useQuery(api.features.courses.getActiveCourseSettings, {});
  const updateSettings = useUpdateStudyContentFilter();
  const t = useTranslations('AppPage.contentFilter');

  if (!settings) {
    // Same-width placeholder so the surrounding flex row doesn't jump when
    // the query resolves.
    return (
      <div className="flex items-center justify-end gap-2 pt-1">
        <div
          className="h-7 animate-pulse rounded-md bg-muted"
          style={FIXED_TRIGGER_WIDTH}
        />
      </div>
    );
  }

  const value: FilterValue = settings.studyContentFilter ?? 'both';

  const handleChange = async (next: string) => {
    if (next !== 'both' && next !== 'custom' && next !== 'course') return;
    if (next === value) return;
    await updateSettings({
      courseId: settings.courseId,
      studyContentFilter: next,
    });
  };

  return (
    <div
      className="flex items-center justify-end gap-2 pt-1"
      data-testid="content-filter-dropdown"
      data-tutorial="content-source-filter"
    >
      <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{t('label')}</span>
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          // Pin width with an inline style so it can't be unset by class
          // merging (the base SelectTrigger ships `w-fit`).
          style={FIXED_TRIGGER_WIDTH}
          className="shrink-0 text-xs"
          data-testid="content-filter-trigger"
        >
          <SelectValue className="min-w-0 flex-1 text-left" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="both" data-testid="content-filter-option-both">
            {t('valueBoth')}
          </SelectItem>
          <SelectItem value="custom" data-testid="content-filter-option-custom">
            {t('valueCustom')}
          </SelectItem>
          <SelectItem value="course" data-testid="content-filter-option-course">
            {t('valueCourse')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
