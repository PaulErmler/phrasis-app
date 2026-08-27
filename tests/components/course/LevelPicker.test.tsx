import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * LevelPicker: the shared OGTE level picker (onboarding CEFR self-pick +
 * the difficulty-check dialog).
 *  - clampOgte / cefrForOgte: the 1..20 scale and its CEFR banding;
 *  - LevelSliderCard: the preselected level follows the prop (padded number,
 *    CEFR badge, slider position) and every slider move emits the picked
 *    level through onChange;
 *  - LevelSamplePreview: one corpus query for ALL levels (level switches
 *    re-render from memory), five slots that render loading rows, real
 *    sentences, or empty placeholders;
 *  - PreviewSentenceRows: at most five rows, target-language primary text
 *    with optional romanization, source-language fallback.
 */

// Radix Slider measures its thumb with ResizeObserver; jsdom ships none.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StubResizeObserver;
}

interface CorpusRow {
  level: number;
  position: number;
  sourceText: string;
  targetText?: string;
  targetRomanization?: string;
}

const harness = vi.hoisted(() => ({
  corpus: undefined as CorpusRow[] | undefined,
  corpusQueryArgs: [] as unknown[],
}));

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  type Ref = Parameters<typeof getFunctionName>[0];
  return {
    useQuery: (ref: unknown, args?: unknown) => {
      if (args === 'skip') return undefined;
      const name = getFunctionName(ref as Ref);
      if (name.includes('getPlacementPreviewSentences')) {
        harness.corpusQueryArgs.push(args);
        return harness.corpus;
      }
      throw new Error(`Unexpected query: ${name}`);
    },
  };
});

import {
  clampOgte,
  cefrForOgte,
  LevelSliderCard,
  LevelSamplePreview,
  PreviewSentenceRows,
} from '@/components/course/LevelPicker';
import { OGTE_MIN_LEVEL, OGTE_MAX_LEVEL } from '@/lib/constants/onboarding';

describe('clampOgte', () => {
  it('clamps to the 1..20 scale and rounds fractional levels', () => {
    expect(clampOgte(OGTE_MIN_LEVEL - 3)).toBe(OGTE_MIN_LEVEL);
    expect(clampOgte(OGTE_MAX_LEVEL + 3)).toBe(OGTE_MAX_LEVEL);
    expect(clampOgte(7)).toBe(7);
    expect(clampOgte(7.4)).toBe(7);
    expect(clampOgte(7.5)).toBe(8);
  });
});

describe('cefrForOgte', () => {
  it('maps every OGTE band to its CEFR label', () => {
    const expected: Array<[number, string]> = [
      [1, 'Pre-A1'],
      [2, 'A1'],
      [4, 'A1'],
      [5, 'A2'],
      [7, 'A2'],
      [8, 'B1'],
      [10, 'B1'],
      [11, 'B2'],
      [13, 'B2'],
      [14, 'C1'],
      [16, 'C1'],
      [17, 'C2'],
      [20, 'C2'],
    ];
    for (const [ogte, cefr] of expected) {
      expect(cefrForOgte(ogte)).toBe(cefr);
    }
  });
});

