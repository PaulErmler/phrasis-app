/**
 * Frame-rate playback clock, outside React. The old design stored
 * `audio.currentTime` in React state via a requestAnimationFrame loop, which
 * re-rendered the whole learning-card tree ~60×/second during playback. The
 * clock keeps the high-frequency signal in a subscription: leaves that need
 * per-frame time (karaoke word index) subscribe and update their own local
 * state only when their derived value changes; everything else re-renders at
 * its natural (much lower) cadence.
 *
 * The rAF loop runs only while started (playing) AND at least one subscriber
 * is attached.
 */

export interface PlaybackClock {
  /** Point the clock at the audio element it should read time from. */
  attach(el: HTMLAudioElement | null): void;
  /** Begin ticking (call on play). */
  start(): void;
  /** Stop ticking (call on pause/ended). */
  stop(): void;
  /** Subscribe to time updates; returns an unsubscribe function. */
  subscribe(listener: (timeSec: number) => void): () => void;
  /** Current position in seconds (0 when nothing is attached). */
  getTime(): number;
  /** Push one update to subscribers outside the loop (e.g. paused seeks). */
  notifyOnce(): void;
}

export function createPlaybackClock(): PlaybackClock {
  let el: HTMLAudioElement | null = null;
  let running = false;
  let raf = 0;
  const listeners = new Set<(timeSec: number) => void>();

  const getTime = () => el?.currentTime ?? 0;

  const notify = () => {
    const t = getTime();
    for (const listener of listeners) listener(t);
  };

  const tick = () => {
    raf = 0;
    if (!running || listeners.size === 0) return;
    notify();
    raf = requestAnimationFrame(tick);
  };

  const ensureLoop = () => {
    if (running && listeners.size > 0 && raf === 0) {
      raf = requestAnimationFrame(tick);
    }
  };

  const cancelLoop = () => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  return {
    attach(next) {
      el = next;
    },
    start() {
      running = true;
      ensureLoop();
    },
    stop() {
      running = false;
      cancelLoop();
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureLoop();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) cancelLoop();
      };
    },
    getTime,
    notifyOnce() {
      notify();
    },
  };
}
