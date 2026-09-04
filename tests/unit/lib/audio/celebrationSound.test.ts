import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCelebrationSound,
  installCelebrationSoundUnlock,
  isCelebrationSoundUnlocked,
  playCelebrationSound,
  resetCelebrationSoundForTests,
  stopCelebrationSound,
} from '@/lib/audio/celebrationSound';

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = '';
  paused = true;
  currentTime = 5;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  playImpl: () => Promise<void> = () => Promise.resolve();
  constructor(public src: string) {
    super();
    FakeAudio.instances.push(this);
  }
  play() {
    this.playCalls++;
    this.paused = false;
    return this.playImpl();
  }
  pause() {
    this.pauseCalls++;
    this.paused = true;
  }
  load() {
    this.loadCalls++;
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  resetCelebrationSoundForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('celebrationSound', () => {
  it('reuses one element across celebrations', () => {
    const a = getCelebrationSound();
    const b = getCelebrationSound();
    expect(a).toBe(b);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe('/sounds/progress-success.mp3');
  });

  it('unlocks on the first gesture with a silent play+pause and then stops listening', () => {
    const teardown = installCelebrationSoundUnlock();
    const el = FakeAudio.instances[0];
    expect(isCelebrationSoundUnlocked()).toBe(false);

    window.dispatchEvent(new Event('click'));
    expect(isCelebrationSoundUnlocked()).toBe(true);
    expect(el.playCalls).toBe(1);
    expect(el.pauseCalls).toBe(1);
    expect(el.paused).toBe(true);

    window.dispatchEvent(new Event('click'));
    expect(el.playCalls).toBe(1);
    teardown();
  });

  it('does not interrupt a celebration already playing when the unlock gesture lands', () => {
    installCelebrationSoundUnlock();
    const el = FakeAudio.instances[0];
    void playCelebrationSound();
    expect(el.paused).toBe(false);

    window.dispatchEvent(new Event('touchend'));
    expect(el.pauseCalls).toBe(0);
    expect(isCelebrationSoundUnlocked()).toBe(true);
  });

  it('rewinds before playing and resolves once playback starts', async () => {
    const { element, started } = playCelebrationSound();
    const el = FakeAudio.instances[0];
    expect(element).toBe(el);
    expect(el.currentTime).toBe(0);
    await expect(started).resolves.toBeUndefined();
  });

  it('resolves on the playing event when the play promise is slow', async () => {
    getCelebrationSound();
    const el = FakeAudio.instances[0];
    el.playImpl = () => new Promise(() => {});
    const { started } = playCelebrationSound();
    el.dispatchEvent(new Event('playing'));
    await expect(started).resolves.toBeUndefined();
  });

  it('rejects when the browser refuses to play', async () => {
    getCelebrationSound();
    const el = FakeAudio.instances[0];
    const err = Object.assign(new Error('blocked'), {
      name: 'NotAllowedError',
    });
    el.playImpl = () => Promise.reject(err);
    const { started } = playCelebrationSound();
    await expect(started).rejects.toBe(err);
  });

  it('stop pauses and rewinds', () => {
    void playCelebrationSound();
    const el = FakeAudio.instances[0];
    el.currentTime = 2;
    stopCelebrationSound();
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBe(0);
  });
});
