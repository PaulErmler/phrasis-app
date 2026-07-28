import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * "Show romanization" used to render for every course, including all-Latin
 * ones where it controls nothing — the toggle was there but no card ever has a
 * romanization line to reveal. It should only appear when a language on the
 * course actually has a Latin transliteration.
 */

vi.mock('convex/react', () => ({
  // The component chains `.withOptimisticUpdate(...)` onto the result, so the
  // mock has to return a callable carrying that method.
  useMutation: () =>
    Object.assign(vi.fn(), { withOptimisticUpdate: () => vi.fn() }),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

// Renders its own Sheet and issues Convex queries; irrelevant to this gate.
vi.mock('@/components/course/CourseLanguageSettings', () => ({
  CourseLanguageSettings: () => null,
}));

// jsdom has no ResizeObserver, which Radix's slider thumb measures itself with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const SETTINGS: CourseSettings = {
  courseId: 'course_1' as Id<'courses'>,
  reviewMode: 'full',
};

function renderSettings(baseLanguages: string[], targetLanguages: string[]) {
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={SETTINGS}
      baseLanguages={baseLanguages}
      targetLanguages={targetLanguages}
    />,
  );
}

describe('LearningModeSettings — romanization gate', () => {
  it('hides the toggle when no language needs romanization', () => {
    renderSettings(['en'], ['de', 'es']);
    expect(screen.queryByLabelText('showRomanization')).toBeNull();
  });

  it('shows the toggle when a target language needs romanization', () => {
    renderSettings(['en'], ['ja']);
    expect(screen.getByLabelText('showRomanization')).toBeInTheDocument();
  });

  it('shows the toggle when the BASE language needs romanization', () => {
    // A Russian speaker learning German still wants the base line transliterated.
    renderSettings(['ru'], ['de']);
    expect(screen.getByLabelText('showRomanization')).toBeInTheDocument();
  });
});
