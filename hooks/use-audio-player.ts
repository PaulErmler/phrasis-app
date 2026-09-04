'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  mergeCardAudio,
  type ResolvedAudioSettings,
  type MergeResult,
  type LanguageCue,
} from '@/lib/audio/mergeAudio';
import {
  resolveActiveCuePosition,
  mergedTimeForCuePosition,
} from '@/lib/audio/activeClip';
import {
  setupMediaSession,
  updateMediaSessionPosition,
  setMediaSessionPlaybackState,
} from '@/lib/audio/mediaSession';
import {
  createPlaybackClock,
  type PlaybackClock,
} from '@/lib/audio/playbackClock';
import { getSilenceBlobUrl } from '@/lib/audio/silence';
import type { CardAudioRecording } from '@/components/app/learning/types';

import { reportError } from '@/lib/report-error';
import { capture, CLIENT_EVENTS } from '@/lib/posthog/events';

export interface UseAudioPlayerOptions {
  cardId: string | null;
  audioRecordings: CardAudioRecording[];
  /** Peeked upcoming card, used to pre-merge its audio in the background so
   * playback starts instantly when the user advances. `null` when there is
   * no next due card. */
  nextCard: { cardId: string; audioRecordings: CardAudioRecording[] } | null;
  settings: ResolvedAudioSettings;
  orderedBase: string[];
  orderedTarget: string[];
  sourceText: string;
  languageNames: string;
  autoPlay: boolean;
  /** True while the settings sheet is open. A remerge triggered from settings
   *  (a speed/rep/pause tweak, or a language reorder) resets playback to the
   *  start instead of resuming the prior position. */
  settingsOpen: boolean;
  getReviewInitiatedByThisTab: () => boolean;
  /**
   * Fired when the merged blob plays to its end. Return `true` when the
   * caller advanced to the next card in response: the player then hands the
   * element the prefetched next blob in the same tick (see `tryHandoff`), so
   * playback never pauses while the server round-trip and re-render happen.
   * Return `false` to leave the element ended and wait for the next card the
   * ordinary way (no advance, or the advance is about to show a celebration
   * that must not have audio talking over it).
   */
  onScheduleComplete: () => boolean;
  onResetReviewFlag: () => void;
  onNext: () => void;
}

export interface AudioPlayerState {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekTo: (seconds: number) => void;
  /** Re-blur every timeline-revealed language ("restart card"); the next
   *  playback pass reveals them again cue by cue. */
  resetRevealed: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  isMerging: boolean;
  durationSec: number;
  revealedLanguages: ReadonlySet<string>;
  /**
   * Frame-rate position source on the merged-audio timeline. NOT React
   * state. ~60 Hz updates would re-render the whole card tree. Leaves that
   * need per-frame time (karaoke word index) subscribe via
   * `clock.subscribe()` and setState only when their derived value changes;
   * coarse consumers use `useActiveCue` for the active language cue.
   */
  clock: PlaybackClock;
  /** Language-clip boundaries in the merged blob. Stable per card. */
  languageCues: ReadonlyArray<LanguageCue>;
  /**
   * Effective playback speed each language was stretched to at merge time.
   * Word-highlight consumers using merged-clip `localTime` must scale by this
   * value so lookups hit the original (1×) word timings. Pass this straight
   * into `resolveActiveClip(cues, currentTime, speedByLanguage)`.
   */
  speedByLanguage: Record<string, number>;
}

/** Which code path asked the element to play. Carried on the blocked-play
 *  event so a hidden-tab refusal can be told apart from a foreground one. */
type PlayPath = 'manual' | 'auto' | 'resume' | 'handoff' | 'bridge';

/**
 * Longest a bridge (see `bridgingRef`) may loop silence before giving up.
 * Bounds the one case a bridge cannot resolve on its own: the advanced-to
 * card never gets playable audio (generation failed), where the element would
 * otherwise sit "playing" nothing for the rest of the session.
 */
const BRIDGE_MAX_MS = 120_000;

// Shared catch handler for `audio.play()` promises. An AbortError (play
// interrupted by a pause/src swap) is routine and dropped. A NotAllowedError
// is the autoplay policy saying no; it is expected on a cold page but not
// mid-session, and a browser refusing to start the next card while the screen
// is locked would otherwise be invisible, so it goes out as a product event
// (not the exception feed, see `reportError`'s note). Anything else is a real
// playback failure.
function ignorePlayInterrupt(label: string, path: PlayPath = 'manual') {
  return (err: { name?: string }) => {
    if (err.name === 'AbortError') return;
    if (err.name === 'NotAllowedError') {
      capture(CLIENT_EVENTS.AUDIO_PLAY_BLOCKED, {
        path,
        visibility:
          typeof document === 'undefined'
            ? 'unknown'
            : document.visibilityState,
      });
      return;
    }
    reportError(err, { op: 'audioPlay', label });
  };
}

// Run `fn` once the element has metadata. Immediately if already loaded,
// otherwise on the next `loadedmetadata` event.
function whenMetadataReady(audio: HTMLAudioElement, fn: () => void) {
  if (audio.readyState >= 1 /* HAVE_METADATA */) {
    fn();
  } else {
    audio.addEventListener('loadedmetadata', fn, { once: true });
  }
}

