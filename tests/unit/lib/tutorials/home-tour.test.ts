import { describe, it, expect } from 'vitest';
import { createHomeTour } from '@/lib/tutorials/home-tour';

/**
 * The home tour's third start button is mode-dependent: Shadowing shows
 * Radio, Writing shows Free Study. `StartLearningButton` picks the button's
 * `data-tutorial` anchor from `courseSettings.reviewMode`, and this factory
 * picks the matching step + copy from the same value, so the two must
 * agree, or the step highlights an element that isn't on screen and
 * silently degrades to a centered popover with the wrong description.
 *
 * The anchors asserted here are the literal strings
 * `components/app/StartLearningButton.tsx` renders.
 */

const t = ((key: string) => key) as Parameters<typeof createHomeTour>[0];

const elementsOf = (ctx?: Parameters<typeof createHomeTour>[1]) =>
  createHomeTour(t, ctx).steps.map((s) => s.element);

const titlesOf = (ctx?: Parameters<typeof createHomeTour>[1]) =>
  createHomeTour(t, ctx).steps.map((s) => s.popover?.title);

describe('createHomeTour: mode-dependent free-play step', () => {
  it('anchors Radio and uses radio copy in Shadowing', () => {
    const ctx = { reviewMode: 'audio' as const };
    expect(elementsOf(ctx)).toContain('[data-tutorial="radio-mode"]');
    expect(elementsOf(ctx)).not.toContain('[data-tutorial="free-study-mode"]');
    expect(titlesOf(ctx)).toContain('home.radioMode.title');
    expect(titlesOf(ctx)).not.toContain('home.freeStudyMode.title');
  });

  it('anchors Free Study and uses free-study copy in Writing', () => {
    const ctx = { reviewMode: 'full' as const };
    expect(elementsOf(ctx)).toContain('[data-tutorial="free-study-mode"]');
    expect(elementsOf(ctx)).not.toContain('[data-tutorial="radio-mode"]');
    expect(titlesOf(ctx)).toContain('home.freeStudyMode.title');
    expect(titlesOf(ctx)).not.toContain('home.radioMode.title');
  });

  it('falls back to the Radio step when no context is supplied', () => {
    // HomeView always passes context; this is the defensive default for any
    // other caller (and for a restart before settings resolve).
    expect(elementsOf()).toContain('[data-tutorial="radio-mode"]');
  });

  it('swaps exactly one step, the rest of the tour is identical', () => {
    const audio = elementsOf({ reviewMode: 'audio' });
    const full = elementsOf({ reviewMode: 'full' });
    expect(audio).toHaveLength(full.length);
    const differing = audio.filter((el, i) => el !== full[i]);
    expect(differing).toEqual(['[data-tutorial="radio-mode"]']);
  });
});

describe('createHomeTour: due-counts step', () => {
  it('includes the due-counts step when counts are visible', () => {
    expect(elementsOf({ reviewMode: 'audio' })).toContain(
      '[data-tutorial="due-counts"]',
    );
  });

  it('omits the due-counts step when the user hides remaining reviews', () => {
    const elements = elementsOf({
      reviewMode: 'audio',
      hideDueCounts: true,
    });
    expect(elements).not.toContain('[data-tutorial="due-counts"]');
    expect(elements).toContain('[data-tutorial="projections"]');
  });
});

describe('createHomeTour: workload step', () => {
  it('follows the projections step (monotonic scroll)', () => {
    const tour = createHomeTour(t, { reviewMode: 'audio' });
    const elements = tour.steps.map((s) => s.element);
    const workloadIdx = elements.indexOf('[data-tutorial="workload-forecast"]');
    // The card renders below the chat input (after the progress card),
    // whose two steps must both come first or the tour scrolls down and
    // back up.
    expect(workloadIdx).toBeGreaterThan(
      elements.indexOf('[data-tutorial="projections"]'),
    );
    // Whether the step is dropped when the card isn't mounted at launch is
    // behavior of the launcher, asserted in use-tutorial.test.tsx
    // ('drops the workload step…'), not restated against the config here.
  });

  it('is gated by its own preference, not the pills preference', () => {
    expect(
      elementsOf({ reviewMode: 'audio', hideWorkloadForecast: true }),
    ).not.toContain('[data-tutorial="workload-forecast"]');
    // hideDueCounts alone leaves the forecast step in: the two opt-ins
    // are independent.
    const pillsHidden = elementsOf({
      reviewMode: 'audio',
      hideDueCounts: true,
    });
    expect(pillsHidden).not.toContain('[data-tutorial="due-counts"]');
    expect(pillsHidden).toContain('[data-tutorial="workload-forecast"]');
  });
});
