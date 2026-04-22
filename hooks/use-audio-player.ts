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
import type { CardAudioRecording } from '@/components/app/learning/types';

export interface UseAudioPlayerOptions {
  cardId: string | null;
  audioRecordings: CardAudioRecording[];
  settings: ResolvedAudioSettings;
  orderedBase: string[];
  orderedTarget: string[];
  sourceText: string;
  languageNames: string;
  autoPlay: boolean;
  getReviewInitiatedByThisTab: () => boolean;
  onScheduleComplete: () => void;
  onResetReviewFlag: () => void;
  onNext: () => void;
}

export interface AudioPlayerState {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekTo: (seconds: number) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  isMerging: boolean;
  durationSec: number;
  revealedLanguages: ReadonlySet<string>;
  /**
   * Position on the merged-audio timeline, in seconds. Updated ~60 Hz via
   * requestAnimationFrame while playing (the native `timeupdate` event fires
   * too slowly for smooth per-word highlighting). Callers should translate
   * this into per-clip time via `resolveActiveClip(languageCues, currentTime)`.
   */
  currentTime: number;
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

export function useAudioPlayer(
  options: UseAudioPlayerOptions,
): AudioPlayerState {
  const {
    cardId,
    audioRecordings,
    settings,
    orderedBase,
    orderedTarget,
    sourceText,
    languageNames,
    autoPlay,
    getReviewInitiatedByThisTab,
    onScheduleComplete,
    onResetReviewFlag,
    onNext,
  } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [revealedLanguages, setRevealedLanguages] = useState<ReadonlySet<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(0);
  const [languageCues, setLanguageCues] = useState<ReadonlyArray<LanguageCue>>([]);
  const [speedByLanguage, setSpeedByLanguage] = useState<Record<string, number>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const mergeAbortRef = useRef<AbortController | null>(null);
  const mediaSessionCleanupRef = useRef<(() => void) | null>(null);
  const languageCuesRef = useRef<LanguageCue[]>([]);
  // Mirrors the current merged-audio bake-in speeds so the merge effect can
  // convert a merged-timeline `currentTime` to an (original-frame) cue
  // position synchronously, without waiting for state updates to flush.
  const speedByLanguageRef = useRef<Record<string, number>>({});
  const webLockResolveRef = useRef<(() => void) | null>(null);
  const webLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for callbacks to avoid re-triggering effects
  const onScheduleCompleteRef = useRef(onScheduleComplete);
  onScheduleCompleteRef.current = onScheduleComplete;
  const onResetReviewFlagRef = useRef(onResetReviewFlag);
  onResetReviewFlagRef.current = onResetReviewFlag;
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;


  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
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
  }, []);

  // --------------------------------------------------------------------------
  // Playback controls
  // --------------------------------------------------------------------------
  const play = useCallback(() => {
    const audio = getAudio();
    if (!audio.src || audio.src === '') return;
    // Replaying after the audio has run to completion: browsers are
    // inconsistent about what a bare .play() call does on an ended element.
    // In practice the element can stay "stuck" — play() resolves, but no
    // 'play' event fires, which means our isPlaying stays false and the
    // rAF loop never re-subscribes, so no word highlighting on the replay.
    //
    // .pause() + currentTime=0 first forces a clean "paused at 0" state;
    // the subsequent .play() then reliably fires 'play' and our reactive
    // currentTime snaps back so the highlight starts from the first word.
    if (audio.ended || (audio.duration && audio.currentTime >= audio.duration - 0.05)) {
      audio.pause();
      audio.currentTime = 0;
      setCurrentTime(0);
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
      .catch((err) => {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
        console.error('Audio play failed:', err);
      });
  }, [getAudio]);

  const pause = useCallback(() => {
    hasAutoPlayedForCardRef.current = true; // suppress pending auto-play
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
    setMediaSessionPlaybackState('none');
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && audio.duration) {
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
      setCurrentTime(audio.currentTime);
      updateMediaSessionPosition(audio.duration, audio.currentTime);
    }
  }, []);

  const clearCurrentAudio = useCallback(() => {
    const audio = getAudio();
    if (!audio.paused) audio.pause();
    audio.removeAttribute('src');
    audio.load();

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    languageCuesRef.current = [];
    speedByLanguageRef.current = {};
    setDurationSec(0);
    setIsPlaying(false);
    setRevealedLanguages(new Set());
    setCurrentTime(0);
    setLanguageCues([]);
    setSpeedByLanguage({});
    setMediaSessionPlaybackState('none');
  }, [getAudio]);

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
      setIsPlaying(true);
      setMediaSessionPlaybackState('playing');
      acquireWebLock();
    };

    const handlePause = () => {
      setIsPlaying(false);
      setMediaSessionPlaybackState('paused');
      releaseWebLockDelayed();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setMediaSessionPlaybackState('paused');
      releaseWebLockDelayed();
      onScheduleCompleteRef.current();
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDurationSec(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      const cues = languageCuesRef.current;
      if (cues.length === 0) return;
      const currentTime = audio.currentTime;
      setRevealedLanguages((prev) => {
        const toReveal = cues.filter((c) => c.startSec <= currentTime && !prev.has(c.language));
        if (toReveal.length === 0) return prev;
        const next = new Set(prev);
        for (const c of toReveal) next.add(c.language);
        return next;
      });
    };

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
  }, [getAudio]);

  // --------------------------------------------------------------------------
  // rAF-driven currentTime for smooth word highlighting. The native
  // `timeupdate` event fires ~4 Hz which is visibly laggy for karaoke.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setCurrentTime(audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // --------------------------------------------------------------------------
  // Merge audio when card changes, audio URLs arrive, or settings change
  // --------------------------------------------------------------------------
  const allAudioReady = audioRecordings.length > 0 && audioRecordings.every((a) => a.url);

  // Identity key for the audio set: changes on language changes, voice swaps,
  // and URL null↔present transitions, but not on signed-URL refreshes. Using
  // raw URL strings would cause needless remerges every time Convex refreshes
  // signed URLs while allAudioReady stays true.
  const audioIdentityKey = useMemo(() => {
    if (audioRecordings.length === 0) return '';
    return audioRecordings
      .map((a) => `${a.language}:${a.voiceName ?? 'none'}:${a.url ? '1' : '0'}`)
      .join('|');
  }, [audioRecordings]);

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
      }),
    [settings],
  );
  const baseOrderKey = orderedBase.join(',');
  const targetOrderKey = orderedTarget.join(',');

  const prevCardIdRef = useRef<string | null>(null);
  const hasAutoPlayedForCardRef = useRef(false);

  useEffect(() => {
    const isCardChange = prevCardIdRef.current !== cardId;
    prevCardIdRef.current = cardId;

    if (isCardChange) {
      hasAutoPlayedForCardRef.current = false;
    }

    const audioBefore = audioRef.current;
    const wasPlayingSameCard =
      !!audioBefore &&
      !audioBefore.paused &&
      cardId != null &&
      !isCardChange;

    // Capture the user's structural position BEFORE the remerge so we can seek
    // the new blob to the equivalent (language, repIndex, localTimeOriginal) —
    // otherwise `audio.src = newBlob` implicitly resets `currentTime` to 0 and
    // a mid-playback speed change restarts playback from the top.
    const resumePos =
      !isCardChange && audioBefore && languageCuesRef.current.length > 0
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
      // for URLs to return — so a reactive query hiccup doesn't strand audio.
      mergeAbortRef.current?.abort();
      mergeAbortRef.current = null;
      setIsMerging(false);
      if (isCardChange) clearCurrentAudio();
      return;
    }

    if (isCardChange) clearCurrentAudio();

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

        // Stop current playback before swapping the source
        if (!audio.paused) {
          audio.pause();
        }

        // Revoke previous blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }

        if (!result) {
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

        // Same-card remerge (e.g. settings tweak or client refresh): resume if
        // playback was already running so JWT/query churn does not strand audio.
        const shouldResumePlay = wasPlayingSameCard;
        const shouldAutoPlay =
          !wasPlayingSameCard &&
          !hasAutoPlayedForCardRef.current &&
          autoPlay &&
          getReviewInitiatedByThisTab();

        // Assigning `audio.src` resets `currentTime` to 0. If the user had a
        // structural position before this remerge, map it onto the new blob's
        // timeline and seek there once metadata is loaded — otherwise a speed
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
                setCurrentTime(clamped);
                updateMediaSessionPosition(result.durationSec, clamped);
              } catch {
                // readyState edge — safe to ignore; seek was best-effort.
              }
            }
          }
          if (shouldResumePlay) {
            audio.play().catch((err) => {
              if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
              console.error('Resume playback failed:', err);
            });
          } else if (shouldAutoPlay) {
            hasAutoPlayedForCardRef.current = true;
            onResetReviewFlagRef.current();
            audio.play().catch((err) => {
              if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
              console.error('Auto-play failed:', err);
            });
          }
        };

        if (audio.readyState >= 1 /* HAVE_METADATA */) {
          doResume();
        } else {
          audio.addEventListener('loadedmetadata', doResume, { once: true });
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('Audio merge failed:', err);
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
    return () => {
      mergeAbortRef.current?.abort();
      mediaSessionCleanupRef.current?.();
      if (webLockTimeoutRef.current) clearTimeout(webLockTimeoutRef.current);
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
    };
  }, []);

  return {
    play,
    pause,
    stop,
    seekTo,
    audioRef,
    isPlaying,
    isMerging,
    durationSec,
    revealedLanguages,
    currentTime,
    languageCues,
    speedByLanguage,
  };
}
