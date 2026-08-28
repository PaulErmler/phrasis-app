import { describe, it, expect } from 'vitest';
import { nextHistory } from '@/app/app/onboarding/page';

/**
 * The wizard's Back stack. `placement-test` is the step these tests exist
 * for: it remounts with a fresh adaptive strategy and renders no shared
 * footer, so a user who lands back on it has neither Back nor Continue and
 * must answer the entire test again to escape onboarding.
 *
 * `onPlacementComplete` therefore advances to `review-mode` with
 * `omitFromHistory`. Every other branch into `review-mode` pushes normally,
 * because `cefr-pick` and `proficiency` are both steps a user can leave.
 *
 * The stack holds only steps already left, so omitting means declining to
 * push. Popping instead would drop `proficiency`, the step Back should
 * actually reach — the bug the third test below pins.
 */
describe('nextHistory', () => {
  it('pushes the step being left onto the stack', () => {
    expect(nextHistory(['language-pair'], 'proficiency', false)).toEqual([
      'language-pair',
      'proficiency',
    ]);
  });

  it('leaves the stack untouched when omitting the step being left', () => {
    expect(nextHistory(['proficiency'], 'placement-test', true)).toEqual([
      'proficiency',
    ]);
  });

  it('keeps placement-test off the stack so Back reaches proficiency', () => {
    // The real sequence: … → proficiency → placement-test → review-mode.
    const afterProficiency = nextHistory(
      ['language-pair', 'acquisition'],
      'proficiency',
      false,
    );
    const afterPlacement = nextHistory(
      afterProficiency,
      'placement-test',
      true,
    );

    // Back pops the top of the stack. It must be the step the user can
    // leave, not the test they would have to answer again — and not
    // `acquisition`, which popping the stack would have wrongly exposed.
    expect(afterPlacement[afterPlacement.length - 1]).toBe('proficiency');
    expect(afterPlacement).not.toContain('placement-test');
  });

  it('keeps cefr-pick reachable, since that branch pushes normally', () => {
    const afterProficiency = nextHistory(['acquisition'], 'proficiency', false);
    const afterCefr = nextHistory(afterProficiency, 'cefr-pick', false);

    expect(afterCefr[afterCefr.length - 1]).toBe('cefr-pick');
  });

  it('does not underflow on an empty stack', () => {
    expect(nextHistory([], 'placement-test', true)).toEqual([]);
  });

  it('does not mutate the stack it is given', () => {
    const history = ['language-pair' as const];
    nextHistory(history, 'proficiency', false);
    nextHistory(history, 'proficiency', true);
    expect(history).toEqual(['language-pair']);
  });
});