describe('LevelSliderCard', () => {
  it('shows the preselected level from the prop: padded number, CEFR badge, slider position', () => {
    const { rerender } = render(
      <LevelSliderCard ogte={5} onChange={() => {}} />,
    );
    // The CEFR label also appears in the tick row under the slider, so
    // assert the badge through the level number's container.
    expect(screen.getByText('05').parentElement).toHaveTextContent('A2');
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '5');
    expect(slider).toHaveAttribute('aria-valuemin', String(OGTE_MIN_LEVEL));
    expect(slider).toHaveAttribute('aria-valuemax', String(OGTE_MAX_LEVEL));

    // Controlled: the shown level follows the prop, not internal state.
    rerender(<LevelSliderCard ogte={12} onChange={() => {}} />);
    expect(screen.getByText('12').parentElement).toHaveTextContent('B2');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '12');
  });

  it('emits each slid level through onChange (one step per key, ends clamp)', () => {
    const onChange = vi.fn();
    render(<LevelSliderCard ogte={5} onChange={onChange} />);
    const slider = screen.getByRole('slider');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(OGTE_MAX_LEVEL);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(OGTE_MIN_LEVEL);
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe('LevelSamplePreview', () => {
  beforeEach(() => {
    harness.corpus = undefined;
    harness.corpusQueryArgs.length = 0;
  });

  function renderPreview(ogteLevel: number) {
    return render(
      <LevelSamplePreview
        ogteLevel={ogteLevel}
        sourceLanguage="en"
        targetLanguage="es"
      />,
    );
  }

  it('subscribes once to the whole corpus with the course languages', () => {
    renderPreview(5);
    expect(harness.corpusQueryArgs[0]).toEqual({
      targetLanguage: 'es',
      sourceLanguage: 'en',
    });
  });

  it('renders five loading rows while the corpus is in flight', () => {
    renderPreview(5);
    expect(screen.getAllByText('sampleLoading')).toHaveLength(5);
  });

  it('renders the slid level’s rows by position, empty placeholders for missing slots', () => {
    harness.corpus = [
      { level: 5, position: 0, sourceText: 'hello', targetText: 'hola' },
      { level: 5, position: 1, sourceText: 'bye', targetText: 'adiós' },
      { level: 6, position: 0, sourceText: 'other', targetText: 'otro' },
    ];
    renderPreview(5);
    expect(screen.getByText('hola')).toBeInTheDocument();
    expect(screen.getByText('adiós')).toBeInTheDocument();
    // Level 6 material stays off-screen at level 5.
    expect(screen.queryByText('otro')).not.toBeInTheDocument();
    // Five slots total: 2 filled + 3 empty.
    expect(screen.getAllByText('sampleEmpty')).toHaveLength(3);
    expect(screen.queryByText('sampleLoading')).not.toBeInTheDocument();
  });

  it('switching level re-renders from the in-memory corpus', () => {
    harness.corpus = [
      { level: 5, position: 0, sourceText: 'hello', targetText: 'hola' },
      { level: 6, position: 0, sourceText: 'other', targetText: 'otro' },
    ];
    const { rerender } = renderPreview(5);
    expect(screen.getByText('hola')).toBeInTheDocument();
    rerender(
      <LevelSamplePreview
        ogteLevel={6}
        sourceLanguage="en"
        targetLanguage="es"
      />,
    );
    expect(screen.getByText('otro')).toBeInTheDocument();
    expect(screen.queryByText('hola')).not.toBeInTheDocument();
  });
});

describe('PreviewSentenceRows', () => {
  function renderRows(
    rows:
      | Array<{
          sourceText: string;
          targetText?: string;
          targetRomanization?: string;
        }>
      | undefined,
    languages?: { source?: string; target?: string },
  ) {
    return render(
      <PreviewSentenceRows
        rows={rows}
        sourceLanguage={languages?.source ?? 'en'}
        targetLanguage={languages?.target ?? 'es'}
      />,
    );
  }

  it('renders five loading rows while the query is in flight', () => {
    renderRows(undefined);
    expect(screen.getAllByText('sampleLoading')).toHaveLength(5);
  });

  it('caps at five rows and never pads short lists with placeholders', () => {
    renderRows(
      Array.from({ length: 7 }, (_, i) => ({
        sourceText: `src ${i}`,
        targetText: `tgt ${i}`,
      })),
    );
    expect(screen.getByText('tgt 4')).toBeInTheDocument();
    expect(screen.queryByText('tgt 5')).not.toBeInTheDocument();

    renderRows([{ sourceText: 'only', targetText: 'solo' }]);
    expect(screen.queryByText('sampleEmpty')).not.toBeInTheDocument();
    expect(screen.queryByText('sampleLoading')).not.toBeInTheDocument();
  });

  it('shows target text with romanization when the languages differ', () => {
    renderRows([
      {
        sourceText: 'hello',
        targetText: 'こんにちは',
        targetRomanization: 'konnichiwa',
      },
    ]);
    expect(screen.getByText('こんにちは')).toBeInTheDocument();
    expect(screen.getByText('konnichiwa')).toBeInTheDocument();
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('falls back to the source text when the target is missing or the languages match', () => {
    // Translation still generating: no targetText yet.
    renderRows([{ sourceText: 'hello' }]);
    expect(screen.getByText('hello')).toBeInTheDocument();

    // Same language on both sides: primary is the source, romanization hidden.
    renderRows(
      [
        {
          sourceText: 'bonjour',
          targetText: 'bonjour-target',
          targetRomanization: 'never-shown',
        },
      ],
      { source: 'fr', target: 'fr' },
    );
    expect(screen.getByText('bonjour')).toBeInTheDocument();
    expect(screen.queryByText('bonjour-target')).not.toBeInTheDocument();
    expect(screen.queryByText('never-shown')).not.toBeInTheDocument();
  });
});
