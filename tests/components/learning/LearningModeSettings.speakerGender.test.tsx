import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * Mirror of LearningModeSettings.ipa.test.tsx for the speaker-gender
 * preference: the section only renders when a course language marks speaker
 * gender (`courseMarksSpeakerGender`, which also carries the feature kill
 * switch), and it defaults to Mixed — today's per-sentence 50/50 behavior.
 */

vi.mock('convex/react', () => ({
  // The component chains `.withOptimisticUpdate(...)` onto the result, so the
  // mock has to return a callable carrying that method. The same shape serves
  // the plain `useMutation(ensureUpcomingCardsContentAllModes)` call.
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

function renderSettings(
  baseLanguages: string[],
  targetLanguages: string[],
  settings: CourseSettings = SETTINGS,
) {
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={settings}
      baseLanguages={baseLanguages}
      targetLanguages={targetLanguages}
    />,
  );
}

describe('LearningModeSettings: speaker-gender gate', () => {
  it('shows the section when a target language marks speaker gender', () => {
    renderSettings(['en'], ['es']);
    expect(screen.getByLabelText('speakerGenderMixed')).toBeInTheDocument();
    expect(screen.getByLabelText('speakerGenderFemale')).toBeInTheDocument();
    expect(screen.getByLabelText('speakerGenderMale')).toBeInTheDocument();
  });

  it('shows the section when only the BASE language marks speaker gender', () => {
    // Russian base, German target: the base language's sentences are still
    // re-worded per gender, so the setting applies.
    renderSettings(['ru'], ['de']);
    expect(screen.getByLabelText('speakerGenderMixed')).toBeInTheDocument();
  });

  it('hides the section when no course language marks speaker gender', () => {
    renderSettings(['en'], ['de']);
    expect(screen.queryByLabelText('speakerGenderMixed')).toBeNull();
    expect(screen.queryByLabelText('speakerGenderMale')).toBeNull();
  });

  it('defaults to Mixed when the preference was never set', () => {
    renderSettings(['en'], ['es']);
    expect(screen.getByLabelText('speakerGenderMixed')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('speakerGenderFemale')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('reflects a stored preference', () => {
    renderSettings(['en'], ['es'], {
      ...SETTINGS,
      speakerGenderPreference: 'female',
    });
    expect(screen.getByLabelText('speakerGenderFemale')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('speakerGenderMixed')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
