import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type {
  MergeResult,
  ResolvedAudioSettings,
} from '@/lib/audio/mergeAudio';
import type { CardAudioRecording } from '@/components/app/learning/types';

const mergeCardAudioMock = vi.fn();

vi.mock('@/lib/audio/mergeAudio', () => ({
  mergeCardAudio: (...args: unknown[]) => mergeCardAudioMock(...args),
}));

import {
  useAudioPlayer,
  type UseAudioPlayerOptions,
} from '@/hooks/use-audio-player';

// jsdom reports readyState 0 and never fires loadedmetadata; force HAVE_METADATA
// so the hook's post-merge start logic runs synchronously after `audio.src =`.
Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', {
  configurable: true,
  get: () => 1,
});

// jsdom pins currentTime at 0 and ignores writes; back it with a real field so
// tests can drive the timeline that the reveal logic reads.
let mediaCurrentTime = 0;
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  get: () => mediaCurrentTime,
  set: (v: number) => {
    mediaCurrentTime = v;
  },
});

let objectUrlSeq = 0;
const createObjectURLMock = vi.fn(() => `blob:mock-${++objectUrlSeq}`);
const revokeObjectURLMock = vi.fn();
URL.createObjectURL = createObjectURLMock;
URL.revokeObjectURL = revokeObjectURLMock;

const playMock = vi.fn<() => Promise<void>>();

type PendingMerge = {
  recordings: CardAudioRecording[];
  signal: AbortSignal;
  resolve: (result: MergeResult | null) => void;
};
let pendingMerges: PendingMerge[] = [];

const SETTINGS: ResolvedAudioSettings = {
  reps: { es: 1 },
  repPauses: { es: 0 },
  speeds: { es: 1 },
  defaultTargetReps: 1,
  pauseB2B: 0,
  pauseB2T: 0,
  pauseT2T: 0,
  autoAdvance: false,
  pauseBeforeAdvance: 0,
  playTargetBefore: false,
  playTargetAfter: true,
  beforeReps: {},
  beforeRepPauses: {},
  beforeSpeeds: {},
  pauseT2B: 0,
  beforeOnlyNewReps: Infinity,
  listeningStrategy: 'continuous',
  beforeUntilGoodReps: 1,
};

function rec(
  language: string,
  voiceName: string,
  url: string | null = `https://cdn.test/${language}/${voiceName}.mp3`,
): CardAudioRecording {
  return {
    language,
    voiceName,
    url,
    wordTimings: null,
    ttsQuality: 'validated',
  };
}

function makeResult(overrides: Partial<MergeResult> = {}): MergeResult {
  return {
    blobUrl: URL.createObjectURL(new Blob()),
    durationSec: 3,
    languageCues: [],
    speedByLanguage: { en: 1, es: 1 },
    ...overrides,
  };
}

function baseOptions(
  overrides: Partial<UseAudioPlayerOptions> = {},
): UseAudioPlayerOptions {
  return {
    cardId: 'card-1',
    audioRecordings: [rec('en', 'en-A'), rec('es', 'es-A')],
    nextCard: null,
    settings: SETTINGS,
    orderedBase: ['en'],
    orderedTarget: ['es'],
    sourceText: 'Hello',
    languageNames: 'English, Spanish',
    autoPlay: false,
    settingsOpen: false,
    getReviewInitiatedByThisTab: () => false,
    onScheduleComplete: () => false,
    onResetReviewFlag: () => {},
    onNext: () => {},
    ...overrides,
  };
}

function renderPlayer(overrides: Partial<UseAudioPlayerOptions> = {}) {
  return renderHook((props: UseAudioPlayerOptions) => useAudioPlayer(props), {
    initialProps: baseOptions(overrides),
  });
}

