import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The real peak measurement fetches and decodes the clip through WebAudio,
// neither of which exists in jsdom. Playback behavior is what's under test.
vi.mock('@/lib/audio/peakCache', () => ({
  getPeak: vi.fn().mockResolvedValue(1),
  computeAttenuation: () => 1,
}));

import { AudioButton } from '@/components/app/learning/AudioButton';

/**
 * Minimal HTMLAudioElement stand-in. jsdom implements neither play() nor the
 * media event flow, and these tests turn on exactly that: who paused, and
 * whether the component noticed.
 */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  paused = true;
  ended = false;
  currentTime = 0;
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play = vi.fn(async () => {
    this.paused = false;
  });

  pause = vi.fn(() => {
    if (this.paused) return; // real elements don't re-fire pause
    this.paused = true;
    this.onpause?.();
  });

  /** Simulate playback running to completion. */
  finish() {
    this.paused = true;
    this.ended = true;
    this.onended?.();
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const playingButton = () => screen.getByRole('button');

describe('AudioButton playback state', () => {
  it('shows the playing state only while the element is actually playing', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<AudioButton url="https://x/a.mp3" language="en" onStop={onStop} />);

    await user.click(playingButton());
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled());
    expect(FakeAudio.instances[0].paused).toBe(false);

    // Natural end returns the button to idle.
    act(() => FakeAudio.instances[0].finish());
    await waitFor(() => expect(onStop).toHaveBeenCalledWith('en'));
  });

  it('leaves the playing state when something else pauses the element', async () => {
    // The regression: only onended/onerror could clear `isPlaying`, so any
    // externally-initiated pause left the button showing "playing" in silence.
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<AudioButton url="https://x/a.mp3" language="en" onStop={onStop} />);

    await user.click(playingButton());
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled());

    act(() => FakeAudio.instances[0].pause());

    await waitFor(() => expect(onStop).toHaveBeenCalledWith('en'));
  });

  it('only lets one clip play at a time across separate buttons', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AudioButton url="https://x/a.mp3" language="en" />
        <AudioButton url="https://x/b.mp3" language="es" />
      </>,
    );
    const [first, second] = screen.getAllByRole('button');

    await user.click(first);
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    expect(FakeAudio.instances[0].paused).toBe(false);

    // Starting the second must stop the first — without this, rapid clicks
    // stacked concurrent elements and the browser silently killed some.
    await user.click(second);
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    await waitFor(() => expect(FakeAudio.instances[0].paused).toBe(true));
    expect(FakeAudio.instances[1].paused).toBe(false);
  });
});

describe('AudioButton click-to-generate', () => {
  it('auto-plays audio that arrives after the spinner timed out', async () => {
    // Synthesis routinely outlives GENERATE_TIMEOUT_MS (an OpenRouter round
    // trip plus STT validation). Timing out used to discard the intent to
    // play, so the clip landed silently.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    const onRequestGenerate = vi.fn().mockResolvedValue({ scheduled: true });

    const { rerender } = render(
      <AudioButton
        url={null}
        language="yue"
        onRequestGenerate={onRequestGenerate}
      />,
    );

    await user.click(playingButton());
    expect(onRequestGenerate).toHaveBeenCalled();

    // Outlive the spinner.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    // Audio finally lands.
    rerender(
      <AudioButton
        url="https://x/late.mp3"
        language="yue"
        onRequestGenerate={onRequestGenerate}
      />,
    );

    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    await waitFor(() =>
      expect(FakeAudio.instances[0].play).toHaveBeenCalled(),
    );
  });

  it('does not auto-play when the click scheduled nothing', async () => {
    const user = userEvent.setup();
    const onRequestGenerate = vi.fn().mockResolvedValue({ scheduled: false });

    const { rerender } = render(
      <AudioButton
        url={null}
        language="yue"
        onRequestGenerate={onRequestGenerate}
      />,
    );

    await user.click(playingButton());
    await waitFor(() => expect(onRequestGenerate).toHaveBeenCalled());

    // An unrelated URL arriving later must not spontaneously start playing.
    rerender(
      <AudioButton
        url="https://x/unrelated.mp3"
        language="yue"
        onRequestGenerate={onRequestGenerate}
      />,
    );

    await Promise.resolve();
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
