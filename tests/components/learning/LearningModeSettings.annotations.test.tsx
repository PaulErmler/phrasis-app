import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * The per-language reading-aid section: tabs plus tappable language chips.
 *
 * What matters here is the WRITE each gesture produces, because the stored
 * `annotationOverrides` record is what the content sweep reads to decide what
 * to generate. A chip that wrote the wrong shape would show a line the sweep
 * never fills, or pay for a gloss nothing renders.
 */

const updateSettings = vi.fn();

vi.mock('convex/react', () => ({
  useMutation: () =>
    Object.assign(updateSettings, {
      withOptimisticUpdate: () => updateSettings,
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

function renderSettings(
  baseLanguages: string[],
  targetLanguages: string[],
  extra: Partial<CourseSettings> = {},
) {
  updateSettings.mockClear();
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={
        {
          courseId: 'course_1' as Id<'courses'>,
          reviewMode: 'full',
          ...extra,
        } as CourseSettings
      }
      baseLanguages={baseLanguages}
      targetLanguages={targetLanguages}
    />,
  );
}

/** The fields of the most recent settings write. */
const lastWrite = () =>
  updateSettings.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

describe('reading aids: the gloss row', () => {
  it('is offered for a target language that differs from the base', () => {
    renderSettings(['en'], ['ru']);
    expect(screen.getByLabelText('showHyperliteral')).toBeInTheDocument();
  });

  it('reads OFF for a course whose settings row never mentioned it', () => {
    // An old course. The gloss costs a model call per sentence, so silence
    // must not read as consent; a new course carries an explicit `true`
    // instead (NEW_COURSE_SETTINGS_DEFAULTS).
    renderSettings(['en'], ['ru']);
    expect(screen.getByLabelText('showHyperliteral')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText('showIpa')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('reads ON for a course carrying the stamped default', () => {
    renderSettings(['en'], ['ru'], { showHyperliteral: true });
    expect(screen.getByLabelText('showHyperliteral')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('is not offered when every course language is the gloss language', () => {
    renderSettings(['en'], ['en_gb']);
    expect(screen.queryByLabelText('showHyperliteral')).toBeNull();
  });
});

describe('reading aids: per-language exceptions', () => {
  it('a chip tap writes one override and leaves the course switch alone', async () => {
    const user = userEvent.setup();
    renderSettings(['en'], ['ja', 'ko'], { showRomanization: true });
    await user.click(screen.getByTestId('chip-romanization-ko'));
    expect(lastWrite()).toMatchObject({
      annotationOverrides: { ko: { romanization: false } },
    });
    expect(lastWrite()).not.toHaveProperty('showRomanization');
  });

  it('a chip tapped back to the course value leaves no override behind', async () => {
    const user = userEvent.setup();
    renderSettings(['en'], ['ja', 'ko'], {
      showRomanization: true,
      annotationOverrides: { ko: { romanization: false } },
    } as Partial<CourseSettings>);
    await user.click(screen.getByTestId('chip-romanization-ko'));
    expect(lastWrite()?.annotationOverrides).toEqual({});
  });

  it('the row switch sets the course value AND clears that aid exceptions', async () => {
    const user = userEvent.setup();
    renderSettings(['en'], ['ja', 'ko'], {
      showRomanization: true,
      annotationOverrides: { ko: { romanization: false, ipa: true } },
    } as Partial<CourseSettings>);
    await user.click(screen.getByLabelText('showRomanization'));
    expect(lastWrite()).toMatchObject({
      showRomanization: false,
      // The IPA exception survives; only romanization's is cleared.
      annotationOverrides: { ko: { ipa: true } },
    });
  });

  it('shows how many exceptions an aid has', () => {
    renderSettings(['en'], ['ja', 'ko'], {
      showRomanization: true,
      annotationOverrides: { ko: { romanization: false } },
    } as Partial<CourseSettings>);
    expect(screen.getByText('annotationExceptions')).toBeInTheDocument();
  });

  it('a chip reflects the resolved value, not the course value', () => {
    renderSettings(['en'], ['ja', 'ko'], {
      showRomanization: true,
      annotationOverrides: { ko: { romanization: false } },
    } as Partial<CourseSettings>);
    expect(screen.getByTestId('chip-romanization-ja')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('chip-romanization-ko')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('reading aids: language tabs', () => {
  it('offers a tab per language that has an aid', () => {
    renderSettings(['en'], ['ja', 'ko']);
    expect(
      screen.getByRole('tab', { name: 'annotationsAllTab' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Japanese' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Korean' })).toBeInTheDocument();
  });

  it('a language tab shows only that language aids', async () => {
    const user = userEvent.setup();
    renderSettings(['en'], ['ja', 'ko']);
    await user.click(screen.getByRole('tab', { name: 'Korean' }));
    // Furigana is Japanese-only, so it must not appear under Korean.
    expect(screen.queryByLabelText('showFurigana-ko')).toBeNull();
    expect(screen.getByLabelText('showRomanization-ko')).toBeInTheDocument();
  });

  it('marks a language as following the course until it has its own setting', async () => {
    const user = userEvent.setup();
    renderSettings(['en'], ['ja', 'ko'], {
      showRomanization: true,
      annotationOverrides: { ko: { romanization: false } },
    } as Partial<CourseSettings>);
    await user.click(screen.getByRole('tab', { name: 'Korean' }));
    expect(screen.getAllByText('annotationOwnSetting').length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText('annotationFollowsCourse').length,
    ).toBeGreaterThan(0);
  });

  it('sends a language back to following the course', async () => {
    const user = userEvent.setup();
    renderSettings(['en'], ['ja', 'ko'], {
      showRomanization: true,
      annotationOverrides: { ko: { romanization: false } },
    } as Partial<CourseSettings>);
    await user.click(screen.getByRole('tab', { name: 'Korean' }));
    await user.click(screen.getByText('annotationFollowCourseAgain'));
    expect(lastWrite()?.annotationOverrides).toEqual({});
  });
});