async function resolveMerge(index: number, result: MergeResult) {
  await act(async () => {
    pendingMerges[index].resolve(result);
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

const revokeCallsFor = (url: string) =>
  revokeObjectURLMock.mock.calls.filter(([u]) => u === url).length;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('useAudioPlayer', () => {
  beforeEach(() => {
    pendingMerges = [];
    objectUrlSeq = 0;
    mediaCurrentTime = 0;
    mergeCardAudioMock.mockReset();
    mergeCardAudioMock.mockImplementation(
      (recordings: CardAudioRecording[], _b, _t, _s, signal: AbortSignal) =>
        new Promise<MergeResult | null>((resolve) => {
          pendingMerges.push({ recordings, signal, resolve });
        }),
    );
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
    playMock.mockReset();
    playMock.mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.play = playMock;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('play() rejection guard', () => {
    it('is a no-op while no source is loaded', () => {
      const { result } = renderPlayer();
      act(() => result.current.play());
      expect(playMock).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });

    it('swallows an AbortError rejection silently and leaves isPlaying false', async () => {
      const { result } = renderPlayer();
      await resolveMerge(0, makeResult());
      playMock.mockRejectedValueOnce(
        new DOMException('play() interrupted', 'AbortError'),
      );
      await act(async () => {
        result.current.play();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(result.current.isPlaying).toBe(false);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('swallows a NotAllowedError rejection silently and leaves isPlaying false', async () => {
      const { result } = renderPlayer();
      await resolveMerge(0, makeResult());
      playMock.mockRejectedValueOnce(
        new DOMException('autoplay blocked', 'NotAllowedError'),
      );
      await act(async () => {
        result.current.play();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.isPlaying).toBe(false);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('logs any other rejection via console.error and leaves isPlaying false', async () => {
      const { result } = renderPlayer();
      await resolveMerge(0, makeResult());
      playMock.mockRejectedValueOnce(
        new DOMException('decode failure', 'NotSupportedError'),
      );
      await act(async () => {
        result.current.play();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      // reportError's console signature: (error, context).
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'NotSupportedError' }),
        { op: 'audioPlay', label: 'Audio play failed:' },
      );
      expect(result.current.isPlaying).toBe(false);
    });

    it('sets isPlaying true when play() resolves', async () => {
      const { result } = renderPlayer();
      await resolveMerge(0, makeResult());
      await act(async () => {
        result.current.play();
        await Promise.resolve();
      });
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(result.current.isPlaying).toBe(true);
    });
  });

  describe('prefetch cache', () => {
    const nextRecordings = [rec('en', 'en-B'), rec('es', 'es-B')];

    it('advancing to the prefetched card reuses the cached blob: one merge and one object URL for that card', async () => {
      const { result, rerender, unmount } = renderPlayer();
      const r1 = await resolveMerge(0, makeResult({ durationSec: 3 }));

      rerender(
        baseOptions({
          nextCard: { cardId: 'card-2', audioRecordings: nextRecordings },
        }),
      );
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      expect(pendingMerges[1].recordings).toBe(nextRecordings);
      const r2 = await resolveMerge(1, makeResult({ durationSec: 7 }));

      rerender(
        baseOptions({
          cardId: 'card-2',
          audioRecordings: nextRecordings,
          nextCard: null,
        }),
      );

      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
      expect(result.current.audioRef.current?.src).toBe(r2.blobUrl);
      expect(result.current.durationSec).toBe(7);
      expect(result.current.isMerging).toBe(false);
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
      expect(revokeCallsFor(r2.blobUrl)).toBe(0);

      unmount();
      expect(revokeCallsFor(r2.blobUrl)).toBe(1);
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
    });

    it('requesting the same next card again does not trigger a second merge', async () => {
      const { rerender } = renderPlayer();
      await resolveMerge(0, makeResult());

      rerender(
        baseOptions({
          nextCard: { cardId: 'card-2', audioRecordings: nextRecordings },
        }),
      );
      await resolveMerge(1, makeResult());
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);

      rerender(
        baseOptions({
          nextCard: {
            cardId: 'card-2',
            audioRecordings: nextRecordings.map((r) => ({ ...r })),
          },
        }),
      );
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
    });

    it('revokes an unconsumed prefetched blob exactly once on unmount', async () => {
      const { rerender, unmount } = renderPlayer();
      const r1 = await resolveMerge(0, makeResult());

      rerender(
        baseOptions({
          nextCard: { cardId: 'card-2', audioRecordings: nextRecordings },
        }),
      );
      const r2 = await resolveMerge(1, makeResult());

      unmount();
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
      expect(revokeCallsFor(r2.blobUrl)).toBe(1);
    });

    it('evicts the oldest entry beyond two and revokes its blob exactly once', async () => {
      const { rerender, unmount } = renderPlayer();
      const r1 = await resolveMerge(0, makeResult());

      rerender(
        baseOptions({
          nextCard: {
            cardId: 'card-2',
            audioRecordings: [rec('en', 'en-2'), rec('es', 'es-2')],
          },
        }),
      );
      const r2 = await resolveMerge(1, makeResult());

      rerender(
        baseOptions({
          nextCard: {
            cardId: 'card-3',
            audioRecordings: [rec('en', 'en-3'), rec('es', 'es-3')],
          },
        }),
      );
      const r3 = await resolveMerge(2, makeResult());
      expect(revokeObjectURLMock).not.toHaveBeenCalled();

      rerender(
        baseOptions({
          nextCard: {
            cardId: 'card-4',
            audioRecordings: [rec('en', 'en-4'), rec('es', 'es-4')],
          },
        }),
      );
      const r4 = await resolveMerge(3, makeResult());

      expect(revokeCallsFor(r2.blobUrl)).toBe(1);
      expect(revokeCallsFor(r3.blobUrl)).toBe(0);
      expect(revokeCallsFor(r4.blobUrl)).toBe(0);

      unmount();
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
      expect(revokeCallsFor(r2.blobUrl)).toBe(1);
      expect(revokeCallsFor(r3.blobUrl)).toBe(1);
      expect(revokeCallsFor(r4.blobUrl)).toBe(1);
    });

    it('defers the prefetch until the current card has finished merging', async () => {
      const { result, rerender } = renderPlayer({
        nextCard: { cardId: 'card-2', audioRecordings: nextRecordings },
      });

      // Mount: only the current card's merge runs. The prefetch effect reads
      // the synchronous isMerging mirror, so it does not start a merge it
      // would immediately have to abort.
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(1);

      // Once the current merge lands, the prefetch for card-2 kicks off.
      await resolveMerge(0, makeResult());
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      expect(pendingMerges[1].signal.aborted).toBe(false);

      const r2 = await resolveMerge(1, makeResult());
      rerender(
        baseOptions({
          cardId: 'card-2',
          audioRecordings: nextRecordings,
          nextCard: null,
        }),
      );
      // Advancing adopts the prefetched blob instead of merging again.
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      expect(result.current.audioRef.current?.src).toBe(r2.blobUrl);
    });
  });

  describe('audio identity key', () => {
    it('a voice change on the current card triggers a remerge and revokes the previous blob', async () => {
      const { result, rerender } = renderPlayer();
      const r1 = await resolveMerge(0, makeResult({ durationSec: 3 }));
      expect(result.current.audioRef.current?.src).toBe(r1.blobUrl);

      rerender(
        baseOptions({
          audioRecordings: [rec('en', 'en-A'), rec('es', 'es-Z')],
        }),
      );
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      const r2 = await resolveMerge(1, makeResult({ durationSec: 5 }));

      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
      expect(result.current.audioRef.current?.src).toBe(r2.blobUrl);
      expect(result.current.durationSec).toBe(5);
    });

    it('a signed-URL refresh with unchanged identity does not remerge', async () => {
      const { result, rerender } = renderPlayer();
      const r1 = await resolveMerge(0, makeResult());

      rerender(
        baseOptions({
          audioRecordings: [
            rec('en', 'en-A', 'https://cdn.test/en/en-A.mp3?sig=refreshed'),
            rec('es', 'es-A', 'https://cdn.test/es/es-A.mp3?sig=refreshed'),
          ],
        }),
      );

      expect(mergeCardAudioMock).toHaveBeenCalledTimes(1);
      expect(result.current.audioRef.current?.src).toBe(r1.blobUrl);
      expect(revokeObjectURLMock).not.toHaveBeenCalled();
    });

    it('a cached prefetch whose identity no longer matches is not served on advance', async () => {
      const prefetchedRecordings = [rec('en', 'en-B'), rec('es', 'es-B')];
      const { result, rerender, unmount } = renderPlayer();
      const r1 = await resolveMerge(0, makeResult());

      rerender(
        baseOptions({
          nextCard: { cardId: 'card-2', audioRecordings: prefetchedRecordings },
        }),
      );
      const r2 = await resolveMerge(1, makeResult());

      // Voice swapped between prefetch and advance → identity key mismatch.
      const advancedRecordings = [rec('en', 'en-B'), rec('es', 'es-C')];
      rerender(
        baseOptions({
          cardId: 'card-2',
          audioRecordings: advancedRecordings,
          nextCard: null,
        }),
      );

      expect(mergeCardAudioMock).toHaveBeenCalledTimes(3);
      expect(pendingMerges[2].recordings).toBe(advancedRecordings);
      const r3 = await resolveMerge(2, makeResult());

      expect(result.current.audioRef.current?.src).toBe(r3.blobUrl);
      expect(result.current.audioRef.current?.src).not.toBe(r2.blobUrl);
      // The stale entry stays cached (bounded to 2, cleaned on unmount).
      expect(revokeCallsFor(r2.blobUrl)).toBe(0);

      unmount();
      expect(revokeCallsFor(r2.blobUrl)).toBe(1);
      expect(revokeCallsFor(r3.blobUrl)).toBe(1);
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
    });
  });

  describe('gapless advance', () => {
    const nextRecordings = [rec('en', 'en-B'), rec('es', 'es-B')];

    /** Card 1 merged and playing, card 2 prefetched and cached. */
    async function primeWithPrefetch(
      overrides: Partial<UseAudioPlayerOptions>,
    ) {
      const hook = renderPlayer({ autoPlay: true, ...overrides });
      const r1 = await resolveMerge(0, makeResult({ durationSec: 3 }));
      hook.rerender(
        baseOptions({
          autoPlay: true,
          ...overrides,
          nextCard: { cardId: 'card-2', audioRecordings: nextRecordings },
        }),
      );
      const r2 = await resolveMerge(1, makeResult({ durationSec: 7 }));
      playMock.mockClear();
      return { ...hook, r1, r2 };
    }

    const ended = (audio: HTMLAudioElement) =>
      act(() => {
        audio.dispatchEvent(new Event('ended'));
      });

    it('starts the prefetched next blob inside the `ended` handler when the caller advances', async () => {
      const onScheduleComplete = vi.fn(() => true);
      const { result, r1, r2 } = await primeWithPrefetch({
        onScheduleComplete,
      });
      const audio = result.current.audioRef.current!;

      ended(audio);

      expect(onScheduleComplete).toHaveBeenCalledTimes(1);
      // Same tick: no rerender with the next card has happened yet.
      expect(audio.src).toBe(r2.blobUrl);
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(result.current.durationSec).toBe(7);
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
      expect(revokeCallsFor(r2.blobUrl)).toBe(0);
    });

    it('adopts the running audio when the server serves that card, without a teardown or a second play', async () => {
      const onScheduleComplete = vi.fn(() => true);
      const onResetReviewFlag = vi.fn();
      const { result, rerender, r2 } = await primeWithPrefetch({
        onScheduleComplete,
        onResetReviewFlag,
      });
      const audio = result.current.audioRef.current!;
      ended(audio);

      rerender(
        baseOptions({
          autoPlay: true,
          onScheduleComplete,
          onResetReviewFlag,
          cardId: 'card-2',
          audioRecordings: nextRecordings,
          nextCard: null,
        }),
      );

      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      expect(audio.src).toBe(r2.blobUrl);
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(result.current.isMerging).toBe(false);
      expect(result.current.durationSec).toBe(7);
      expect(onResetReviewFlag).toHaveBeenCalledTimes(1);
      expect(revokeCallsFor(r2.blobUrl)).toBe(0);
    });

    it('pauses the adopted audio when autoplay was muted in the meantime (celebration)', async () => {
      const onScheduleComplete = vi.fn(() => true);
      const { result, rerender } = await primeWithPrefetch({
        onScheduleComplete,
      });
      const audio = result.current.audioRef.current!;
      ended(audio);
      // jsdom pins `paused` at true; model a playing element so the adoption
      // path has something to stop. `pause` is already a shared mock from the
      // test setup, so clear its history rather than counting the whole file.
      Object.defineProperty(audio, 'paused', {
        configurable: true,
        get: () => false,
      });
      const pauseSpy = vi.spyOn(audio, 'pause');
      pauseSpy.mockClear();

      rerender(
        baseOptions({
          autoPlay: false,
          onScheduleComplete,
          cardId: 'card-2',
          audioRecordings: nextRecordings,
          nextCard: null,
        }),
      );

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
    });

    it('leaves the element ended when the caller does not advance', async () => {
      const { result, r1 } = await primeWithPrefetch({
        onScheduleComplete: () => false,
      });
      const audio = result.current.audioRef.current!;

      ended(audio);

      expect(audio.src).toBe(r1.blobUrl);
      expect(playMock).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });

    it('tears the handoff down when the server serves a different card', async () => {
      const onScheduleComplete = vi.fn(() => true);
      const { result, rerender, r2 } = await primeWithPrefetch({
        onScheduleComplete,
      });
      const audio = result.current.audioRef.current!;
      ended(audio);
      expect(audio.src).toBe(r2.blobUrl);

      const otherRecordings = [rec('en', 'en-C'), rec('es', 'es-C')];
      rerender(
        baseOptions({
          autoPlay: true,
          onScheduleComplete,
          cardId: 'card-3',
          audioRecordings: otherRecordings,
          nextCard: null,
        }),
      );

      // Ordinary path: the handoff blob is released and card-3 merges afresh.
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(3);
      expect(pendingMerges[2].recordings).toBe(otherRecordings);
      expect(revokeCallsFor(r2.blobUrl)).toBe(1);
      expect(audio.src).not.toBe(r2.blobUrl);
    });

    it('hands off from the prefetch completion when the card ended before the prefetch finished', async () => {
      const onScheduleComplete = vi.fn(() => true);
      const { result, rerender } = renderPlayer({
        autoPlay: true,
        onScheduleComplete,
      });
      const r1 = await resolveMerge(0, makeResult({ durationSec: 3 }));
      rerender(
        baseOptions({
          autoPlay: true,
          onScheduleComplete,
          nextCard: { cardId: 'card-2', audioRecordings: nextRecordings },
        }),
      );
      expect(mergeCardAudioMock).toHaveBeenCalledTimes(2);
      const audio = result.current.audioRef.current!;
      playMock.mockClear();

      // Prefetch still in flight: nothing to hand off yet.
      ended(audio);
      expect(audio.src).toBe(r1.blobUrl);
      expect(playMock).not.toHaveBeenCalled();

      const r2 = await resolveMerge(1, makeResult({ durationSec: 7 }));
      expect(audio.src).toBe(r2.blobUrl);
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(revokeCallsFor(r1.blobUrl)).toBe(1);
    });
  });

  describe('auto-reveal from language cues', () => {
    /** Drive the element to `t` and fire the event the browser would fire. */
    const tick = (audio: HTMLAudioElement, t: number) =>
      act(() => {
        audio.currentTime = t;
        audio.dispatchEvent(new Event('timeupdate'));
      });

    it('reveals a silent cue when playback passes it', async () => {
      // A zero-repetition language has no audio, only a placeholder cue. The
      // reveal must still fire when the timeline reaches it.
      const { result } = renderPlayer();
      await resolveMerge(
        0,
        makeResult({
          durationSec: 8,
          languageCues: [
            { language: 'en', startSec: 0, speed: 1, reveals: true },
            {
              language: 'es',
              startSec: 6,
              speed: 1,
              reveals: true,
              silent: true,
            },
          ],
        }),
      );
      const audio = result.current.audioRef.current!;

      tick(audio, 1);
      expect([...result.current.revealedLanguages]).toEqual(['en']);

      tick(audio, 6);
      expect([...result.current.revealedLanguages].sort()).toEqual([
        'en',
        'es',
      ]);
    });

    it('reveals a cue sitting exactly at the end when `ended` fires', async () => {
      // The last slot can land on the final instant of the timeline, where
      // timeupdate is not guaranteed to fire. `ended` sweeps the remainder.
      const { result } = renderPlayer();
      await resolveMerge(
        0,
        makeResult({
          durationSec: 6,
          languageCues: [
            { language: 'es', startSec: 0, speed: 1, reveals: true },
            {
              language: 'en',
              startSec: 6,
              speed: 1,
              reveals: true,
              silent: true,
            },
          ],
        }),
      );
      const audio = result.current.audioRef.current!;

      tick(audio, 5.9);
      expect([...result.current.revealedLanguages]).toEqual(['es']);

      act(() => {
        audio.dispatchEvent(new Event('ended'));
      });
      expect([...result.current.revealedLanguages].sort()).toEqual([
        'en',
        'es',
      ]);
    });

    it('still honours reveals:false on `ended`', async () => {
      // A before-base cue defers its reveal to the after-base slot; ending the
      // card must not override that.
      const { result } = renderPlayer();
      await resolveMerge(
        0,
        makeResult({
          durationSec: 4,
          languageCues: [
            { language: 'es', startSec: 0, speed: 1, reveals: false },
          ],
        }),
      );
      const audio = result.current.audioRef.current!;

      act(() => {
        audio.dispatchEvent(new Event('ended'));
      });
      expect([...result.current.revealedLanguages]).toEqual([]);
    });
  });
});
