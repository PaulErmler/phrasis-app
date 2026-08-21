'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { getLanguageShortLabel } from '@/lib/languages';
import { computeAttenuation, getPeak } from '@/lib/audio/peakCache';

/**
 * How long a generate click may hold the spinner while waiting for the URL.
 * TTS can fail terminally without any signal reaching this component (the
 * claim is just released; no audio row is ever written), so the spinner must
 * never be permanent. If generation is merely slow, reverting to the
 * clickable state is safe: a re-click is a claim-deduped backend no-op and
 * the [url] effect still auto-plays whenever the URL lands.
 */
const GENERATE_TIMEOUT_MS = 30_000;

/**
 * The single clip allowed to be audible at any moment, across every
 * AudioButton on the page.
 *
 * Without this, each button owned its own HTMLAudioElement with no awareness
 * of the others: clicking several play buttons in quick succession started
 * concurrent playback, and the browser/OS media layer would silently stop or
 * refuse some of them, leaving those buttons stuck showing the playing icon
 * in silence. Learning mode escaped it only because its call sites pass
 * `onPlay` to stop the main player first; the collection preview and the
 * library views never did.
 *
 * Registering here rather than fixing each call site means a new call site
 * cannot reintroduce the bug by forgetting a prop. Pausing the previous
 * element fires its `pause` handler, which is what drops that button out of
 * the playing state. See the `onpause` wiring in `handlePlay`.
 */
let currentlyPlaying: HTMLAudioElement | null = null;

/**
 * Claim the audible slot for `next`, stopping whoever held it.
 *
 * The interrupted clip is rewound, not just paused: a paused element resumes
 * from the middle on its next play, so interrupting clip A to hear B and then
 * pressing A again would drop the listener into the middle of A. Every button
 * press should start its clip from the beginning.
 */
function claimPlayback(next: HTMLAudioElement): void {
  const previous = currentlyPlaying;
  // Hand the slot over BEFORE pausing. `pause()` can dispatch its event
  // synchronously, which re-enters `releasePlayback` via the previous
  // button's stop handler; if the slot still named `previous` at that moment
  // it would be cleared to null underneath us, and the rest of this function
  // would then be operating on nothing.
  currentlyPlaying = next;
  if (previous && previous !== next) {
    previous.pause();
    previous.currentTime = 0;
  }
}

/** Release the slot, but only if `audio` is the one still holding it. */
function releasePlayback(audio: HTMLAudioElement | null): void {
  if (audio && currentlyPlaying === audio) currentlyPlaying = null;
}

export interface AudioButtonProps {
  url: string | null;
  /** Canonical language code (e.g. "en", "es_latam"). Broadcast verbatim through onTimeUpdate/onStop so consumers can match against translation.language. The visible label is derived via getLanguageShortLabel. */
  language: string;
  /** Show a text label next to the icon (used in DeckCardsView). Default: false */
  showLabel?: boolean;
  /** If true, immediately stop current playback and prevent new playback. */
  stopPlayback?: boolean;
  /** Called just before this button starts playing audio (e.g. to stop the main player). */
  onPlay?: () => void;
  /** rAF-frequency time updates while playing; used for word highlighting. */
  onTimeUpdate?: (language: string, localTime: number) => void;
  /** Fired when playback ends, is paused, or the component unmounts. */
  onStop?: (language: string) => void;
  /**
   * Playback rate applied via `HTMLMediaElement.playbackRate`. Pitch is kept
   * stable by `preservesPitch = true`. Defaults to 1 so call sites that don't
   * care about speed (e.g. collection previews) get native speed automatically.
   */
  speed?: number;
  /**
   * Click-to-generate: when `url` is null and this is provided, the button
   * renders ENABLED and a click invokes it to kick off audio generation
   * (spinner until the reactive query delivers the URL, then auto-play).
   * Without it, the historical behavior stays: null url = disabled spinner.
   */
  onRequestGenerate?: () => Promise<unknown> | void;
  /**
   * Keyboard replay channel: any change to this nonce (re)starts the clip
   * from the beginning, exactly as if the button had been clicked. The mount
   * value is ignored so a stale nonce never auto-plays a fresh card.
   */
  playSignal?: number;
}

