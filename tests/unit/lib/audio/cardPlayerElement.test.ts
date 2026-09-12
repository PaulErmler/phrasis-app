import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCardPlayerElement,
  isCardPlayerUnlocked,
  resetCardPlayerElementForTests,
  unlockCardPlayerElement,
} from '@/lib/audio/cardPlayerElement';

const SILENCE_URL = 'blob:silence';
vi.mock('@/lib/audio/silence', () => ({
  getSilenceBlobUrl: () => SILENCE_URL,
}));

/**
 * `play` / `pause` are mocked on the prototype by tests/setup.ts, shared by
 * every element. Give each fresh element its own mocks so call counts stay
 * per test.
 */
function freshElement() {
  resetCardPlayerElementForTests();
  const el = getCardPlayerElement();
  let mutedDuringPlay: boolean | null = null;
  const play = vi.fn(function (this: HTMLAudioElement) {
    mutedDuringPlay = this.muted;
    return Promise.reject(new DOMException('interrupted', 'AbortError'));
  });
  const pause = vi.fn();
  el.play = play;
  el.pause = pause;
  return { el, play, pause, mutedDuringPlay: () => mutedDuringPlay };
}

beforeEach(() => {
  resetCardPlayerElementForTests();
});

describe('cardPlayerElement', () => {
  it('is one element for the page', () => {
    const a = getCardPlayerElement();
    const b = getCardPlayerElement();
    expect(a).toBe(b);
    expect(a.preservesPitch).toBe(true);
  });

  it('unlocks an empty element with a muted play + pause and restores muted', () => {
    const { el, play, pause, mutedDuringPlay } = freshElement();

    expect(isCardPlayerUnlocked()).toBe(false);
    expect(unlockCardPlayerElement()).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(mutedDuringPlay()).toBe(true);
    expect(el.muted).toBe(false);
    expect(isCardPlayerUnlocked()).toBe(true);

    // Idempotent: a second gesture does nothing.
    expect(unlockCardPlayerElement()).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('skips an element holding a card, paused: a play there would be audible', () => {
    const { el, play } = freshElement();
    el.src = 'blob:card';
    expect(unlockCardPlayerElement()).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(isCardPlayerUnlocked()).toBe(false);
  });

  it('treats a silence-parked element like an empty one', () => {
    const { el, play } = freshElement();
    el.src = SILENCE_URL;
    expect(unlockCardPlayerElement()).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('marks an element already playing as unlocked without touching it', () => {
    const { el, play } = freshElement();
    Object.defineProperty(el, 'paused', {
      configurable: true,
      get: () => false,
    });
    expect(unlockCardPlayerElement()).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(isCardPlayerUnlocked()).toBe(true);
  });
});
