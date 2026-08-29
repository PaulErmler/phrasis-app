import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';

/**
 * AI writing feedback wiring in FullReviewCardContent: the kick-off effect
 * (local gate vs LLM call), the coach card rendering, and the accuracy
 * override when the grader accepts an alternative.
 */

const { gradeMock, editCardMock, toastErrorMock } = vi.hoisted(() => ({
  gradeMock: vi.fn(),
  editCardMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>();
  return {
    ...actual,
    useAction: () => gradeMock,
    useMutation: () => editCardMock,
  };
});
vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: ({ featureId }: { featureId: string }) => (
    <div data-testid="usage-limit-dialog" data-feature={featureId} />
  ),
}));
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return {
    ...actual,
    toast: { ...actual.toast, error: toastErrorMock },
  };
});
vi.mock('@/lib/audio/peakCache', () => ({
  getPeak: vi.fn().mockResolvedValue(1),
  computeAttenuation: () => 1,
}));

import { FullReviewCardContent } from '@/components/app/learning/FullReviewCardContent';
import type {
  CardTranslation,
  WritingAccuracySummary,
} from '@/components/app/learning/types';
import { computeAccuracyPair } from '@/lib/textCompare';
import type { Id } from '@/convex/_generated/dataModel';
import { makePresentation } from './cardPresentationStub';

const TRANSLATIONS: CardTranslation[] = [
  {
    language: 'en',
    text: 'I would like a coffee.',
    isBaseLanguage: true,
    isTargetLanguage: false,
  },
  {
    language: 'es',
    text: 'Quisiera un café.',
    isBaseLanguage: false,
    isTargetLanguage: true,
  },
];

const CARD_ID = 'card_1' as Id<'cards'>;

function renderCard(
  opts: {
    aiFeedbackEnabled?: boolean;
    transcribeMode?: boolean;
    translations?: CardTranslation[];
  } = {},
) {
  const onAccuracyChange = vi.fn();
  render(
    <FullReviewCardContent
      presentation={makePresentation({
        cardId: CARD_ID,
        sourceText: 'I would like a coffee.',
        translations: opts.translations ?? TRANSLATIONS,
      })}
      targetAudioMode="never"
      transcribeMode={opts.transcribeMode ?? false}
      aiFeedbackEnabled={opts.aiFeedbackEnabled ?? true}
      onAccuracyChange={onAccuracyChange}
    />,
  );
  return onAccuracyChange;
}

