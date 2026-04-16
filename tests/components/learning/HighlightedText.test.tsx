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

  it('renders plain text when isActive is false even with timings', () => {
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        wordTimings={timings('hola mundo')}
        localTime={0.25}
        isActive={false}
        enabled={true}
      />,
    );
    expect(screen.getByText('hola mundo')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('renders plain text when wordTimings is null', () => {
    const { container } = render(
      <HighlightedText
        text="hola mundo"
        wordTimings={null}
        localTime={0.25}
        isActive={true}
        enabled={true}
      />,
    );
    expect(screen.getByText('hola mundo')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('renders the fallback node in place of plain text when not highlighting', () => {
    render(
      <HighlightedText
        text="hola mundo"
        wordTimings={null}
        localTime={0}
        isActive={false}
        enabled={true}
        fallback={<em data-testid="fb">custom</em>}
      />,
    );
    expect(screen.getByTestId('fb')).toHaveTextContent('custom');
    expect(screen.queryByText('hola mundo')).not.toBeInTheDocument();
  });

  it('renders one span per token when active+enabled+timings present', () => {
    const { container } = render(
      <HighlightedText
        text="hola mundo bonito"
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
    // exact same DOM nodes — that's what proves the per-frame reconciliation
    // is gated on currentIndex, not localTime, which is the flicker fix.
    const props = {
      text: 'hola mundo bonito',
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

  it('clears the highlight once localTime passes the last word\'s end', () => {
    // For the LAST word, the active window stops at its own end (not the next
    // word's start), so once playback runs past that the highlight clears.
    const { container } = render(
      <HighlightedText
        text="hola mundo"
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
});
