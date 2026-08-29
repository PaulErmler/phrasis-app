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

beforeEach(async () => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  // Reset the shared getPeak mock: `mockReturnValueOnce` queues outlive the
  // test that set them and would leak into the next one.
  const { getPeak } = await import('@/lib/audio/peakCache');
  vi.mocked(getPeak).mockReset();
  vi.mocked(getPeak).mockResolvedValue(1);
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

  it('rewinds the interrupted clip so replaying it starts from the beginning', async () => {
    // Pausing without rewinding meant interrupting clip A to hear B, then
    // pressing A again, resumed A from the middle.
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
    FakeAudio.instances[0].currentTime = 4.2; // partway through

    await user.click(second);
    await waitFor(() => expect(FakeAudio.instances[0].paused).toBe(true));
    expect(FakeAudio.instances[0].currentTime).toBe(0);
  });

  it('restarts a clip from the beginning rather than resuming it', async () => {
    const user = userEvent.setup();
    render(<AudioButton url="https://x/a.mp3" language="en" />);

    await user.click(playingButton());
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    const el = FakeAudio.instances[0];

    // Stop partway, then play again.
    el.currentTime = 3.5;
    await user.click(playingButton());
    await waitFor(() => expect(el.paused).toBe(true));

    el.currentTime = 3.5; // as if the pause had left it mid-clip
    await user.click(playingButton());
    await waitFor(() => expect(el.play).toHaveBeenCalledTimes(2));
    expect(el.currentTime).toBe(0);
  });

  it('stops the previous clip before the slow peak measurement, not after', async () => {
    // getPeak fetches and decodes; claiming the slot after it meant the old
    // clip kept playing for a noticeable beat after the user pressed another
    // button. Reading as "it didn't switch".
    const { getPeak } = await import('@/lib/audio/peakCache');
    let releasePeak!: (v: number) => void;
    vi.mocked(getPeak)
      .mockReturnValueOnce(Promise.resolve(1))
      .mockReturnValueOnce(
        new Promise<number>((resolve) => {
          releasePeak = resolve;
        }),
      );

    const user = userEvent.setup();
    render(
      <>
        <AudioButton url="https://x/a.mp3" language="en" />
        <AudioButton url="https://x/b.mp3" language="es" />
      </>,
    );
    const [first, second] = screen.getAllByRole('button');

    await user.click(first);
    await waitFor(() => expect(FakeAudio.instances[0]?.paused).toBe(false));

    // Second button clicked; its peak measurement has NOT resolved yet.
    await user.click(second);
    await waitFor(() => expect(FakeAudio.instances[0].paused).toBe(true));

    releasePeak(1);
    await waitFor(() =>
      expect(FakeAudio.instances[1]?.play).toHaveBeenCalled(),
    );
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

    // Starting the second must stop the first, without this, rapid clicks
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
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled());
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
