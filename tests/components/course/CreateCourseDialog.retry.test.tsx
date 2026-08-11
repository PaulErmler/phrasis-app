import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// cmdk uses ResizeObserver and Element.scrollIntoView; jsdom ships neither.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      StubResizeObserver;
  }
  if (
    typeof window !== 'undefined' &&
    !(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
  ) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      function () {};
  }
});

const createCourse = vi.fn();
const archiveCourse = vi.fn();
const setActiveCourse = vi.fn();
const updateCourseSettings = vi.fn();

vi.mock('convex/react', () => ({
  useMutation: (ref: unknown) => {
    const name = String((ref as { toString(): string })?.toString?.() ?? '');
    if (name.includes('createCourse')) return createCourse;
    if (name.includes('archiveCourse')) return archiveCourse;
    if (name.includes('setActiveCourse')) return setActiveCourse;
    return updateCourseSettings;
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    features: {
      courses: {
        createCourse: 'features/courses:createCourse',
        archiveCourse: 'features/courses:archiveCourse',
        setActiveCourse: 'features/courses:setActiveCourse',
        updateCourseSettings: 'features/courses:updateCourseSettings',
      },
    },
  },
}));

import { CreateCourseDialog } from '@/components/course/CreateCourseDialog';

/**
 * The regression this file exists for: a partially-failed submit (course
 * created and activated, goal write failed) stored the new course id so a
 * retry wouldn't create a duplicate — but the id was remembered without the
 * answers it came from. Going Back, choosing a DIFFERENT language and
 * submitting again then skipped `createCourse` entirely and re-activated the
 * original course: no error, no new course, and the user dropped into a
 * language they had just changed away from.
 */
function renderDialog() {
  // The global test setup stubs next-intl so `t(key)` renders the key itself;
  // every selector below is a testid or a key substring, never copy.
  render(<CreateCourseDialog open onOpenChange={vi.fn()} />);
}

/** Walk the 4-step wizard from step 1 and submit. */
async function completeWizard(
  user: ReturnType<typeof userEvent.setup>,
  { target, base }: { target: string; base: string },
) {
  await user.click(await screen.findByTestId(`language-option-${target}`));
  await user.click(screen.getByTestId('course-dialog-next'));
  await user.click(await screen.findByTestId(`language-option-${base}`));
  await user.click(screen.getByTestId('course-dialog-next'));
  // Difficulty step: pick the first level button.
  await user.click(screen.getByRole('button', { name: /beginner/i }));
  await user.click(screen.getByTestId('course-dialog-next'));
  await user.click(await screen.findByTestId('course-dialog-goal-20'));
  await user.click(screen.getByTestId('course-dialog-create'));
}

/** Step back to the target-language step and switch languages. */
async function goBackAndSwitchTarget(
  user: ReturnType<typeof userEvent.setup>,
  target: string,
) {
  for (let i = 0; i < 3; i++) {
    await user.click(screen.getByTestId('course-dialog-back'));
  }
  await user.click(await screen.findByTestId(`language-option-${target}`));
  for (let i = 0; i < 3; i++) {
    await user.click(screen.getByTestId('course-dialog-next'));
  }
  await user.click(screen.getByTestId('course-dialog-create'));
}

describe('CreateCourseDialog — retry after a partial failure', () => {
  beforeEach(() => {
    createCourse.mockReset();
    archiveCourse.mockReset();
    setActiveCourse.mockReset();
    updateCourseSettings.mockReset();
    createCourse.mockResolvedValue({ courseId: 'course_es' });
    archiveCourse.mockResolvedValue(null);
    setActiveCourse.mockResolvedValue(undefined);
  });

  it('reuses the created course when the answers are unchanged (no duplicate)', async () => {
    const user = userEvent.setup();
    // Goal write fails once, then succeeds on retry.
    updateCourseSettings
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);

    renderDialog();
    await completeWizard(user, { target: 'es', base: 'en' });
    await waitFor(() => expect(updateCourseSettings).toHaveBeenCalledTimes(1));
    expect(createCourse).toHaveBeenCalledTimes(1);

    // Retry without touching the form.
    await user.click(screen.getByTestId('course-dialog-create'));
    await waitFor(() => expect(updateCourseSettings).toHaveBeenCalledTimes(2));

    // The course is reused, not created twice.
    expect(createCourse).toHaveBeenCalledTimes(1);
    expect(updateCourseSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ courseId: 'course_es' }),
    );
  });

  it('creates a NEW course when the user changes the language before retrying', async () => {
    const user = userEvent.setup();
    updateCourseSettings
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    createCourse
      .mockResolvedValueOnce({ courseId: 'course_es' })
      .mockResolvedValueOnce({ courseId: 'course_fr' });

    renderDialog();
    await completeWizard(user, { target: 'es', base: 'en' });
    await waitFor(() => expect(updateCourseSettings).toHaveBeenCalledTimes(1));
    expect(createCourse).toHaveBeenCalledTimes(1);

    await goBackAndSwitchTarget(user, 'fr');
    await waitFor(() => expect(updateCourseSettings).toHaveBeenCalledTimes(2));

    // The French course must actually be created and activated — not the
    // Spanish one silently reused.
    expect(createCourse).toHaveBeenCalledTimes(2);
    expect(createCourse).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetLanguages: ['fr'] }),
    );
    expect(setActiveCourse).toHaveBeenLastCalledWith({ courseId: 'course_fr' });
    expect(updateCourseSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ courseId: 'course_fr' }),
    );
    // The abandoned Spanish course releases its slot — on the single-course
    // free tier the second create would otherwise die on USAGE_LIMIT.
    expect(archiveCourse).toHaveBeenCalledWith({ courseId: 'course_es' });
  });

  it('activates the course on every attempt so a goal-only retry still lands', async () => {
    const user = userEvent.setup();
    updateCourseSettings
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);

    renderDialog();
    await completeWizard(user, { target: 'es', base: 'en' });
    await waitFor(() => expect(updateCourseSettings).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId('course-dialog-create'));
    await waitFor(() => expect(updateCourseSettings).toHaveBeenCalledTimes(2));

    expect(setActiveCourse).toHaveBeenCalledTimes(2);
    expect(setActiveCourse).toHaveBeenLastCalledWith({ courseId: 'course_es' });
  });
});