export function AudioButton({
  url,
  language,
  showLabel = false,
  stopPlayback = false,
  onPlay,
  onTimeUpdate,
  onStop,
  speed = 1,
  onRequestGenerate,
  playSignal,
}: AudioButtonProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Mirrors `isPlaying` for the media event handlers, which are attached once
  // per element and would otherwise close over a stale value.
  const isPlayingRef = useRef(false);
  // Set when the user clicked generate: the URL arriving should start
  // playback without a second tap (best effort, see the autoplay note).
  const pendingPlayRef = useRef(false);
  const generateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  /**
   * Single exit from the playing state, whoever triggered it. The natural
   * end of the clip, an explicit toggle, `stopPlayback`, or another button
   * claiming playback through `stopOtherPlayback`. Guarded on
   * `isPlayingRef` so the transition (and the `onStop` broadcast) happens
   * exactly once even when a pause and an explicit stop coincide.
   */
  const markStoppedRef = useRef<() => void>(() => {});
  markStoppedRef.current = () => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;
    // No-ops when another button has already claimed the slot (the common
    // case: our onpause fired *because* it claimed it).
    releasePlayback(audioRef.current);
    setIsPlaying(false);
    onStopRef.current?.(language);
  };

  useEffect(() => {
    if (!stopPlayback || !audioRef.current) return;
    // `pause()` fires onpause → markStopped, which owns the state transition
    // and the onStop broadcast.
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsLoading(false);
  }, [stopPlayback, language]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        // Detach first: the pause below must not run markStopped against an
        // unmounting component.
        audio.onended = null;
        audio.onerror = null;
        audio.onpause = null;
        audio.pause();
        audio.currentTime = 0;
        releasePlayback(audio);
      }
      audioRef.current = null;
      isPlayingRef.current = false;
      onStopRef.current?.(language);
    };
  }, [language]);

  // Keep an already-running HTMLAudioElement in sync when the `speed` prop
  // changes mid-playback (e.g. user cycles the per-card speed badge while a
  // clip is playing). No-op when no element is mounted yet.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // rAF-driven time broadcast while playing. Native `timeupdate` at ~4 Hz is
  // too coarse for smooth per-word highlighting.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) onTimeUpdateRef.current?.(language, audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, language]);

  /**
   * Release the spinner. `abandonPlay` decides whether the *intent* to play
   * survives:
   *   - timeout  → keep it. Synthesis routinely outlives the spinner (an
   *     OpenRouter round-trip plus up to two Azure STT validation passes), and
   *     dropping it here is what made a slow clip land silently: the URL
   *     arrived, but the auto-play effect is gated on `pendingPlayRef`.
   *   - `{scheduled:false}` or a thrown error → drop it. No URL is coming from
   *     this click, so a later unrelated URL must not spontaneously play.
   */
  const resetGenerating = (abandonPlay: boolean) => {
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
      generateTimeoutRef.current = null;
    }
    setIsGenerating(false);
    if (abandonPlay) pendingPlayRef.current = false;
  };

  const handleRequestGenerate = async () => {
    if (!onRequestGenerate || isGenerating) return;
    setIsGenerating(true);
    pendingPlayRef.current = true;
    if (generateTimeoutRef.current) clearTimeout(generateTimeoutRef.current);
    generateTimeoutRef.current = setTimeout(
      () => resetGenerating(false),
      GENERATE_TIMEOUT_MS,
    );
    try {
      const result = await onRequestGenerate();
      // `{scheduled: false}` means this click enqueued nothing (translation
      // not landed yet, or a previous job's claim still holds the slot), no
      // URL is coming from it, so don't hold the spinner.
      if (
        result &&
        typeof result === 'object' &&
        'scheduled' in result &&
        (result as { scheduled?: unknown }).scheduled === false
      ) {
        resetGenerating(true);
      }
    } catch (error) {
      console.error('Error requesting audio generation:', error);
      resetGenerating(true);
    }
    // On success we stay in the generating state. The reactive query
    // delivers the URL and the effect below flips us out of it (or the
    // GENERATE_TIMEOUT_MS guard does, if the job dies without a trace).
  };

  // True while a play is spinning up (awaiting getPeak / play()). During
  // that window `isPlaying` is still false and the element still paused, so
  // a second trigger (e.g. the T shortcut ~100ms after a click) would start
  // a concurrent play() on the same element and desync the button state.
  const playInFlightRef = useRef(false);

  const handlePlay = async () => {
    if (!url) return;

    if (isPlaying && audioRef.current) {
      // onpause → markStopped owns the state transition and onStop broadcast.
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      releasePlayback(audioRef.current);
      return;
    }

    if (playInFlightRef.current) return;
    playInFlightRef.current = true;
    setIsLoading(true);
    onPlay?.();
    try {
      if (!audioRef.current || audioRef.current.src !== url) {
        audioRef.current = new Audio(url);
        audioRef.current.onended = () => markStoppedRef.current();
        audioRef.current.onerror = () => {
          setIsLoading(false);
          markStoppedRef.current();
        };
        // The element is the source of truth for whether sound is coming out.
        // Anything can pause it. Another AudioButton via `claimPlayback`, the
        // OS media controls, a headphone disconnect, or the browser's own
        // media policy, and without this the button would keep showing the
        // playing icon in silence.
        audioRef.current.onpause = () => markStoppedRef.current();
      }
      // Keep pitch stable across playbackRate changes. `preservesPitch`
      // defaults to true in modern browsers; setting it explicitly (including
      // the webkit alias) guards older Safari and makes intent obvious.
      audioRef.current.preservesPitch = true;
      const el = audioRef.current as HTMLAudioElement & {
        webkitPreservesPitch?: boolean;
      };
      el.webkitPreservesPitch = true;
      audioRef.current.playbackRate = speed;
      // Claim the audible slot BEFORE the peak measurement, not after. That
      // measurement fetches and decodes the clip, so for anything not already
      // cached it takes long enough that the previously playing clip would
      // keep going for a noticeable beat after the user pressed a different
      // button. Reading as "it didn't switch".
      claimPlayback(audioRef.current);
      // Capture the element before awaiting. If another handlePlay swaps
      // audioRef.current (different URL) while getPeak is in-flight, we'd
      // otherwise apply this clip's attenuation to the wrong element.
      const peakTarget = audioRef.current;
      try {
        const peak = await getPeak(url);
        if (audioRef.current === peakTarget) {
          peakTarget.volume = computeAttenuation(peak);
        }
      } catch (peakErr) {
        console.warn('Peak measurement failed; playing at native volume', peakErr);
      }
      // Always start from the beginning. Rewinding only when `ended` left the
      // interrupted case broken: an element paused mid-clip (by the toggle, by
      // `stopPlayback`, or by another button claiming the slot) resumed from
      // wherever it stopped. It also keeps the first onTimeUpdate broadcasting
      // 0 rather than the previous run's position.
      audioRef.current.currentTime = 0;
      await audioRef.current.play();
      isPlayingRef.current = true;
      setIsPlaying(true);
    } catch (error) {
      console.error('Error playing audio:', error);
    } finally {
      playInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handlePlayRef = useRef(handlePlay);
  handlePlayRef.current = handlePlay;

  // Keyboard replay: restart from 0 on every nonce change. A clip that is
  // already playing is rewound in place; otherwise this is a plain click.
  const lastPlaySignalRef = useRef(playSignal);
  useEffect(() => {
    if (playSignal === undefined || playSignal === lastPlaySignalRef.current) {
      return;
    }
    lastPlaySignalRef.current = playSignal;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.currentTime = 0;
      return;
    }
    void handlePlayRef.current();
  }, [playSignal]);

  // Generated audio arrived (url flipped non-null after a generate click):
  // leave the generating state and auto-play. `play()` may be rejected by
  // strict autoplay policies (iOS Safari, the gesture is long gone by now);
  // handlePlay already swallows that, leaving the button in the normal ready
  // state for a second tap.
  useEffect(() => {
    if (!url) return;
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
      generateTimeoutRef.current = null;
    }
    setIsGenerating(false);
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false;
      void handlePlayRef.current();
    }
  }, [url]);

  useEffect(
    () => () => {
      if (generateTimeoutRef.current) clearTimeout(generateTimeoutRef.current);
    },
    [],
  );

  // Icon-only variant (learning mode)
  if (!showLabel) {
    if (!url) {
      if (onRequestGenerate && !isGenerating) {
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestGenerate}
            className="h-7 w-7"
          >
            <Volume2 className="h-4 w-4" />
          </Button>
        );
      }
      return (
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="h-7 w-7 text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePlay}
        disabled={isLoading || stopPlayback}
        className="h-7 w-7"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isPlaying ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </Button>
    );
  }

  // Labeled variant (deck cards view)
  if (!url) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="gap-1 text-muted-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Generating {getLanguageShortLabel(language)}...</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handlePlay}
      disabled={isLoading || stopPlayback}
      className="gap-1"
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isPlaying ? (
        <VolumeX className="h-3 w-3" />
      ) : (
        <Volume2 className="h-3 w-3" />
      )}
      <span className="text-xs">{getLanguageShortLabel(language)}</span>
    </Button>
  );
}
