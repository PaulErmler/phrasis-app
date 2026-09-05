import { describe, it, expect } from 'vitest';
import { togglePriorApp } from '@/app/app/onboarding/lib/togglePriorApp';

/**
 * The prior-apps step is multi-select, but "none of these" can't coexist with
 * a named app. These tests pin that exclusivity so the wizard's toggle
 * handler can't drift back into a plain push/filter.
 */
describe('togglePriorApp', () => {
  it('adds an app that is not selected yet', () => {
    expect(togglePriorApp(['anki'], 'duolingo')).toEqual(['anki', 'duolingo']);
  });

  it('removes an app that is already selected', () => {
    expect(togglePriorApp(['anki', 'duolingo'], 'anki')).toEqual(['duolingo']);
  });

  it('picking "none" clears every other answer', () => {
    expect(togglePriorApp(['anki', 'babbel', 'other'], 'none')).toEqual([
      'none',
    ]);
  });

  it('picking an app drops a previously selected "none"', () => {
    expect(togglePriorApp(['none'], 'glossika')).toEqual(['glossika']);
  });

  it('deselecting "none" leaves an empty selection', () => {
    expect(togglePriorApp(['none'], 'none')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const selected = ['anki', 'none'] as const;
    togglePriorApp(selected, 'babbel');
    expect(selected).toEqual(['anki', 'none']);
  });
});
