import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightedText } from '@/components/app/learning/HighlightedText';
import type { WordTiming } from '@/components/app/learning/types';

const timings = (text: string, step = 0.5): WordTiming[] =>
  text.split(' ').map((word, i) => ({
    word,
    start: i * step,
    end: i * step + step,
  }));

describe('HighlightedText', () => {
  it('renders plain text when enabled is false', () => {
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        language="es"
        wordTimings={timings('hola mundo')}
        localTime={0.25}
        isActive={true}
        enabled={false}
      />,
    );
    expect(screen.getByText('hola mundo')).toBeInTheDocument();
    // No per-word spans rendered.
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('renders per-word spans when canHighlight even if not active', () => {
    // Single render path: idle render is per-word spans (with no current
    // index) so the DOM structure stays identical when isActive flips true.
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        language="es"
        wordTimings={timings('hola mundo')}
        localTime={0.25}
        isActive={false}
        enabled={true}
      />,
    );
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(2);
    expect(
      Array.from(spans).some((s) => s.className.includes('text-primary')),
    ).toBe(false);
  });

  it('renders plain text when wordTimings is null', () => {
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        language="es"
        wordTimings={null}
        localTime={0.25}
        isActive={true}
        enabled={true}
      />,
    );
    expect(screen.getByText('hola mundo')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('renders one span per token when active+enabled+timings present', () => {
    const { container } = render(
      <HighlightedText
        text="hola mundo bonito"
        language="es"
        wordTimings={timings('hola mundo bonito')}
        localTime={0}
        isActive={true}
        enabled={true}
      />,
    );
    expect(container.querySelectorAll('span')).toHaveLength(3);
  });

  it('only the current word gets the primary class; past/future render as default', () => {
    // timings: hola=[0,0.5], mundo=[0.5,1.0], bonito=[1.0,1.5]
    // At localTime=0.7 the current word is "mundo".
    const { container } = render(
      <HighlightedText
        text="hola mundo bonito"
        language="es"
        wordTimings={timings('hola mundo bonito')}
        localTime={0.7}
        isActive={true}
        enabled={true}
      />,
    );
    const spans = container.querySelectorAll('span');
    expect(spans[0].className).not.toContain('text-primary');
    expect(spans[0].className).not.toContain('text-foreground');
    expect(spans[1].className).toContain('text-primary');
    expect(spans[2].className).not.toContain('text-primary');
    expect(spans[2].className).not.toContain('text-foreground');
  });

  it('reuses the same span elements when localTime advances within the same word', () => {
    // Two ticks that both map to currentIndex=1 ("mundo") must produce the
    // exact same DOM nodes. That's what proves the per-frame reconciliation
    // is gated on currentIndex, not localTime, which is the flicker fix.
    const props = {
      text: 'hola mundo bonito',
      language: 'es',
      wordTimings: timings('hola mundo bonito'),
      isActive: true,
      enabled: true,
    } as const;
    const { container, rerender } = render(
      <HighlightedText {...props} localTime={0.6} />,
    );
    const before = Array.from(container.querySelectorAll('span'));
    rerender(<HighlightedText {...props} localTime={0.9} />);
    const after = Array.from(container.querySelectorAll('span'));
    expect(after).toHaveLength(before.length);
    after.forEach((span, i) => {
      expect(span).toBe(before[i]);
      expect(span.className).toBe(before[i].className);
    });
  });

  it('renders the same DOM after isActive flips false as before play started', () => {
    const props = {
      text: 'hola mundo bonito',
      language: 'es',
      wordTimings: timings('hola mundo bonito'),
      enabled: true,
      localTime: 0,
    } as const;
    const { container, rerender } = render(
      <HighlightedText {...props} isActive={false} />,
    );
    const beforePlay = container.innerHTML;
    rerender(<HighlightedText {...props} localTime={0.7} isActive={true} />);
    rerender(<HighlightedText {...props} isActive={false} />);
    expect(container.innerHTML).toBe(beforePlay);
  });

  it("clears the highlight once localTime passes the last word's end", () => {
    // For the LAST word, the active window stops at its own end (not the next
    // word's start), so once playback runs past that the highlight clears.
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        language="es"
        wordTimings={timings('hola mundo')}
        localTime={5}
        isActive={true}
        enabled={true}
      />,
    );
    const spans = container.querySelectorAll('span');
    // No span should carry the current-word class.
    expect(
      Array.from(spans).some((s) => s.className.includes('text-primary')),
    ).toBe(false);
  });

  it('renders no current highlight when localTime precedes the first word', () => {
    const wordTimings: WordTiming[] = [
      { word: 'hola', start: 0.5, end: 1.0 },
      { word: 'mundo', start: 1.0, end: 1.5 },
    ];
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        language="es"
        wordTimings={wordTimings}
        localTime={0}
        isActive={true}
        enabled={true}
      />,
    );
    const spans = container.querySelectorAll('span');
    expect(
      Array.from(spans).some((s) => s.className.includes('text-primary')),
    ).toBe(false);
  });

  it('falls back to plain text when alignment match ratio is below threshold', () => {
    // Source text shares zero tokens with the scribe transcription, so
    // matchRatio(aligned) === 0 < MIN_MATCH_RATIO. canHighlight is false →
    // plain text is rendered instead of per-word spans.
    const { container } = render(
      <HighlightedText
        text="alpha beta gamma"
        language="en"
        wordTimings={[
          { word: 'foo', start: 0, end: 0.5 },
          { word: 'bar', start: 0.5, end: 1.0 },
          { word: 'baz', start: 1.0, end: 1.5 },
        ]}
        localTime={0.25}
        isActive={true}
        enabled={true}
      />,
    );
    expect(screen.getByText('alpha beta gamma')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  describe('highlightTerm (search-word orange)', () => {
    const sentence = 'i am very happy to be here';
    const sentenceTimings = timings(sentence);

    it('applies accent-orange to the aligned token matching highlightTerm when idle', () => {
      const { container } = render(
        <HighlightedText
          text={sentence}
          language="en"
          wordTimings={sentenceTimings}
          localTime={0}
          isActive={false}
          enabled={true}
          highlightTerm="happy"
        />,
      );
      const spans = container.querySelectorAll('span');
      const happyIndex = sentence.split(' ').indexOf('happy');
      expect((spans[happyIndex] as HTMLElement).style.color).toBe(
        'var(--accent-orange)',
      );
      // No other span has an inline color.
      Array.from(spans).forEach((s, i) => {
        if (i !== happyIndex) {
          expect((s as HTMLElement).style.color).toBe('');
        }
      });
    });

    it('blue wins over orange when the highlighted word is the current word', () => {
      // happy starts at index 3 → start=1.5, end=2.0. Pick localTime mid-word.
      const { container } = render(
        <HighlightedText
          text={sentence}
          language="en"
          wordTimings={sentenceTimings}
          localTime={1.7}
          isActive={true}
          enabled={true}
          highlightTerm="happy"
        />,
      );
      const spans = container.querySelectorAll('span');
      const happyIndex = sentence.split(' ').indexOf('happy');
      const happySpan = spans[happyIndex] as HTMLElement;
      expect(happySpan.className).toContain('text-primary');
      // Inline color is suppressed so text-primary's class-based color wins.
      expect(happySpan.style.color).toBe('');
    });

    it('orange resumes after the playhead passes the highlighted word', () => {
      // localTime past happy's window → currentIndex moves on, orange returns.
      const { container } = render(
        <HighlightedText
          text={sentence}
          language="en"
          wordTimings={sentenceTimings}
          localTime={2.7}
          isActive={true}
          enabled={true}
          highlightTerm="happy"
        />,
      );
      const spans = container.querySelectorAll('span');
      const happyIndex = sentence.split(' ').indexOf('happy');
      const happySpan = spans[happyIndex] as HTMLElement;
      expect(happySpan.className).not.toContain('text-primary');
      expect(happySpan.style.color).toBe('var(--accent-orange)');
    });

    it('matches case-insensitively and tolerates trailing punctuation', () => {
      const text = 'I am very Happy, to be here';
      const t = text.split(' ').map((word, i) => ({
        word,
        start: i * 0.5,
        end: i * 0.5 + 0.5,
      }));
      const { container } = render(
        <HighlightedText
          text={text}
          language="en"
          wordTimings={t}
          localTime={0}
          isActive={false}
          enabled={true}
          highlightTerm="happy"
        />,
      );
      const spans = container.querySelectorAll('span');
      const happyIndex = text.split(' ').indexOf('Happy,');
      expect((spans[happyIndex] as HTMLElement).style.color).toBe(
        'var(--accent-orange)',
      );
    });

    it('marks every occurrence when the search word appears multiple times', () => {
      const text = 'happy days are happy times';
      const t = text.split(' ').map((word, i) => ({
        word,
        start: i * 0.5,
        end: i * 0.5 + 0.5,
      }));
      const { container } = render(
        <HighlightedText
          text={text}
          language="en"
          wordTimings={t}
          localTime={0}
          isActive={false}
          enabled={true}
          highlightTerm="happy"
        />,
      );
      const spans = container.querySelectorAll('span');
      const oranges = Array.from(spans).filter(
        (s) => (s as HTMLElement).style.color === 'var(--accent-orange)',
      );
      expect(oranges).toHaveLength(2);
    });

    it('renders no orange when highlightTerm is undefined', () => {
      const { container } = render(
        <HighlightedText
          text={sentence}
          language="en"
          wordTimings={sentenceTimings}
          localTime={0}
          isActive={false}
          enabled={true}
        />,
      );
      const spans = container.querySelectorAll('span');
      Array.from(spans).forEach((s) => {
        expect((s as HTMLElement).style.color).toBe('');
      });
    });

    it('preserves DOM identity across an isActive flip when highlightTerm is set', () => {
      // Regression guard: the bug was that the orange word disappeared (and
      // the first word briefly flashed) when audio started, because the
      // component swapped its render tree from a fallback subtree to per-word
      // spans. With highlightTerm the spans must be the same DOM nodes
      // before and after the flip, only their class/style change.
      const props = {
        text: sentence,
        language: 'en',
        wordTimings: sentenceTimings,
        enabled: true,
        highlightTerm: 'happy',
      } as const;
      const { container, rerender } = render(
        <HighlightedText {...props} localTime={0} isActive={false} />,
      );
      const before = Array.from(container.querySelectorAll('span'));
      rerender(<HighlightedText {...props} localTime={0.1} isActive={true} />);
      const after = Array.from(container.querySelectorAll('span'));
      expect(after).toHaveLength(before.length);
      after.forEach((span, i) => {
        expect(span).toBe(before[i]);
      });
    });

    it('uses the highlightWord helper when canHighlight is false but highlightTerm is set', () => {
      // Low matchRatio → canHighlight is false. Without a highlightTerm we'd
      // render plain text; with one we still want the orange to show via the
      // standalone highlightWord helper.
      const { container } = render(
        <HighlightedText
          text="alpha happy gamma"
          language="en"
          wordTimings={[
            { word: 'foo', start: 0, end: 0.5 },
            { word: 'bar', start: 0.5, end: 1.0 },
            { word: 'baz', start: 1.0, end: 1.5 },
          ]}
          localTime={0.25}
          isActive={true}
          enabled={true}
          highlightTerm="happy"
        />,
      );
      const orangeSpans = Array.from(container.querySelectorAll('span')).filter(
        (s) => (s as HTMLElement).style.color === 'var(--accent-orange)',
      );
      expect(orangeSpans).toHaveLength(1);
      expect(orangeSpans[0].textContent).toBe('happy');
    });
  });
});