function submitAnswer(value: string) {
  const input = screen.getByTestId('learn-translation-input');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function lastSummary(fn: ReturnType<typeof vi.fn>): WritingAccuracySummary {
  return fn.mock.calls.at(-1)?.[0];
}

class AutoPlayFakeAudio {
  static srcs: string[] = [];
  static last: AutoPlayFakeAudio | null = null;
  paused = true;
  currentTime = 0;
  playbackRate = 1;
  preservesPitch = true;
  muted = false;
  loop = false;
  onended: (() => void) | null = null;
  #src: string;
  constructor(src: string) {
    this.#src = src;
    AutoPlayFakeAudio.srcs.push(src);
    AutoPlayFakeAudio.last = this;
  }
  defaultPlaybackRate = 1;
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    AutoPlayFakeAudio.srcs.push(value);
    // Browsers run the media load algorithm on src assignment, which resets
    // playbackRate to defaultPlaybackRate. A rate set before src is lost.
    this.playbackRate = this.defaultPlaybackRate;
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

function playedClips() {
  return AutoPlayFakeAudio.srcs.filter((src) => !src.startsWith('data:'));
}

describe('FullReviewCardContent: AI writing feedback', () => {
  beforeEach(() => {
    gradeMock.mockReset();
    editCardMock.mockReset();
    toastErrorMock.mockReset();
    AutoPlayFakeAudio.srcs = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a punctuation-only difference locally without calling the action', async () => {
    const onAccuracyChange = renderCard();
    submitAnswer('Quisiera un café');
    // Local verdict renders nothing (the green diff is the signal); the tell
    // is that the summary lands without any server call or pending skeleton.
    await waitFor(() =>
      expect(lastSummary(onAccuracyChange)?.submittedCount).toBe(1),
    );
    expect(gradeMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('writing-feedback-pending'),
    ).not.toBeInTheDocument();
  });

  it('grades a non-matching answer and renders the coach card', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'minor',
      corrected: 'Quisiera un café.',
      notes: [{ type: 'spelling', text: 'cafe is missing its accent.' }],
      savedAlternative: false,
    });
    renderCard();
    submitAnswer('Quisiera un cafe.');
    await waitFor(() =>
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument(),
    );
    expect(gradeMock).toHaveBeenCalledTimes(1);
    expect(gradeMock).toHaveBeenCalledWith({
      cardId: CARD_ID,
      language: 'es',
      userAnswer: 'Quisiera un cafe.',
      mode: 'translate',
    });
    expect(screen.getByText('verdict.minor')).toBeInTheDocument();
  });

  it('grades in transcribe mode too, sending mode transcribe', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'partial',
      notes: [{ type: 'wordChoice', text: 'The audio said something else.' }],
    });
    renderCard({ transcribeMode: true });
    submitAnswer('Quisiera un té.');
    await waitFor(() =>
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument(),
    );
    expect(gradeMock).toHaveBeenCalledWith({
      cardId: CARD_ID,
      language: 'es',
      userAnswer: 'Quisiera un té.',
      mode: 'transcribe',
    });
    expect(screen.getByText('verdict.partial')).toBeInTheDocument();
  });

  it('transcribe: a stored accepted alternative grants no local credit — the grader decides', async () => {
    // In translate this exact submit resolves in the free local gate (see the
    // 'resolves a stored accepted alternative locally' test below). In
    // transcribe the answer must match the audio, so the same text goes to
    // the server, which grades it as a transcription.
    gradeMock.mockResolvedValue({
      verdict: 'partial',
      notes: [{ type: 'wordChoice', text: 'Not what the audio said.' }],
    });
    const withAlternatives: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [{ text: 'Me gustaría un café.' }],
      },
    ];
    renderCard({ transcribeMode: true, translations: withAlternatives });
    submitAnswer('Me gustaría un café.');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(1));
    expect(gradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'transcribe' }),
    );
    await waitFor(() =>
      expect(screen.getByText('verdict.partial')).toBeInTheDocument(),
    );
  });

  it('overrides the accuracy pair to 100 when the grader accepts an alternative', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'alsoCorrect',
      corrected: 'Me gustaría un café.',
      notes: [],
      savedAlternative: true,
    });
    const onAccuracyChange = renderCard();
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(screen.getByText('verdict.alsoCorrect')).toBeInTheDocument(),
    );
    const summary = lastSummary(onAccuracyChange);
    expect(summary.minWithPunctuation).toBe(100);
    expect(summary.minWithoutPunctuation).toBe(100);
  });

  it('returns keyboard focus to the card after feedback so Enter can go to the next card', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'alsoCorrect',
      corrected: 'Me gustaría un café.',
      notes: [
        { type: 'naturalness', text: 'More everyday than the card sentence.' },
      ],
      savedAlternative: true,
    });
    renderCard();
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(screen.getByText('verdict.alsoCorrect')).toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(
      screen.getByTestId('writing-review-card'),
    );
  });

  it('rescored against the corrected sentence once a partial verdict lands, matching the diff', async () => {
    const corrected = 'Me gustaría tomar un té.';
    gradeMock.mockResolvedValue({
      verdict: 'partial',
      corrected,
      notes: [{ type: 'vocab', text: 'Different drink and phrasing.' }],
      savedAlternative: false,
    });
    const onAccuracyChange = renderCard();
    const answer = 'Me gustaria tomar un te.';
    submitAnswer(answer);
    await waitFor(() =>
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument(),
    );
    // The summary must re-rank over the SAME candidate list the diff shows
    // (primary + alternatives + gradedCorrected). Before the shared
    // answerCandidates builder, only the diff got `corrected`: the screen
    // showed a near-perfect diff while the preselected rating was scored
    // against the primary sentence.
    const summary = lastSummary(onAccuracyChange);
    const vsCorrected = computeAccuracyPair(corrected, answer, 'es');
    const vsPrimary = computeAccuracyPair('Quisiera un café.', answer, 'es');
    expect(vsCorrected.withoutPunctuation).toBeGreaterThan(
      vsPrimary.withoutPunctuation,
    );
    expect(summary.minWithoutPunctuation).toBe(vsCorrected.withoutPunctuation);
    expect(summary.minWithPunctuation).toBe(vsCorrected.withPunctuation);
  });

  it('falls back to the plain diff view on a grader error', async () => {
    gradeMock.mockRejectedValue(new Error('boom'));
    renderCard();
    submitAnswer('algo muy diferente');
    await waitFor(() => expect(gradeMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByTestId('writing-feedback-pending'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('writing-feedback-card'),
    ).not.toBeInTheDocument();
  });

  it('still grades on first-exposure copy-typing rows (regression: a fresh course is all first-exposure)', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'minor',
      corrected: 'Quisiera un café.',
      notes: [{ type: 'spelling', text: 'cafe is missing its accent.' }],
      savedAlternative: false,
    });
    const onAccuracyChange = vi.fn();
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: TRANSLATIONS,
        })}
        targetAudioMode="never"
        aiFeedbackEnabled
        firstExposure
        onAccuracyChange={onAccuracyChange}
      />,
    );
    submitAnswer('Quisiera un cafe.');
    await waitFor(() =>
      expect(screen.getByTestId('writing-feedback-card')).toBeInTheDocument(),
    );
    expect(gradeMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a stored accepted alternative locally, diffs against it, and lists the card sentence below', async () => {
    const withAlternatives: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [
          { text: 'Me gustaría un café.', romanization: 'me gustaria un cafe' },
        ],
      },
    ];
    const onAccuracyChange = vi.fn();
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: withAlternatives,
        })}
        targetAudioMode="never"
        aiFeedbackEnabled
        onAccuracyChange={onAccuracyChange}
      />,
    );
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(lastSummary(onAccuracyChange)?.minWithPunctuation).toBe(100),
    );
    // Matched the stored alternative locally: no server call, no extra chip —
    // the 100% diff is the whole signal.
    expect(gradeMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('writing-feedback-pending'),
    ).not.toBeInTheDocument();
    // The diff targets the alternative, so the card's own sentence is listed
    // below as another accepted answer.
    const others = screen.getByTestId('writing-feedback-other-accepted');
    expect(others).toHaveTextContent('Quisiera un café.');
  });

  it('plays the shown alternative on the header speaker and the card sentence on the list speaker', async () => {
    const withAlternatives: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [
          {
            text: 'Me gustaría un café.',
            audioUrl: 'https://cdn.example/alt.mp3',
          },
        ],
      },
    ];
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: withAlternatives,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="never"
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(screen.getByTestId('shown-sentence-audio')).toHaveAttribute(
        'data-audio-url',
        'https://cdn.example/alt.mp3',
      ),
    );
    expect(screen.getByTestId('accepted-audio')).toHaveAttribute(
      'data-audio-url',
      'https://cdn.example/primary.mp3',
    );
  });

  it('auto-plays the matching alternative clip on reveal, not the card sentence', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    const withAlternatives: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [
          {
            text: 'Me gustaría un café.',
            audioUrl: 'https://cdn.example/alt.mp3',
          },
        ],
      },
    ];
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: withAlternatives,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="afterSubmit"
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Me gustaría un café.');
    await waitFor(() => {
      expect(playedClips()).toContain('https://cdn.example/alt.mp3');
      // Local match sets feedback to `done`; that used to pause this
      // element in the play-effect cleanup and then skip the replay.
      expect(AutoPlayFakeAudio.last?.paused).toBe(false);
    });
    expect(playedClips()).not.toContain('https://cdn.example/primary.mp3');
  });

  it('keeps the card-sentence clip playing after the local-match grade settles', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: TRANSLATIONS,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="afterSubmit"
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Quisiera un café.');
    await waitFor(() =>
      expect(playedClips()).toContain('https://cdn.example/primary.mp3'),
    );
    // The parent's kick-off effect sets `feedback: done` for the local match
    // one commit after the clip starts; that state change used to tear the
    // clip down in the play-effect cleanup and skip the replay.
    expect(gradeMock).not.toHaveBeenCalled();
    expect(AutoPlayFakeAudio.last?.paused).toBe(false);
    expect(AutoPlayFakeAudio.last?.pause).not.toHaveBeenCalled();
    expect(playedClips()).toEqual(['https://cdn.example/primary.mp3']);
  });

  it('plays the first run of a clip at the configured after-submit speed', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: TRANSLATIONS,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="afterSubmit"
        afterSubmitPlaybackSpeeds={{ es: 0.8 }}
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Quisiera un café.');
    await waitFor(() =>
      expect(playedClips()).toContain('https://cdn.example/primary.mp3'),
    );
    // Assigning src resets playbackRate to defaultPlaybackRate (modeled by
    // the fake); the rate must be applied after src or the first play runs
    // at 1x.
    expect(AutoPlayFakeAudio.last?.playbackRate).toBe(0.8);
  });

  it('does not start a clip when toggling between corrections and the clean sentence', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    const withAlternatives: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [
          {
            text: 'Me gustaría un café.',
            audioUrl: 'https://cdn.example/alt.mp3',
          },
        ],
      },
    ];
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: withAlternatives,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="afterSubmit"
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(playedClips()).toContain('https://cdn.example/alt.mp3'),
    );
    const before = playedClips().length;
    // "Show sentence" retargets the header speaker to the card sentence;
    // that must not auto-play it (the autoplay clip is derived from the
    // submission, not from the toggle).
    fireEvent.click(screen.getByRole('button', { name: 'showSentence' }));
    expect(playedClips().length).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'showCorrections' }));
    expect(playedClips().length).toBe(before);
  });

  it('plays the card clip for a graded-with-corrections answer instead of spinning forever', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    let resolveGrade!: (value: unknown) => void;
    gradeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGrade = resolve;
        }),
    );
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: TRANSLATIONS,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="afterSubmit"
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Quisera un cafe.');
    await waitFor(() =>
      expect(
        screen.getByTestId('writing-feedback-pending'),
      ).toBeInTheDocument(),
    );
    expect(playedClips()).toEqual([]);

    await act(async () => {
      resolveGrade({
        verdict: 'minor',
        corrected: 'Quisiera un café.',
        notes: [{ type: 'spelling', text: 'Watch the accents.' }],
      });
    });
    // The corrected sentence is never stored as an alternative, so no clip
    // will ever arrive for it; the header speaker falls back to the card's
    // own clip and autoplay plays it.
    await waitFor(() =>
      expect(playedClips()).toContain('https://cdn.example/primary.mp3'),
    );
    expect(screen.getByTestId('shown-sentence-audio')).toHaveAttribute(
      'data-audio-url',
      'https://cdn.example/primary.mp3',
    );
  });

  it('does not auto-play the card sentence while the grader may still accept an alternative', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    gradeMock.mockReturnValue(new Promise(() => {}));
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: TRANSLATIONS,
          audioRecordings: [
            {
              language: 'es',
              voiceName: null,
              url: 'https://cdn.example/primary.mp3',
              wordTimings: null,
              ttsQuality: null,
            },
          ],
        })}
        targetAudioMode="afterSubmit"
        aiFeedbackEnabled
      />,
    );
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(
        screen.getByTestId('writing-feedback-pending'),
      ).toBeInTheDocument(),
    );
    expect(playedClips()).toEqual([]);
  });

  it('auto-plays the alternative once its clip lands after an alsoCorrect grade', async () => {
    AutoPlayFakeAudio.srcs = [];
    vi.stubGlobal('Audio', AutoPlayFakeAudio);
    let resolveGrade!: (value: unknown) => void;
    gradeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGrade = resolve;
        }),
    );
    const basePresentation = {
      cardId: CARD_ID,
      sourceText: 'I would like a coffee.',
      translations: TRANSLATIONS,
      audioRecordings: [
        {
          language: 'es',
          voiceName: null,
          url: 'https://cdn.example/primary.mp3',
          wordTimings: null,
          ttsQuality: null,
        },
      ],
    };
    const props = {
      presentation: makePresentation(basePresentation),
      targetAudioMode: 'afterSubmit' as const,
      aiFeedbackEnabled: true,
    };
    const { rerender } = render(<FullReviewCardContent {...props} />);
    submitAnswer('Me gustaría un café.');
    await waitFor(() =>
      expect(
        screen.getByTestId('writing-feedback-pending'),
      ).toBeInTheDocument(),
    );
    expect(playedClips()).toEqual([]);

    await act(async () => {
      resolveGrade({
        verdict: 'alsoCorrect',
        corrected: 'Me gustaría un café.',
        notes: [],
        savedAlternative: true,
      });
    });
    await waitFor(() =>
      expect(screen.getByText('verdict.alsoCorrect')).toBeInTheDocument(),
    );
    expect(playedClips()).toEqual([]);

    const withAudio: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        ...TRANSLATIONS[1],
        alternatives: [
          {
            text: 'Me gustaría un café.',
            audioUrl: 'https://cdn.example/alt.mp3',
          },
        ],
      },
    ];
    rerender(
      <FullReviewCardContent
        {...props}
        presentation={makePresentation({
          ...basePresentation,
          translations: withAudio,
        })}
      />,
    );
    await waitFor(() =>
      expect(playedClips()).toContain('https://cdn.example/alt.mp3'),
    );
    expect(playedClips()).not.toContain('https://cdn.example/primary.mp3');
  });

  it('does nothing when the setting is off', async () => {
    renderCard({ aiFeedbackEnabled: false });
    submitAnswer('algo muy diferente');
    await new Promise((r) => setTimeout(r, 10));
    expect(gradeMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('writing-feedback-pending'),
    ).not.toBeInTheDocument();
  });

  it('clears on-screen feedback rows when the setting turns off mid-card', async () => {
    // The quota line's "Turn off" flips the setting while rows are showing;
    // stale pending/limit rows must not linger until the next card.
    gradeMock.mockReturnValue(new Promise(() => {}));
    const props = {
      presentation: makePresentation({
        cardId: CARD_ID,
        sourceText: 'I would like a coffee.',
        translations: TRANSLATIONS,
      }),
      targetAudioMode: 'never' as const,
    };
    const { rerender } = render(
      <FullReviewCardContent {...props} aiFeedbackEnabled />,
    );
    submitAnswer('algo muy diferente');
    await waitFor(() =>
      expect(
        screen.getByTestId('writing-feedback-pending'),
      ).toBeInTheDocument(),
    );
    rerender(<FullReviewCardContent {...props} aiFeedbackEnabled={false} />);
    await waitFor(() =>
      expect(
        screen.queryByTestId('writing-feedback-pending'),
      ).not.toBeInTheDocument(),
    );
  });

  it('sends a long-sentence one-char typo to the grader instead of rounding it to correct', async () => {
    // The local gate is exact-normalized EQUALITY (mirror of the server's
    // writingAnswersMatch), not a rounded accuracy >= 100: with enough words,
    // a single-character slip rounds to 100 and the old gate silently marked
    // it correct, defeating the server's documented "a one-character typo
    // should reach the LLM and come back as a 'minor' verdict".
    const primary = Array.from({ length: 60 }, () => 'bonita').join(' ') + '.';
    const answer = primary.replace(/bonita\.$/, 'bonitaa.');
    // Self-check the construction: the rounded lenient score IS 100 here.
    const { computeAccuracyPair } = await import('@/lib/textCompare');
    expect(computeAccuracyPair(primary, answer, 'es').withoutPunctuation).toBe(
      100,
    );
    gradeMock.mockResolvedValue({
      verdict: 'minor',
      corrected: primary,
      notes: [{ type: 'spelling', text: 'bonitaa has a doubled letter.' }],
      savedAlternative: false,
    });
    const longTranslations: CardTranslation[] = [
      TRANSLATIONS[0],
      {
        language: 'es',
        text: primary,
        isBaseLanguage: false,
        isTargetLanguage: true,
      },
    ];
    render(
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: longTranslations,
        })}
        targetAudioMode="never"
        aiFeedbackEnabled
      />,
    );
    submitAnswer(answer);
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText('verdict.minor')).toBeInTheDocument(),
    );
  });

  it('routes a card_edits USAGE_LIMIT from make-default to the upgrade dialog, not the retry toast', async () => {
    gradeMock.mockResolvedValue({
      verdict: 'alsoCorrect',
      corrected: 'Me gustaría un café.',
      notes: [{ type: 'naturalness', text: 'Equally natural phrasing.' }],
      savedAlternative: true,
    });
    const { ConvexError } = await import('convex/values');
    editCardMock.mockRejectedValue(new ConvexError({ code: 'USAGE_LIMIT' }));
    renderCard();
    submitAnswer('Me gustaría un café, por favor.');
    await waitFor(() =>
      expect(
        screen.getByTestId('writing-feedback-make-default-confirm'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByTestId('writing-feedback-make-default-confirm'),
    );
    // A spent card_edits balance opens the paywall (same routing as
    // EditCardDialog) — the generic "please try again" toast would invite a
    // retry that can never succeed.
    await waitFor(() =>
      expect(screen.getByTestId('usage-limit-dialog')).toHaveAttribute(
        'data-feature',
        'card_edits',
      ),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
    // The coach card's button resets so a post-upgrade attempt works.
    expect(
      screen.getByTestId('writing-feedback-make-default-confirm'),
    ).toBeEnabled();
  });

  it('discards a stale in-flight grade after revert + resubmit (request-sequence guard)', async () => {
    // Two hand-resolved grades: request 1 (answer A) deliberately resolves
    // AFTER request 2 (answer B). Answer A's verdict must not attach to B —
    // entry existence alone would let it, since B's pending entry re-creates
    // the slot A's discard guard relies on being empty.
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    gradeMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    renderCard();

    submitAnswer('respuesta equivocada A');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(1));

    // Revert while request 1 is still in flight, then submit a new answer.
    fireEvent.click(screen.getByLabelText('revertSubmission'));
    submitAnswer('respuesta equivocada B');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(2));

    // Request 2 (the current answer) resolves first: its verdict renders.
    await act(async () => {
      resolveSecond({
        verdict: 'minor',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    await waitFor(() =>
      expect(screen.getByText('verdict.minor')).toBeInTheDocument(),
    );

    // Request 1 (the reverted answer) arrives late and must be discarded.
    await act(async () => {
      resolveFirst({
        verdict: 'wrong',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    expect(screen.getByText('verdict.minor')).toBeInTheDocument();
    expect(screen.queryByText('verdict.wrong')).not.toBeInTheDocument();
  });

  // Restart-card (Shift+R) reuses the SAME card, so the card-id half of the
  // staleness check can't discard anything — the reset must advance the
  // sequence numbers. Clearing them instead hands the next submission the
  // same sequence an in-flight request already holds, and the stale verdict
  // lands. Both halves of that failure get a test.
  function renderRestartableCard() {
    // `resetSignal` rides on the presentation object; everything else stays
    // identical across rerenders so only the restart effect fires, not the
    // card-change reset.
    const card = (resetSignal: number) => (
      <FullReviewCardContent
        presentation={makePresentation({
          cardId: CARD_ID,
          sourceText: 'I would like a coffee.',
          translations: TRANSLATIONS,
          resetSignal,
        })}
        targetAudioMode="never"
        aiFeedbackEnabled
        onAccuracyChange={vi.fn()}
      />
    );
    const view = render(card(1));
    return { restart: (nonce: number) => view.rerender(card(nonce)) };
  }

  it('discards an in-flight grade that resolves after a card restart', async () => {
    let resolveFirst!: (v: unknown) => void;
    gradeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { restart } = renderRestartableCard();

    submitAnswer('respuesta equivocada A');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      restart(2);
    });

    // The pre-restart request resolves against the freshly dealt card and
    // must vanish, not render feedback for an answer no longer on screen.
    await act(async () => {
      resolveFirst({
        verdict: 'wrong',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    expect(screen.queryByText('verdict.wrong')).not.toBeInTheDocument();
  });

  it('discards a stale in-flight grade after restart + resubmit', async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    gradeMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { restart } = renderRestartableCard();

    submitAnswer('respuesta equivocada A');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      restart(2);
    });
    submitAnswer('respuesta equivocada B');
    await waitFor(() => expect(gradeMock).toHaveBeenCalledTimes(2));

    // The pre-restart request arrives late: answer A's verdict must not
    // attach to answer B.
    await act(async () => {
      resolveFirst({
        verdict: 'wrong',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    expect(screen.queryByText('verdict.wrong')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond({
        verdict: 'minor',
        corrected: 'Quisiera un café.',
        notes: [],
        savedAlternative: false,
      });
    });
    await waitFor(() =>
      expect(screen.getByText('verdict.minor')).toBeInTheDocument(),
    );
  });
});
