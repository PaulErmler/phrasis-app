import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * The settings sheet funnels every write through one shared `setFields` path.
 * These tests pin:
 *  (a) the payloads: inline `setField` rows and the mode-suffixed named
 *      handlers still send exactly {courseId, <field>: value};
 *  (b) the shared failure handling: a rejected mutation surfaces as the
 *      generic save-failed toast (reusing AppPage.courses.manage.saveFailed)
 *      instead of an unhandled rejection while the control silently snaps
 *      back;
 *  (c) preview/playback parity: the preview timeline resolves its values
 *      through the same `*Transcribe ?? *Full ?? unsuffixed` chain as the
 *      merged audio (resolveAudioSettings), so an unmigrated writing-mode doc
 *      previews the audio-mode values.
 */

const { updateSettings, toastError, timelineCards } = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  toastError: vi.fn(),
  timelineCards: [] as Array<{
    code: string;
    type: 'base' | 'target';
    plays: number;
    repPause: number;
    speed: number;
    showReorderButtons?: boolean;
  }>,
}));

vi.mock('convex/react', () => ({
  // The component chains `.withOptimisticUpdate(...)` onto the result, so the
  // mock has to return a callable carrying that method.
  useMutation: () =>
    Object.assign(vi.fn(), { withOptimisticUpdate: () => updateSettings }),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError },
}));

// Renders its own Sheet and issues Convex queries; irrelevant here.
vi.mock('@/components/course/CourseLanguageSettings', () => ({
  CourseLanguageSettings: () => null,
}));

// Stubbed so the parity test can read the resolved values the preview passes
// down, and so steppers with absent optional settings don't matter.
vi.mock('@/components/app/learning/TimelineLanguageCard', () => ({
  TimelineLanguageCard: (props: (typeof timelineCards)[number]) => {
    timelineCards.push(props);
    return null;
  },
}));
vi.mock('@/components/app/learning/StepperControl', () => ({
  StepperControl: () => null,
}));

// jsdom has no ResizeObserver, which Radix's slider thumb measures itself with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const COURSE_ID = 'course_1' as Id<'courses'>;

function renderSettings(settings: Partial<CourseSettings> = {}) {
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={{ courseId: COURSE_ID, ...settings } as CourseSettings}
      baseLanguages={['en']}
      targetLanguages={['es']}
    />,
  );
}

describe('LearningModeSettings: shared write path', () => {
  beforeEach(() => {
    updateSettings.mockReset().mockResolvedValue(null);
    toastError.mockClear();
    timelineCards.length = 0;
  });

  it('inline setField rows send exactly {courseId, field: value}', () => {
    renderSettings({ reviewMode: 'audio' });
    // Auto-add defaults on (`!== false`); clicking turns it off.
    fireEvent.click(screen.getByLabelText('autoAddCards'));
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      autoAddCards: false,
    });
  });

  it('mode-suffixed handlers write the current mode’s field copy', () => {
    renderSettings({ reviewMode: 'full' });
    // Auto-play resolves on by default; toggling in writing mode must write
    // the *Full copy, leaving the audio-mode field untouched.
    fireEvent.click(screen.getByLabelText('autoPlay'));
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      autoPlayAudioFull: false,
    });
  });

  it('a failed update toasts the generic save error instead of rejecting unhandled', async () => {
    updateSettings.mockRejectedValue(new Error('boom'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    renderSettings({ reviewMode: 'audio' });
    fireEvent.click(screen.getByLabelText('autoAddCards'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('saveFailed'));
    consoleError.mockRestore();
  });

  it('a successful update never toasts', async () => {
    renderSettings({ reviewMode: 'audio' });
    fireEvent.click(screen.getByLabelText('autoAddCards'));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('LearningModeSettings: preview resolves through the playback chain', () => {
  beforeEach(() => {
    updateSettings.mockReset().mockResolvedValue(null);
    timelineCards.length = 0;
  });

  it('writing mode with no *Full copies previews the audio-mode values', () => {
    renderSettings({
      reviewMode: 'full',
      languageRepetitions: { en: 7 },
      languagePlaybackSpeeds: { en: 1.4 },
    });
    const base = timelineCards.find(
      (c) => c.type === 'base' && c.code === 'en',
    );
    expect(base?.plays).toBe(7);
    expect(base?.speed).toBe(1.4);
  });

  it('a stored *Full copy wins over the audio-mode value in writing mode', () => {
    renderSettings({
      reviewMode: 'full',
      languageRepetitions: { en: 7 },
      languageRepetitionsFull: { en: 2 },
    });
    const base = timelineCards.find(
      (c) => c.type === 'base' && c.code === 'en',
    );
    expect(base?.plays).toBe(2);
  });
});
