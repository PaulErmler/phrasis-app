import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * Mirror of LearningModeSettings.romanization.test.tsx for the IPA toggle:
 * the row only renders when a course language has an espeak voice
 * (`languageNeedsIpa`), and it defaults to OFF, unlike romanization's
 * default-ON. In practice only ja/fil-only courses hide it.
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

// Deliberately partial: the component only reads the fields under test.
const SETTINGS = {
  courseId: 'course_1' as Id<'courses'>,
  reviewMode: 'full',
} as CourseSettings;

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

describe('LearningModeSettings: IPA gate', () => {
  it('shows the toggle for ordinary courses (English/Spanish have voices)', () => {
    renderSettings(['en'], ['es']);
    expect(screen.getByLabelText('showIpa')).toBeInTheDocument();
  });

  it('hides the toggle when no course language has an espeak voice', () => {
    // ja is excluded (kana-only voice) and fil has no voice at all.
    renderSettings(['ja'], ['fil']);
    expect(screen.queryByLabelText('showIpa')).toBeNull();
  });

  it('defaults to unchecked (IPA is opt-in, unlike romanization)', () => {
    renderSettings(['en'], ['fr']);
    const ipaSwitch = screen.getByLabelText('showIpa');
    expect(ipaSwitch).toHaveAttribute('aria-checked', 'false');
    // Contrast: romanization defaults ON for a course that supports it.
    renderSettings(['en'], ['el']);
    expect(screen.getByLabelText('showRomanization')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
