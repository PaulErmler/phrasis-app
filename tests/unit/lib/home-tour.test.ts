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
