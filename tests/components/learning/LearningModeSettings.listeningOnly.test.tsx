import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * "Practice Listening" must never be the only audible group: once the
 * listening strategy graduates a card, the before-base group drops out and an
 * all-0x base/after timeline would play nothing. Every write that reaches
 * that state is refused with a toast instead of saved.
 */

const { updateSettings, timelineCards, toastError } = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  toastError: vi.fn(),
  timelineCards: [] as Array<{
    code: string;
    type: 'base' | 'target';
    label?: string;
    plays: number;
    onPlaysChange: (value: number) => void;
  }>,
}));

vi.mock('convex/react', () => ({
  useMutation: () =>
    Object.assign(vi.fn(), { withOptimisticUpdate: () => updateSettings }),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock('@/components/course/CourseLanguageSettings', () => ({
  CourseLanguageSettings: () => null,
}));

vi.mock('@/components/app/learning/TimelineLanguageCard', () => ({
  TimelineLanguageCard: (props: (typeof timelineCards)[number]) => {
    timelineCards.push(props);
    return null;
  },
}));
vi.mock('@/components/app/learning/StepperControl', () => ({
  StepperControl: () => null,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const COURSE_ID = 'course_1' as Id<'courses'>;

function renderSettings(settings: Partial<CourseSettings>) {
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={{ courseId: COURSE_ID, ...settings } as CourseSettings}
      baseLanguages={['en']}
      targetLanguages={['it']}
    />,
  );
}

/** The latest rendered card for a group (rerenders push again). */
const lastCard = (type: 'base' | 'target', label?: string) =>
  [...timelineCards]
    .reverse()
    .find((c) => c.type === type && c.label === label);

describe('LearningModeSettings: Practice Listening cannot be the only audio', () => {
  beforeEach(() => {
    updateSettings.mockClear();
    toastError.mockClear();
    timelineCards.length = 0;
  });

  it('labels the before-base cards "Listening Practice" and leaves the others unlabelled', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
    });
    expect(lastCard('target', 'listeningPracticeLabel')).toBeDefined();
    expect(lastCard('target', undefined)).toBeDefined();
    expect(lastCard('base', undefined)).toBeDefined();
  });

  it('refuses stepping the last non-listening repetition to 0', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      languageRepetitions: { en: 0, it: 1 },
      targetBeforeRepetitions: { it: 1 },
    });
    lastCard('target', undefined)!.onPlaysChange(0);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      'listeningOnlyBlocked',
    );
  });

  it('saves a decrement that leaves another non-listening repetition', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      languageRepetitions: { en: 1, it: 1 },
    });
    lastCard('target', undefined)!.onPlaysChange(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      languageRepetitions: { en: 1, it: 0 },
    });
  });

  it('lets the listening group itself go to 0', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      languageRepetitions: { en: 0, it: 1 },
      targetBeforeRepetitions: { it: 1 },
    });
    lastCard('target', 'listeningPracticeLabel')!.onPlaysChange(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      targetBeforeRepetitions: { it: 0 },
    });
  });

  it('refuses turning Practice Listening on over an all-0x timeline', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: false,
      playTargetAfterBase: true,
      languageRepetitions: { en: 0, it: 0 },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'practiceListening' }));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('refuses turning Practice Speaking off while base is at 0x', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      languageRepetitions: { en: 0, it: 1 },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'practiceSpeaking' }));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('turns Practice Speaking off when base still plays', () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      languageRepetitions: { en: 1, it: 1 },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'practiceSpeaking' }));
    expect(toastError).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      playTargetAfterBase: false,
    });
  });

  it('does not apply in the writing mode, where the toggles are ignored', () => {
    renderSettings({
      reviewMode: 'full',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      languageRepetitions: { en: 1, it: 0 },
    });
    lastCard('base', undefined)!.onPlaysChange(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalled();
  });
});
