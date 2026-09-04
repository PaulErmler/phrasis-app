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
  const courseSettings = { courseId: COURSE_ID, ...settings } as CourseSettings;
  const sheet = (open: boolean) => (
    <LearningModeSettings
      open={open}
      onOpenChange={vi.fn()}
      courseSettings={courseSettings}
      baseLanguages={['en']}
      targetLanguages={['es']}
    />
  );
  const result = render(sheet(true));
  // Closing unmounts the sheet body but not the component, which is what makes
  // the scope override outlive a close unless it is explicitly cleared.
  return { setOpen: (open: boolean) => result.rerender(sheet(open)) };
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

describe('LearningModeSettings: Radio scope writes its own copy', () => {
  beforeEach(() => {
    updateSettings.mockReset().mockResolvedValue(null);
    toastError.mockClear();
    timelineCards.length = 0;
  });

  /** Renders with the split on and clicks through to the Radio scope. */
  const inRadioScope = (settings: Partial<CourseSettings> = {}) => {
    renderSettings({
      reviewMode: 'audio',
      separateRadioSettings: true,
      ...settings,
    });
    fireEvent.click(screen.getByTestId('settings-scope-radio'));
    updateSettings.mockClear();
  };

  it('offers no scope pill until the split is turned on', () => {
    renderSettings({ reviewMode: 'audio' });
    expect(screen.queryByTestId('settings-scope-radio')).toBeNull();
    fireEvent.click(screen.getByLabelText('separateRadioSettings'));
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      separateRadioSettings: true,
    });
  });

  it('hides the split entirely in Writing mode', () => {
    // Radio is the hands-free face of Shadowing; free play while typing is
    // Free Study, which keeps the writing settings.
    renderSettings({ reviewMode: 'full', separateRadioSettings: true });
    expect(screen.queryByLabelText('separateRadioSettings')).toBeNull();
    expect(screen.queryByTestId('settings-scope-radio')).toBeNull();
  });

  it('switching scope writes nothing: it only selects what to edit', () => {
    renderSettings({ reviewMode: 'audio', separateRadioSettings: true });
    updateSettings.mockClear();
    fireEvent.click(screen.getByTestId('settings-scope-radio'));
    fireEvent.click(screen.getByTestId('settings-scope-review'));
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('a Radio-scope edit writes the *Radio field and never its shared twin', () => {
    inRadioScope({ highlightWords: true });
    fireEvent.click(screen.getByLabelText('highlightWords'));
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      highlightWordsRadio: false,
    });
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('highlightWords');
    expect(payload).not.toHaveProperty('highlightWordsFull');
  });

  it('the same control under the Review scope still writes the shared field', () => {
    renderSettings({
      reviewMode: 'audio',
      separateRadioSettings: true,
      highlightWords: true,
    });
    updateSettings.mockClear();
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWords', false);
    expect(payload).not.toHaveProperty('highlightWordsRadio');
  });

  it('a Radio Practice Listening edit writes the *Radio copy', () => {
    inRadioScope({ playTargetAfterBase: true });
    fireEvent.click(screen.getByLabelText('practiceListening'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('playTargetBeforeBaseRadio', true);
    expect(payload).not.toHaveProperty('playTargetBeforeBase');
  });

  it('seeds the Radio before-group from the RADIO target values', () => {
    // The seed spreads the mode-effective maps, so enabling Listening under
    // Radio must not copy Learn & Review's repetitions in.
    inRadioScope({
      playTargetAfterBase: true,
      languageRepetitions: { es: 4 },
      languageRepetitionsRadio: { es: 1 },
    });
    fireEvent.click(screen.getByLabelText('practiceListening'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.targetBeforeRepetitionsRadio).toEqual({ es: 1 });
    expect(payload).not.toHaveProperty('targetBeforeRepetitions');
  });

  it('hides the rows Radio FORCES, and only those', () => {
    // Auto-play and auto-advance are forced on in radio, so a switch would
    // lie. Everything else stays reachable: the scope pill follows the live
    // session, so hiding a settable row would strand it for anyone who opens
    // settings mid-Radio.
    inRadioScope();
    for (const hidden of ['autoPlay', 'autoAdvance']) {
      expect(screen.queryByLabelText(hidden)).toBeNull();
    }
    // And they come back on the Review side.
    fireEvent.click(screen.getByTestId('settings-scope-review'));
    for (const shown of ['autoPlay', 'autoAdvance']) {
      expect(screen.getByLabelText(shown)).toBeTruthy();
    }
  });

  it('keeps the rows Radio merely ignores reachable under its scope', () => {
    // `instantProceed` is the Shadowing copy either way and `progressDisplay`
    // is one global field with no per-mode copy at all — neither is forked by
    // the Radio split, so neither belongs behind the pill.
    inRadioScope();
    for (const shown of ['instantProceed', 'progressDisplayEnabled']) {
      expect(screen.getByLabelText(shown)).toBeTruthy();
    }
  });

  it("keeps 'Until rated Good' visible under the Radio scope", () => {
    // It was hidden on the theory that radio never rates. Radio PLAYS don't,
    // but the good count a card already carries still graduates it out of
    // Practice Listening, so hiding the row left an inherited 'untilGood'
    // silently in charge with no row shown as selected.
    inRadioScope({ playTargetBeforeBase: true, playTargetAfterBase: true });
    expect(screen.getByTestId('listening-strategy-untilGood')).toBeTruthy();
  });

  it("selecting 'Until rated Good' under Radio writes the *Radio strategy", () => {
    inRadioScope({ playTargetBeforeBase: true, playTargetAfterBase: true });
    fireEvent.click(screen.getByTestId('listening-strategy-untilGood'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty(
      'targetBeforeListeningStrategyRadio',
      'untilGood',
    );
    expect(payload).not.toHaveProperty('targetBeforeListeningStrategy');
  });

  it('promises auto-advance in the Radio timeline even with it switched off', () => {
    // Radio forces auto-advance, and the pause-before-advance stepper is shown
    // unconditionally there, so the end marker has to agree with it.
    inRadioScope({ autoAdvance: false });
    expect(screen.getByText('autoAdvanceIndicator')).toBeTruthy();
    expect(screen.queryByText('noAutoAdvance')).toBeNull();

    fireEvent.click(screen.getByTestId('settings-scope-review'));
    expect(screen.getByText('noAutoAdvance')).toBeTruthy();
  });

  it('previews the Radio values under the Radio scope, review values otherwise', () => {
    const settings: Partial<CourseSettings> = {
      reviewMode: 'audio',
      separateRadioSettings: true,
      languageRepetitions: { en: 4, es: 4 },
      languageRepetitionsRadio: { en: 1, es: 1 },
    };
    renderSettings(settings);
    expect(timelineCards.length).toBeGreaterThan(0);
    expect(timelineCards.every((c) => c.plays === 4)).toBe(true);

    timelineCards.length = 0;
    fireEvent.click(screen.getByTestId('settings-scope-radio'));
    expect(timelineCards.length).toBeGreaterThan(0);
    expect(timelineCards.every((c) => c.plays === 1)).toBe(true);
  });
});

describe('LearningModeSettings: the scope follows the live session', () => {
  beforeEach(() => {
    updateSettings.mockReset().mockResolvedValue(null);
    timelineCards.length = 0;
  });

  const RADIO_SESSION: Partial<CourseSettings> = {
    reviewMode: 'audio',
    separateRadioSettings: true,
    schedulingMode: 'radio',
    highlightWords: true,
  };

  it('opens on the Radio copy during a Radio session', () => {
    // No pill click: the sheet defaults to the copy the session is playing, so
    // the steppers, the preview timeline and the audio behind them agree.
    renderSettings(RADIO_SESSION);
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWordsRadio', false);
    expect(payload).not.toHaveProperty('highlightWords');
  });

  it('previews the Radio values on open during a Radio session', () => {
    renderSettings({
      ...RADIO_SESSION,
      languageRepetitions: { en: 4, es: 4 },
      languageRepetitionsRadio: { en: 1, es: 1 },
    });
    expect(timelineCards.length).toBeGreaterThan(0);
    expect(timelineCards.every((c) => c.plays === 1)).toBe(true);
  });

  it('stays on the shared copy in a Radio session with the split off', () => {
    renderSettings({
      reviewMode: 'audio',
      schedulingMode: 'radio',
      highlightWords: true,
    });
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWords', false);
    expect(payload).not.toHaveProperty('highlightWordsRadio');
  });

  it('opens on the shared copy in a Learn & Review session', () => {
    renderSettings({
      ...RADIO_SESSION,
      schedulingMode: 'learnAndReview',
    });
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWords', false);
    expect(payload).not.toHaveProperty('highlightWordsRadio');
  });

  it('lets the pill override the session scope', () => {
    renderSettings(RADIO_SESSION);
    fireEvent.click(screen.getByTestId('settings-scope-review'));
    updateSettings.mockClear();
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWords', false);
    expect(payload).not.toHaveProperty('highlightWordsRadio');
  });

  it('drops the override when the sheet closes', () => {
    const { setOpen } = renderSettings(RADIO_SESSION);
    fireEvent.click(screen.getByTestId('settings-scope-review'));
    setOpen(false);
    setOpen(true);
    updateSettings.mockClear();
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWordsRadio', false);
  });

  it('hands the scope back to the session when the split is turned off', () => {
    renderSettings(RADIO_SESSION);
    fireEvent.click(screen.getByTestId('settings-scope-review'));
    fireEvent.click(screen.getByLabelText('separateRadioSettings'));
    // The split write is optimistic-only here (courseSettings is a fixture), so
    // the scope is what's under test: it must be back off the stale override.
    updateSettings.mockClear();
    fireEvent.click(screen.getByLabelText('highlightWords'));
    const payload = updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('highlightWordsRadio', false);
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
