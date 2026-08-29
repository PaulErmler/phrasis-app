import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * Mirror of LearningModeSettings.ipa.test.tsx for the language-specific
 * section: it (and the furigana toggle inside it) only renders when a course
 * language has language-specific settings of its own (`languageNeedsFurigana`
 * — Japanese only today), and furigana defaults ON.
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

describe('LearningModeSettings: language-specific section', () => {
  it('shows the section + furigana toggle for a Japanese course', () => {
    renderSettings(['en'], ['ja']);
    expect(screen.getByText('languageSettings')).toBeInTheDocument();
    expect(screen.getByLabelText('showFurigana')).toBeInTheDocument();
  });

  it('omits the furigana row for courses without Japanese', () => {
    // The section itself still renders (en/es both have IPA rows), only the
    // furigana switch is gone.
    renderSettings(['en'], ['es']);
    expect(screen.getByText('languageSettings')).toBeInTheDocument();
    expect(screen.queryByLabelText('showFurigana')).toBeNull();
  });

  it('hides the whole section when no course language has any aid', () => {
    // fil: Latin script (no romanization), no espeak voice (no IPA), and no
    // furigana — the only way all three rows are absent.
    renderSettings(['fil'], ['fil']);
    expect(screen.queryByText('languageSettings')).toBeNull();
  });

  it('defaults furigana to ON', () => {
    renderSettings(['en'], ['ja']);
    expect(screen.getByLabelText('showFurigana')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
