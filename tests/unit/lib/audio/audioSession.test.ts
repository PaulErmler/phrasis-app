import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  declareAudioSessionType,
  observeAudioSessionState,
  resetAudioSessionForTests,
  type AudioSessionState,
  type AudioSessionType,
} from '@/lib/audio/audioSession';
import { installAudioGestureUnlock } from '@/lib/audio/gestureUnlock';
import {
  isCardPlayerUnlocked,
  resetCardPlayerElementForTests,
} from '@/lib/audio/cardPlayerElement';
import { resetCelebrationSoundForTests } from '@/lib/audio/celebrationSound';

vi.mock('@/lib/posthog/events', () => ({
  capture: vi.fn(),
  CLIENT_EVENTS: { AUDIO_SESSION_STATE: 'audio_session_state' },
}));

class FakeAudioSession extends EventTarget {
  typeWrites: AudioSessionType[] = [];
  private _type: AudioSessionType = 'auto';
  state: AudioSessionState = 'active';
  get type() {
    return this._type;
  }
  set type(value: AudioSessionType) {
    this._type = value;
    this.typeWrites.push(value);
  }
}

let fake: FakeAudioSession;

beforeEach(() => {
  resetAudioSessionForTests();
  resetCardPlayerElementForTests();
  resetCelebrationSoundForTests();
  fake = new FakeAudioSession();
});

afterEach(() => {
  delete (navigator as { audioSession?: unknown }).audioSession;
});

function installFake() {
  Object.defineProperty(navigator, 'audioSession', {
    configurable: true,
    value: fake,
  });
}

describe('audioSession', () => {
  it('is a no-op where the API is missing', () => {
    expect(declareAudioSessionType()).toBe(false);
    const listener = vi.fn();
    expect(() => observeAudioSessionState(listener)()).not.toThrow();
  });

  it('declares playback exactly once', () => {
    installFake();
    expect(declareAudioSessionType()).toBe(true);
    expect(declareAudioSessionType()).toBe(true);
    expect(fake.type).toBe('playback');
    expect(fake.typeWrites).toEqual(['playback']);
  });

  it('reports state changes until unsubscribed', () => {
    installFake();
    const listener = vi.fn();
    const stop = observeAudioSessionState(listener);
    fake.state = 'interrupted';
    fake.dispatchEvent(new Event('statechange'));
    expect(listener).toHaveBeenCalledWith('interrupted');
    stop();
    fake.dispatchEvent(new Event('statechange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('installAudioGestureUnlock', () => {
  it('declares the session and unlocks the card element on the first gesture, then stops listening', () => {
    installFake();
    const teardown = installAudioGestureUnlock();
    expect(isCardPlayerUnlocked()).toBe(false);

    window.dispatchEvent(new Event('click'));
    expect(fake.typeWrites).toEqual(['playback']);
    expect(isCardPlayerUnlocked()).toBe(true);

    window.dispatchEvent(new Event('touchend'));
    expect(fake.typeWrites).toEqual(['playback']);
    teardown();
  });
});
