import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * The "AI feedback on answers" toggle (writing mode): renders in the full
 * review-mode section, defaults ON when unset (`aiWritingFeedback ?? true`),
 * and writes the flipped value through updateCourseSettings. Sibling toggles
 * (furigana, ipa) each have a suite; this one had none.
 */

const updateSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('convex/react', () => ({
  useMutation: () =>
    Object.assign(vi.fn(), {
      withOptimisticUpdate: () => updateSettingsMock,
    }),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock('@/components/course/CourseLanguageSettings', () => ({
  CourseLanguageSettings: () => null,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function renderSettings(overrides: Partial<CourseSettings> = {}) {
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={
        {
          courseId: 'course_1' as Id<'courses'>,
          reviewMode: 'full',
          ...overrides,
        } as CourseSettings
      }
      baseLanguages={['en']}
      targetLanguages={['es']}
    />,
  );
}

describe('LearningModeSettings: AI writing feedback toggle', () => {
  beforeEach(() => {
    updateSettingsMock.mockReset();
  });

  it('defaults to ON when the setting is unset', () => {
    renderSettings();
    expect(screen.getByLabelText('aiWritingFeedback')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reflects an explicit OFF', () => {
    renderSettings({ aiWritingFeedback: false });
    expect(screen.getByLabelText('aiWritingFeedback')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('writes the flipped value for this course', () => {
    renderSettings();
    fireEvent.click(screen.getByLabelText('aiWritingFeedback'));
    expect(updateSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'course_1',
        aiWritingFeedback: false,
      }),
    );
  });
});