// Identity key for an audio set: changes on language changes, voice swaps,
// and URL null↔present transitions, but not on signed-URL refreshes. Using
// raw URL strings would cause needless remerges every time Convex refreshes
// signed URLs while the set itself is unchanged.
function audioIdentityKeyOf(recs: CardAudioRecording[]): string {
  if (recs.length === 0) return '';
  return recs
    .map((a) => `${a.language}:${a.voiceName ?? 'none'}:${a.url ? '1' : '0'}`)
    .join('|');
}

export function useAudioPlayer(
  options: UseAudioPlayerOptions,
): AudioPlayerState {
  const {
    cardId,
    audioRecordings,
    nextCard,
    settings,
    orderedBase,
    orderedTarget,
    sourceText,
    languageNames,
    autoPlay,
    settingsOpen,
    getReviewInitiatedByThisTab,
    onScheduleComplete,
    onResetReviewFlag,
    onNext,
  } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMerging, setIsMergingState] = useState(false);
  // Mirror of `isMerging` that updates synchronously. Effects declared after
  // the merge effect run in the same commit that starts a merge, so they would
  // otherwise read the pre-merge `false` out of their closure.
  const isMergingRef = useRef(false);
  const setIsMerging = useCallback((value: boolean) => {
    isMergingRef.current = value;
    setIsMergingState(value);
  }, []);
  const [durationSec, setDurationSec] = useState(0);
  const [revealedLanguages, setRevealedLanguages] = useState<
    ReadonlySet<string>
  >(new Set());
  const [languageCues, setLanguageCues] = useState<ReadonlyArray<LanguageCue>>(
    [],
  );
  const [speedByLanguage, setSpeedByLanguage] = useState<
    Record<string, number>
  >({});

  // Stable per-hook-instance clock; attached to the audio element on creation.
  const clockRef = useRef<PlaybackClock | null>(null);
  if (clockRef.current === null) clockRef.current = createPlaybackClock();
  const clock = clockRef.current;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Declared up here (not next to its sibling prev*Refs by the merge effect)
  // so it exists before the `pause` callback that also writes it.
  const hasAutoPlayedForCardRef = useRef(false);
  const mergeAbortRef = useRef<AbortController | null>(null);
  const mediaSessionCleanupRef = useRef<(() => void) | null>(null);
  const languageCuesRef = useRef<LanguageCue[]>([]);
  // Mirrors the current merged-audio bake-in speeds so the merge effect can
  // convert a merged-timeline `currentTime` to an (original-frame) cue
  // position synchronously, without waiting for state updates to flush.
  const speedByLanguageRef = useRef<Record<string, number>>({});
  const webLockResolveRef = useRef<(() => void) | null>(null);
  const webLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Gapless advance bookkeeping. `handoffRef` records that the element is
  // already playing the prefetched blob of a card the server has not served
  // yet, with the keys that blob was merged under, so the merge effect can
  // adopt it when that card arrives. `awaitingHandoffRef` covers the slow
  // case: the card ended before its successor's prefetch finished, so the
  // prefetch completion performs the handoff instead.
  const handoffRef = useRef<{
    cardId: string;
    audioIdentityKey: string;
    settingsKey: string;
    compositionKey: string;
  } | null>(null);
  const awaitingHandoffRef = useRef<{
    fromCardId: string | null;
    nextCardId: string;
  } | null>(null);
  const currentCardIdRef = useRef(cardId);
  currentCardIdRef.current = cardId;
  // Bridging: the element is looping the silent track (see `getSilenceBlobUrl`)
  // because the card ended, the caller advanced, and the next blob was not
  // ready to hand off. It stays on until something loads a real blob (a late
  // prefetch, the cache hit or merge for the served card), the user pauses,
  // the session runs out of cards, or `BRIDGE_MAX_MS` passes. While it runs
  // the element is never idle, which is what keeps a locked-screen browser
  // from revoking background playback between two cards.
  const bridgingRef = useRef(false);
  const bridgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Leave bridging mode. Returns whether a bridge was running. The element
   *  keeps playing silence until the caller loads or pauses something. */
  const endBridge = useCallback((audio: HTMLAudioElement): boolean => {
    if (bridgeTimeoutRef.current) {
      clearTimeout(bridgeTimeoutRef.current);
      bridgeTimeoutRef.current = null;
    }
    if (!bridgingRef.current) return false;
    bridgingRef.current = false;
    audio.loop = false;
    return true;
  }, []);

  // Stable refs for callbacks to avoid re-triggering effects
  const onScheduleCompleteRef = useRef(onScheduleComplete);
  onScheduleCompleteRef.current = onScheduleComplete;
  const onResetReviewFlagRef = useRef(onResetReviewFlag);
  onResetReviewFlagRef.current = onResetReviewFlag;
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  // The `ended` listener is bound once, so it reads the current next-card
  // preview through a ref.
  const nextCardRef = useRef(nextCard);
  nextCardRef.current = nextCard;
  // Latest autoPlay value, read at the moment of `.play()` instead of from
  // the merge effect's captured closure. The merge effect's async pipeline
  // (fetch → decode → merge → loadedmetadata) takes 50-200ms; if the
  // caller flips autoPlay false during that window (e.g. an onboarding
  // tutorial popover opens), we want the play decision at resolution time
  // to honor the *current* value, not the stale closure.
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  // Latest settings-sheet state, read at remerge time. A remerge while the
  // sheet is open is a settings edit → reset to the start rather than resume.
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;

  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      clock.attach(audioRef.current);
      audioRef.current.preload = 'auto';
      // Defensive: modern browsers default preservesPitch to true, but set it
      // explicitly (plus the webkit prefix for older Safari) so any future
      // call that touches `playbackRate` on this element stays pitch-stable.
      audioRef.current.preservesPitch = true;
      const el = audioRef.current as HTMLAudioElement & {
        webkitPreservesPitch?: boolean;
      };
      el.webkitPreservesPitch = true;
    }
    return audioRef.current;
  }, [clock]);

  // --------------------------------------------------------------------------
  // Playback controls
  // --------------------------------------------------------------------------
  const play = useCallback(() => {
    const audio = getAudio();
    if (!audio.src || audio.src === '') return;
    // Replaying after the audio has run to completion: browsers are
    // inconsistent about what a bare .play() call does on an ended element.
    // In practice the element can stay "stuck". Play() resolves, but no
    // 'play' event fires, which means our isPlaying stays false and the
    // rAF loop never re-subscribes, so no word highlighting on the replay.
    //
    // .pause() + currentTime=0 first forces a clean "paused at 0" state;
    // the subsequent .play() then reliably fires 'play' and the clock snaps
    // back so the highlight starts from the first word.
    if (
      audio.ended ||
      (audio.duration && audio.currentTime >= audio.duration - 0.05)
    ) {
      audio.pause();
      audio.currentTime = 0;
      clock.notifyOnce();
      setIsPlaying(false);
    }
    audio
      .play()
      .then(() => {
        // Safety net: a handful of browsers skip the 'play' event after a
        // post-`ended` replay, leaving isPlaying stale-false. Re-asserting
        // here guarantees the rAF effect resubscribes and highlights update.
        setIsPlaying(true);
      })
      .catch(ignorePlayInterrupt('Audio play failed:'));
  }, [getAudio, clock]);

  const pause = useCallback(() => {
    hasAutoPlayedForCardRef.current = true; // suppress pending auto-play
    const audio = audioRef.current;
    if (!audio) return;
    if (endBridge(audio)) {
      // The user stopped a bridge: nothing real is loaded, so unload the
      // silence rather than leave a Play tap resuming it. The card's blob
      // lands paused when its merge finishes (`hasAutoPlayed` is set above),
      // and the prefetch the bridge was waiting for must not hand off into
      // playback either: a pause is the user's answer to "keep going".
      awaitingHandoffRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setIsPlaying(false);
      setMediaSessionPlaybackState('paused');
      return;
    }
    if (!audio.paused) {
      audio.pause();
    }
  }, [endBridge]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      if (endBridge(audio)) {
        awaitingHandoffRef.current = null;
        audio.removeAttribute('src');
        audio.load();
      }
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
    setMediaSessionPlaybackState('none');
  }, [endBridge]);

  const seekTo = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (audio && audio.duration) {
        audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
        // Paused seeks won't tick the rAF loop. Push one update so word
        // highlights track the new position immediately.
        clock.notifyOnce();
        updateMediaSessionPosition(audio.duration, audio.currentTime);
      }
    },
    [clock],
  );

  const resetRevealed = useCallback(() => {
    setRevealedLanguages(new Set());
  }, []);

  /**
   * Drop the loaded blob and its bookkeeping. `keepBridge` leaves a running
   * bridge (the silent loop) playing: a card change or a wait for audio URLs
   * is exactly the gap the bridge exists to cover, so the element must not be
   * unloaded there. Without it the bridge is stopped along with everything
   * else (no card to wait for).
   */
  const clearCurrentAudio = useCallback(
    (opts?: { keepBridge?: boolean }) => {
      const audio = getAudio();
      const bridging = opts?.keepBridge === true && bridgingRef.current;
      if (!bridging) {
        endBridge(audio);
        if (!audio.paused) audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      handoffRef.current = null;
      awaitingHandoffRef.current = null;
      languageCuesRef.current = [];
      speedByLanguageRef.current = {};
      setDurationSec(0);
      setRevealedLanguages(new Set());
      clock.notifyOnce();
      setLanguageCues([]);
      setSpeedByLanguage({});
      if (!bridging) {
        setIsPlaying(false);
        setMediaSessionPlaybackState('none');
      }
    },
    [getAudio, clock, endBridge],
  );

  // --------------------------------------------------------------------------
  // Drive the playback clock from the playing state. The clock runs its own
  // rAF loop (only while playing AND subscribed) and notifies subscribers
  // outside React, no per-frame re-renders here.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (isPlaying) {
      clock.start();
      return () => clock.stop();
    }
    clock.stop();
  }, [isPlaying, clock]);

  // --------------------------------------------------------------------------
  // Merge audio when card changes, audio URLs arrive, or settings change
  // --------------------------------------------------------------------------
  const allAudioReady =
    audioRecordings.length > 0 && audioRecordings.every((a) => a.url);

  // Identity key for the audio set. See `audioIdentityKeyOf`. Stable across
  // signed-URL refreshes while allAudioReady stays true.
  const audioIdentityKey = useMemo(
    () => audioIdentityKeyOf(audioRecordings),
    [audioRecordings],
  );

  // Same identity-key formula for the peeked next card. Used to gate prefetching
  // and to verify cache-hit safety on card advance.
  const nextAudioIdentityKey = useMemo(
    () => (nextCard ? audioIdentityKeyOf(nextCard.audioRecordings) : ''),
    [nextCard],
  );

  // Pre-merge cache: keyed by the upcoming card's id. When the current card's
  // merge finishes and the next card's audio URLs are ready, we run
  // `mergeCardAudio` in the background and stash the result here. On card
  // advance, the merge effect below uses the cached blob instead of re-running
  // the fetch/decode/render pipeline, eliminating the perceptible gap between
  // "user rated card" and "audio starts playing."
  //
  // `compositionKey` is part of the validated keys because the baked-in blob
  // is composition-specific. A prefetch made while review mode was 'audio'
  // (target merged in) is the wrong blob to serve under 'full' (target stripped).
  // Without this check, a mode flip between prefetch and consume would auto-
  // play the previous mode's composition for the new card.
  const prefetchCacheRef = useRef<
    Map<
      string,
      {
        result: MergeResult;
        audioIdentityKey: string;
        settingsKey: string;
        compositionKey: string;
      }
    >
  >(new Map());
  const prefetchAbortRef = useRef<AbortController | null>(null);

  // Stable key that changes whenever any playback-affecting setting changes
  const settingsKey = useMemo(
    () =>
      JSON.stringify({
        reps: settings.reps,
        repPauses: settings.repPauses,
        speeds: settings.speeds,
        pauseB2B: settings.pauseB2B,
        pauseB2T: settings.pauseB2T,
        pauseT2T: settings.pauseT2T,
        autoAdvance: settings.autoAdvance,
        pauseBeforeAdvance: settings.pauseBeforeAdvance,
        playTargetBefore: settings.playTargetBefore,
        playTargetAfter: settings.playTargetAfter,
        beforeReps: settings.beforeReps,
        beforeRepPauses: settings.beforeRepPauses,
        beforeSpeeds: settings.beforeSpeeds,
        pauseT2B: settings.pauseT2B,
      }),
    [settings],
  );
  const baseOrderKey = orderedBase.join(',');
  const targetOrderKey = orderedTarget.join(',');
  // The composition baked into the merged blob. Different review modes flip
  // target-language inclusion, which changes this string and is the signal
  // for "user just asked to hear this card under a new audio layout."
  const compositionKey = `${baseOrderKey}|${targetOrderKey}`;

  /**
   * Gapless advance: move the element onto the prefetched blob of the peeked
   * next card without waiting for the server to serve it. Returns `false`
   * (and does nothing) when there is no usable prefetch: no next card, not
   * merged yet, or merged under settings that no longer match. The merge
   * effect below adopts the running audio once the card arrives, or tears it
   * down if the server served something else.
   */
  const tryHandoff = (): boolean => {
    const next = nextCardRef.current;
    if (!next) return false;
    const entry = prefetchCacheRef.current.get(next.cardId);
    if (
      !entry ||
      entry.audioIdentityKey !== nextAudioIdentityKey ||
      entry.settingsKey !== settingsKey ||
      entry.compositionKey !== compositionKey
    ) {
      return false;
    }
    prefetchCacheRef.current.delete(next.cardId);

    const audio = getAudio();
    endBridge(audio);
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = entry.result.blobUrl;
    languageCuesRef.current = entry.result.languageCues;
    speedByLanguageRef.current = entry.result.speedByLanguage;
    setLanguageCues(entry.result.languageCues);
    setSpeedByLanguage(entry.result.speedByLanguage);
    setDurationSec(entry.result.durationSec);
    setRevealedLanguages(new Set());
    hasAutoPlayedForCardRef.current = true;
    handoffRef.current = {
      cardId: next.cardId,
      audioIdentityKey: entry.audioIdentityKey,
      settingsKey: entry.settingsKey,
      compositionKey: entry.compositionKey,
    };
    audio.src = entry.result.blobUrl;
    clock.notifyOnce();
    audio.play().catch(ignorePlayInterrupt('Handoff play failed:', 'handoff'));
    return true;
  };
  // Published through a ref for the once-bound `ended` listener below. The
  // listener effect is declared after this line on purpose: the React
  // Compiler forbids mutating a ref in render once an effect has read it.
  const tryHandoffRef = useRef(tryHandoff);
  tryHandoffRef.current = tryHandoff;

  // --------------------------------------------------------------------------
  // Wire audio element events
  // --------------------------------------------------------------------------
  useEffect(() => {
    const audio = getAudio();

    const acquireWebLock = () => {
      if (webLockResolveRef.current) return; // already held
      if (webLockTimeoutRef.current) {
        clearTimeout(webLockTimeoutRef.current);
        webLockTimeoutRef.current = null;
        return; // lock still held from delayed release
      }
      if (!navigator.locks) return;
      navigator.locks.request('audio-playback', () => {
        return new Promise<void>((resolve) => {
          webLockResolveRef.current = resolve;
        });
      });
    };

    const releaseWebLockDelayed = () => {
      if (webLockTimeoutRef.current) clearTimeout(webLockTimeoutRef.current);
      webLockTimeoutRef.current = setTimeout(() => {
        webLockTimeoutRef.current = null;
        webLockResolveRef.current?.();
        webLockResolveRef.current = null;
      }, 180_000);
    };

    const handlePlay = () => {
      // Playback resumed on its own (user replay, media-session play): a late
      // prefetch must not hijack the element any more. The bridge's own play
      // is the one exception: it is waiting for exactly that prefetch.
      if (!bridgingRef.current) awaitingHandoffRef.current = null;
      setIsPlaying(true);
      setMediaSessionPlaybackState('playing');
      acquireWebLock();
    };

    const handlePause = () => {
      setIsPlaying(false);
      setMediaSessionPlaybackState('paused');
      releaseWebLockDelayed();
    };

    /** Un-blur every revealing language whose cue is at or before `timeSec`. */
    const revealThrough = (timeSec: number) => {
      const cues = languageCuesRef.current;
      if (cues.length === 0) return;
      setRevealedLanguages((prev) => {
        const toReveal = cues.filter(
          (c) =>
            c.reveals !== false &&
            c.startSec <= timeSec &&
            !prev.has(c.language),
        );
        if (toReveal.length === 0) return prev;
        const next = new Set(prev);
        for (const c of toReveal) next.add(c.language);
        return next;
      });
    };

    const startBridge = () => {
      endBridge(audio);
      bridgingRef.current = true;
      audio.loop = true;
      audio.src = getSilenceBlobUrl();
      const reportBlocked = ignorePlayInterrupt(
        'Bridge play failed:',
        'bridge',
      );
      audio.play().catch((err: { name?: string }) => {
        reportBlocked(err);
        // The browser refused the silence: there is no continuous playback
        // to hand the next card, so the bridge must not be treated as one
        // (the merge path would otherwise skip the tab-initiated gate on its
        // strength). Unload and fall back to the plain paused state.
        if (err.name === 'NotAllowedError' && bridgingRef.current) {
          endBridge(audio);
          audio.removeAttribute('src');
          audio.load();
          setIsPlaying(false);
          setMediaSessionPlaybackState('paused');
          releaseWebLockDelayed();
        }
      });
      bridgeTimeoutRef.current = setTimeout(() => {
        bridgeTimeoutRef.current = null;
        if (!bridgingRef.current) return;
        // Nothing arrived to play. Stop looping silence rather than look
        // "playing" for the rest of the session.
        endBridge(audio);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        setIsPlaying(false);
        setMediaSessionPlaybackState('paused');
        releaseWebLockDelayed();
      }, BRIDGE_MAX_MS);
    };

    const handleEnded = () => {
      // Playback reached the end, so every revealing cue is behind us. The last
      // cue can sit exactly at the blob duration. A silent placeholder for a
      // zero-repetition language in the final group, and `timeupdate` is not
      // guaranteed to fire on that last sample, so sweep the remainder here.
      revealThrough(Infinity);
      // Auto-advance. When the caller moves on to the next card, start that
      // card's prefetched blob right here, in the same task as `ended`, before
      // the server round-trip and re-render. A hidden tab (phone screen
      // locked) that lets the element sit empty while a mutation, a query
      // update and a fresh media load all complete is where mobile browsers
      // drop continuous playback; an element that goes straight from one blob
      // to the next never gives them the chance.
      const advancing = onScheduleCompleteRef.current();
      if (advancing) {
        if (tryHandoffRef.current()) return;
        const next = nextCardRef.current;
        awaitingHandoffRef.current = next
          ? { fromCardId: currentCardIdRef.current, nextCardId: next.cardId }
          : null;
        // Nothing to hand off yet (prefetch still running, or the next card
        // is not even known until the server answers). Keep the element
        // playing regardless: loop silence until a real blob loads. The
        // in-blob pauses are already rendered silence; this closes the one
        // remaining real pause, the gap between two cards.
        startBridge();
        return;
      }
      setIsPlaying(false);
      setMediaSessionPlaybackState('paused');
      releaseWebLockDelayed();
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDurationSec(audio.duration);
      }
    };

    const handleTimeUpdate = () => revealThrough(audio.currentTime);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [getAudio, endBridge]);

  const prevCardIdRef = useRef<string | null>(null);
  const prevCompositionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const isCardChange = prevCardIdRef.current !== cardId;
    prevCardIdRef.current = cardId;

    // Composition change = the languages baked into the merged blob differ
    // from the prior merge (e.g. switching review mode flips target-language
    // inclusion). Treat it like a fresh auto-play opportunity so that
    // entering audio mode after the card already played in full mode (or
    // vice versa) still starts playback. Settings tweaks alone (speed,
    // reps) don't trigger this. They bump `settingsKey`, not the order
    // keys, so they correctly remain auto-play-suppressed.
    const isCompositionChange =
      !isCardChange && prevCompositionKeyRef.current !== compositionKey;
    prevCompositionKeyRef.current = compositionKey;

    if (isCardChange || isCompositionChange) {
      hasAutoPlayedForCardRef.current = false;
    }

    // A composition change re-bakes the blob under a new language layout and
    // restarts playback from the top (no resume seek below), so the reveal
    // state must restart with it. Without this, a target language revealed
    // by earlier playback stays visible after switching into audio/Shadowing
    // mode instead of returning to its blurred initial state.
    if (isCompositionChange) {
      setRevealedLanguages(new Set());
    }

    // A card change settles any pending gapless advance. If the element is
    // already playing this very card's prefetched blob (see `tryHandoff`),
    // adopt it: no teardown, no merge, and the auto-play already happened.
    // Any mismatch (the server served a different card, or this card
    // resolves to other settings or audio than the blob was merged under)
    // falls through to the ordinary clear-and-merge path, which stops the
    // running audio and plays the right thing.
    if (isCardChange) awaitingHandoffRef.current = null;
    const handoff = handoffRef.current;
    if (handoff && isCardChange) {
      handoffRef.current = null;
      if (
        handoff.cardId === cardId &&
        handoff.audioIdentityKey === audioIdentityKey &&
        handoff.settingsKey === settingsKey &&
        handoff.compositionKey === compositionKey
      ) {
        mergeAbortRef.current?.abort();
        mergeAbortRef.current = null;
        setIsMerging(false);
        hasAutoPlayedForCardRef.current = true;
        onResetReviewFlagRef.current();
        // The caller muted autoplay since the handoff (the server confirmed a
        // milestone celebration): the card is here, its audio must not be.
        if (!autoPlayRef.current) {
          const audio = getAudio();
          if (!audio.paused) audio.pause();
        }
        return;
      }
    }

    const audioBefore = audioRef.current;
    const wasPlayingSameCard =
      !!audioBefore && !audioBefore.paused && cardId != null && !isCardChange;

    // Capture the user's structural position BEFORE the remerge so we can seek
    // the new blob to the equivalent (language, repIndex, localTimeOriginal),
    // otherwise `audio.src = newBlob` implicitly resets `currentTime` to 0 and
    // a mid-playback speed change restarts playback from the top.
    //
    // Exceptions that intentionally reset to the start (no resume capture,
    // `currentTime` falls back to 0): a remerge driven from the open settings
    // sheet (a speed/rep/pause tweak or a language reorder), and a
    // composition change (a review-mode flip is "hear this card fresh under
    // the new layout", not "continue where the other mode left off").
    const resumePos =
      !isCardChange &&
      !isCompositionChange &&
      !settingsOpenRef.current &&
      audioBefore &&
      languageCuesRef.current.length > 0
        ? resolveActiveCuePosition(
            languageCuesRef.current,
            audioBefore.currentTime,
            speedByLanguageRef.current,
          )
        : null;

    if (!cardId) {
      clearCurrentAudio();
      mergeAbortRef.current?.abort();
      mergeAbortRef.current = null;
      setIsMerging(false);
      return;
    }

    if (!allAudioReady) {
      // URLs transiently missing for this card. Clear only on a real card
      // change; otherwise leave the currently loaded blob playing and wait
      // for URLs to return, so a reactive query hiccup doesn't strand audio.
      mergeAbortRef.current?.abort();
      mergeAbortRef.current = null;
      setIsMerging(false);
      if (isCardChange) clearCurrentAudio({ keepBridge: true });
      return;
    }

    if (isCardChange) clearCurrentAudio({ keepBridge: true });

    // Prefetch cache hit, if we pre-merged this card's audio while the
    // previous card was playing, adopt the cached blob instead of re-running
    // the fetch/decode/render pipeline. Only valid on a real card change and
    // only when the cached audio set and settings exactly match the current
    // ones (otherwise the merged output would differ).
    const cached = isCardChange
      ? prefetchCacheRef.current.get(cardId)
      : undefined;
    if (
      cached &&
      cached.audioIdentityKey === audioIdentityKey &&
      cached.settingsKey === settingsKey &&
      cached.compositionKey === compositionKey
    ) {
      mergeAbortRef.current?.abort();
      mergeAbortRef.current = null;
      prefetchCacheRef.current.delete(cardId);

      // Ownership of the cached blob URL transfers to blobUrlRef. The old blob
      // was already revoked by clearCurrentAudio() above.
      blobUrlRef.current = cached.result.blobUrl;
      languageCuesRef.current = cached.result.languageCues;
      speedByLanguageRef.current = cached.result.speedByLanguage;
      setLanguageCues(cached.result.languageCues);
      setSpeedByLanguage(cached.result.speedByLanguage);
      setDurationSec(cached.result.durationSec);
      setIsMerging(false);

      const audio = getAudio();
      // A bridge goes straight from silence to the blob (the src swap
      // interrupts the loop by itself), the same as a handoff. Unless
      // autoplay is muted: then nothing will start the blob, so pause first
      // so the `pause` event lands and the playing state follows the element
      // (a src swap alone flips `paused` without firing it).
      const wasBridging = endBridge(audio);
      if (!audio.paused && (!wasBridging || !autoPlayRef.current)) {
        audio.pause();
      }
      audio.src = cached.result.blobUrl;

      const initiatedByThisTab = getReviewInitiatedByThisTab();

      const doStart = () => {
        // Re-check autoPlay at the moment of play, not from the captured
        // closure. See `autoPlayRef` comment near hook top. A bridge already
        // committed to continuous playback, so it needs only the autoPlay
        // gate (the celebration / settings-sheet mute).
        if (
          autoPlayRef.current &&
          (wasBridging ||
            (!hasAutoPlayedForCardRef.current && initiatedByThisTab))
        ) {
          hasAutoPlayedForCardRef.current = true;
          onResetReviewFlagRef.current();
          audio.play().catch(ignorePlayInterrupt('Auto-play failed:', 'auto'));
        }
      };

      whenMetadataReady(audio, doStart);
      return;
    }

    // Same-card remerge (e.g. review-mode flip changes `orderedTarget`, which
    // changes the merged composition): pause immediately so the stale blob
    // doesn't keep playing for the few hundred ms while mergeCardAudio is in
    // flight. The post-merge logic still resumes from `resumePos` because
    // `wasPlayingSameCard` was captured above before this pause.
    if (
      !isCardChange &&
      audioBefore &&
      !audioBefore.paused &&
      !bridgingRef.current
    ) {
      audioBefore.pause();
    }

    // Cancel any in-flight merge
    mergeAbortRef.current?.abort();
    const controller = new AbortController();
    mergeAbortRef.current = controller;

    let cancelled = false;

    const doMerge = async () => {
      setIsMerging(true);

      try {
        const result: MergeResult | null = await mergeCardAudio(
          audioRecordings,
          orderedBase,
          orderedTarget,
          settings,
          controller.signal,
        );

        if (cancelled || controller.signal.aborted) return;

        const audio = getAudio();

        // Stop current playback before swapping the source. A bridge is
        // not stopped: the src swap below takes the element straight from
        // silence to the blob. Unless autoplay is muted, in which case the
        // blob will not be started and the pause has to land now (see the
        // cache-hit path above).
        const wasBridging = endBridge(audio);
        if (!audio.paused && (!wasBridging || !autoPlayRef.current)) {
          audio.pause();
        }

        // Revoke previous blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }

        if (!result) {
          if (wasBridging) {
            // Nothing to play for this card: unload the silence.
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            setIsPlaying(false);
            setMediaSessionPlaybackState('paused');
          }
          setDurationSec(0);
          setIsMerging(false);
          return;
        }

        blobUrlRef.current = result.blobUrl;
        languageCuesRef.current = result.languageCues;
        speedByLanguageRef.current = result.speedByLanguage;
        setLanguageCues(result.languageCues);
        setSpeedByLanguage(result.speedByLanguage);
        audio.src = result.blobUrl;
        setDurationSec(result.durationSec);
        setIsMerging(false);

        const initiatedByThisTab = getReviewInitiatedByThisTab();

        // Assigning `audio.src` resets `currentTime` to 0. If the user had a
        // structural position before this remerge, map it onto the new blob's
        // timeline and seek there once metadata is loaded, otherwise a speed
        // change mid-playback would jump back to the top of the merged audio.
        const doResume = () => {
          if (resumePos) {
            const target = mergedTimeForCuePosition(
              result.languageCues,
              result.speedByLanguage,
              resumePos,
            );
            if (target != null && Number.isFinite(target)) {
              const clamped = Math.max(
                0,
                Math.min(target, Math.max(0, result.durationSec - 0.05)),
              );
              try {
                audio.currentTime = clamped;
                clock.notifyOnce();
                updateMediaSessionPosition(result.durationSec, clamped);
              } catch {
                // readyState edge. Safe to ignore; seek was best-effort.
              }
            }
          }
          // Same-card remerge resume (e.g. settings tweak or client refresh):
          // only resume if playback was running AND the caller hasn't gated
          // autoplay since. Resume-after-async-merge isn't "user-initiated at
          // the moment of play". The user clicked Play 100s of ms ago and an
          // onboarding tutorial may have opened in between. A composition
          // change never "resumes": it restarts from the top via the
          // auto-play branch below, even when audio was mid-playback.
          const shouldResumePlay =
            wasPlayingSameCard && !isCompositionChange && autoPlayRef.current;
          // Composition change is a user-initiated mode toggle in this tab.
          // Bypass the `hasAutoPlayed` and `reviewInitiatedByThisTab` gates.
          // Those exist to stop spurious auto-plays from URL refreshes and to
          // coordinate across tabs on initial load; once the user explicitly
          // flips review modes neither applies, and the tab-flag is otherwise
          // stuck at false. We still honor `autoPlayRef.current` so callers
          // (the onboarding tutorial gate) can suppress mid-flight plays.
          const shouldAutoPlay =
            !shouldResumePlay &&
            autoPlayRef.current &&
            (isCompositionChange ||
              (!wasPlayingSameCard &&
                !hasAutoPlayedForCardRef.current &&
                initiatedByThisTab));
          if (shouldResumePlay) {
            audio
              .play()
              .catch(ignorePlayInterrupt('Resume playback failed:', 'resume'));
          } else if (wasBridging && autoPlayRef.current) {
            // Continuing the bridge onto the real blob. Same single gate as
            // the cache-hit path above.
            hasAutoPlayedForCardRef.current = true;
            onResetReviewFlagRef.current();
            audio
              .play()
              .catch(ignorePlayInterrupt('Bridge play failed:', 'bridge'));
          } else if (shouldAutoPlay) {
            hasAutoPlayedForCardRef.current = true;
            onResetReviewFlagRef.current();
            audio
              .play()
              .catch(ignorePlayInterrupt('Auto-play failed:', 'auto'));
          }
        };

        whenMetadataReady(audio, doResume);
      } catch (err) {
        if (
          !cancelled &&
          !(err instanceof DOMException && err.name === 'AbortError')
        ) {
          reportError(err, { op: 'audioMerge' });
        }
        if (!cancelled) setIsMerging(false);
      }
    };

    doMerge();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cardId,
    audioIdentityKey,
    settingsKey,
    baseOrderKey,
    targetOrderKey,
    clearCurrentAudio,
  ]);

  // --------------------------------------------------------------------------
  // Prefetch/pre-merge the next card's audio once the current card is stable.
  // Runs on the main thread too, but during playback of the current card so
  // the cost is hidden. On card advance, the merge effect above uses the
  // cached result and `audio.src` flips near-instantly instead of waiting for
  // the fetch/decode/render pipeline.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!cardId) return;
    if (!nextCard) return;
    // Don't contend with the current card's merge for CPU. Read the ref, not
    // the state: on mount this effect runs in the same commit as the merge
    // effect that just started, so the state value is still `false` here.
    // `isMerging` stays in the dep array so finishing a merge re-runs us.
    if (isMergingRef.current) return;
    // Only prefetch when every clip URL is resolved, otherwise mergeCardAudio
    // would skip clips and produce a truncated blob we'd have to redo.
    const allNextUrlsReady =
      nextCard.audioRecordings.length > 0 &&
      nextCard.audioRecordings.every((a) => a.url);
    if (!allNextUrlsReady) return;

    const existing = prefetchCacheRef.current.get(nextCard.cardId);
    if (
      existing &&
      existing.audioIdentityKey === nextAudioIdentityKey &&
      existing.settingsKey === settingsKey &&
      existing.compositionKey === compositionKey
    ) {
      return;
    }

    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;

    let cancelled = false;
    const targetCardId = nextCard.cardId;
    const targetAudioIdentityKey = nextAudioIdentityKey;
    const targetSettingsKey = settingsKey;
    const targetCompositionKey = compositionKey;

    const doPrefetch = async () => {
      try {
        const result = await mergeCardAudio(
          nextCard.audioRecordings,
          orderedBase,
          orderedTarget,
          settings,
          controller.signal,
        );
        if (cancelled || controller.signal.aborted || !result) {
          // If mergeCardAudio returned a blob but we got aborted mid-insert,
          // revoke to avoid leaking. (The merge itself already checks abort
          // internally and returns null in most cancel paths.)
          if (result) URL.revokeObjectURL(result.blobUrl);
          return;
        }

        // Replace any stale entry for this cardId and insert the fresh one.
        const prev = prefetchCacheRef.current.get(targetCardId);
        if (prev) URL.revokeObjectURL(prev.result.blobUrl);
        prefetchCacheRef.current.set(targetCardId, {
          result,
          audioIdentityKey: targetAudioIdentityKey,
          settingsKey: targetSettingsKey,
          compositionKey: targetCompositionKey,
        });

        // Bound the cache to the two most recent entries so stale blobs from
        // skipped cards or mid-session settings changes don't accumulate.
        while (prefetchCacheRef.current.size > 2) {
          const oldestKey = prefetchCacheRef.current.keys().next().value;
          if (!oldestKey) break;
          const stale = prefetchCacheRef.current.get(oldestKey);
          if (stale) URL.revokeObjectURL(stale.result.blobUrl);
          prefetchCacheRef.current.delete(oldestKey);
        }

        // The current card already ended waiting for exactly this blob (slow
        // network), and nothing has moved since: hand off now. Still-the-same
        // card and still-paused are the checks that a user replay or a
        // server-served card has not overtaken us in the meantime.
        const awaiting = awaitingHandoffRef.current;
        if (
          awaiting &&
          awaiting.nextCardId === targetCardId &&
          awaiting.fromCardId === currentCardIdRef.current &&
          (getAudio().paused || bridgingRef.current)
        ) {
          awaitingHandoffRef.current = null;
          tryHandoffRef.current();
        }
      } catch (err) {
        if (
          !cancelled &&
          !(err instanceof DOMException && err.name === 'AbortError')
        ) {
          reportError(err, { op: 'audioPrefetch' });
        }
      }
    };

    doPrefetch();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cardId,
    nextCard?.cardId,
    nextAudioIdentityKey,
    settingsKey,
    baseOrderKey,
    targetOrderKey,
    isMerging,
  ]);

  // --------------------------------------------------------------------------
  // Media Session: update on card change
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!cardId) return;

    mediaSessionCleanupRef.current?.();

    const cleanup = setupMediaSession({
      title: sourceText,
      artist: languageNames,
      onPlay: () => play(),
      onPause: () => pause(),
      onNextTrack: () => onNextRef.current(),
      onPreviousTrack: () => seekTo(0),
    });
    mediaSessionCleanupRef.current = cleanup;

    return cleanup;
  }, [cardId, sourceText, languageNames, play, pause, seekTo]);

  // --------------------------------------------------------------------------
  // Cleanup on unmount
  // --------------------------------------------------------------------------
  useEffect(() => {
    const cache = prefetchCacheRef.current;
    return () => {
      mergeAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      mediaSessionCleanupRef.current?.();
      if (webLockTimeoutRef.current) clearTimeout(webLockTimeoutRef.current);
      if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
      bridgingRef.current = false;
      webLockResolveRef.current?.();
      webLockResolveRef.current = null;

      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      for (const entry of cache.values()) {
        URL.revokeObjectURL(entry.result.blobUrl);
      }
      cache.clear();
    };
  }, []);

  return {
    play,
    pause,
    stop,
    seekTo,
    resetRevealed,
    audioRef,
    isPlaying,
    isMerging,
    durationSec,
    revealedLanguages,
    clock,
    languageCues,
    speedByLanguage,
  };
}
