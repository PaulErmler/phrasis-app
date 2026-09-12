import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pushMediaSession,
  mediaSessionStackDepthForTests,
  resetMediaSessionForTests,
  setMediaSessionPlaybackState,
  updateMediaSessionPosition,
} from '@/lib/audio/mediaSession';

type Handler = MediaSessionActionHandler | null;

let handlers: Map<string, Handler>;
let session: {
  metadata: { title?: string; artist?: string } | null;
  playbackState: string;
  setActionHandler: (action: string, handler: Handler) => void;
  setPositionState: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  handlers = new Map();
  session = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (action, handler) => {
      handlers.set(action, handler);
    },
    setPositionState: vi.fn(),
  };
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: session,
  });
  (globalThis as { MediaMetadata?: unknown }).MediaMetadata = class {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  };
  resetMediaSessionForTests();
});

afterEach(() => {
  resetMediaSessionForTests();
  delete (navigator as { mediaSession?: unknown }).mediaSession;
  delete (globalThis as { MediaMetadata?: unknown }).MediaMetadata;
});

function registration(name: string, onPlay = vi.fn()) {
  return {
    title: name,
    artist: 'Flexling',
    onPlay,
    onPause: vi.fn(),
    onNextTrack: vi.fn(),
    onPreviousTrack: vi.fn(),
  };
}

describe('pushMediaSession', () => {
  it('registers metadata and handlers, and clears everything when the last one pops', () => {
    const onPlay = vi.fn();
    const handle = pushMediaSession(registration('Card', onPlay));
    expect(session.metadata?.title).toBe('Card');
    handlers.get('play')?.({ action: 'play' });
    expect(onPlay).toHaveBeenCalledTimes(1);
    // No seek callbacks were given, so the scrubber actions are unset.
    expect(handlers.get('seekto')).toBeNull();

    handle.pop();
    expect(session.metadata).toBeNull();
    expect(handlers.get('play')).toBeNull();
    expect(mediaSessionStackDepthForTests()).toBe(0);
  });

  it('a registration on top takes over and popping it restores the one below', () => {
    const cardPlay = vi.fn();
    const celebrationPlay = vi.fn();
    pushMediaSession(registration('Card', cardPlay));
    const celebration = pushMediaSession(
      registration('Milestone', celebrationPlay),
    );
    expect(session.metadata?.title).toBe('Milestone');
    handlers.get('play')?.({ action: 'play' });
    expect(celebrationPlay).toHaveBeenCalledTimes(1);
    expect(cardPlay).not.toHaveBeenCalled();

    celebration.pop();
    // The card player never re-registered; its handlers are simply back.
    expect(session.metadata?.title).toBe('Card');
    handlers.get('play')?.({ action: 'play' });
    expect(cardPlay).toHaveBeenCalledTimes(1);
    expect(celebrationPlay).toHaveBeenCalledTimes(1);
  });

  it('update changes the metadata only while that registration is on top', () => {
    const card = pushMediaSession(registration('Card 1'));
    card.update({ title: 'Card 2', artist: 'Flexling' });
    expect(session.metadata?.title).toBe('Card 2');

    const celebration = pushMediaSession(registration('Milestone'));
    card.update({ title: 'Card 3', artist: 'Flexling' });
    expect(session.metadata?.title).toBe('Milestone');

    celebration.pop();
    expect(session.metadata?.title).toBe('Card 3');
  });

  it('popping a registration that is not on top leaves the top in place', () => {
    const card = pushMediaSession(registration('Card'));
    pushMediaSession(registration('Milestone'));
    card.pop();
    expect(session.metadata?.title).toBe('Milestone');
    expect(mediaSessionStackDepthForTests()).toBe(1);
    // A second pop of the same handle is a no-op.
    card.pop();
    expect(mediaSessionStackDepthForTests()).toBe(1);
  });

  it('wires the seek actions when the registration provides them', () => {
    const onSeekTo = vi.fn();
    const onSeekForward = vi.fn();
    pushMediaSession({ ...registration('Card'), onSeekTo, onSeekForward });
    handlers.get('seekto')?.({ action: 'seekto', seekTime: 12.5 });
    expect(onSeekTo).toHaveBeenCalledWith(12.5);
    handlers.get('seekforward')?.({ action: 'seekforward' });
    expect(onSeekForward).toHaveBeenCalledTimes(1);
    expect(handlers.get('seekbackward')).toBeNull();
  });

  it('push and pop leave playbackState to the element owner', () => {
    setMediaSessionPlaybackState('playing');
    const celebration = pushMediaSession(registration('Milestone'));
    expect(session.playbackState).toBe('playing');
    setMediaSessionPlaybackState('paused');
    celebration.pop();
    expect(session.playbackState).toBe('paused');
  });
});

describe('updateMediaSessionPosition', () => {
  it('clamps the position and skips a non-finite duration', () => {
    updateMediaSessionPosition(10, 12, 1.5);
    expect(session.setPositionState).toHaveBeenCalledWith({
      duration: 10,
      playbackRate: 1.5,
      position: 10,
    });
    session.setPositionState.mockClear();
    updateMediaSessionPosition(NaN, 3);
    updateMediaSessionPosition(0, 0);
    expect(session.setPositionState).not.toHaveBeenCalled();
  });
});
