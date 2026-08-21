import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { highlightWord } from '@/lib/wordCloud';

function renderHighlighted(node: React.ReactNode) {
  return render(<p data-testid="root">{node}</p>);
}

const orangeColor = 'var(--accent-orange)';

describe('highlightWord', () => {
  it('highlights an English word when surrounded by spaces', () => {
    const { container } = renderHighlighted(
      highlightWord('I am very happy today', 'happy', 'en'),
    );
    const orange = container.querySelectorAll('span');
    expect(orange).toHaveLength(1);
    expect(orange[0].textContent).toBe('happy');
    expect((orange[0] as HTMLElement).style.color).toBe(orangeColor);
  });

  it('highlights multiple occurrences of the same word', () => {
    const { container } = renderHighlighted(
      highlightWord('happy days, more happy times', 'happy', 'en'),
    );
    const oranges = container.querySelectorAll('span');
    expect(oranges).toHaveLength(2);
    Array.from(oranges).forEach((s) => {
      expect(s.textContent).toBe('happy');
    });
  });

  it('matches case-insensitively', () => {
    const { container } = renderHighlighted(
      highlightWord('I am Happy today', 'happy', 'en'),
    );
    const oranges = container.querySelectorAll('span');
    expect(oranges).toHaveLength(1);
    expect(oranges[0].textContent).toBe('Happy');
  });

  it('does not match a partial substring of a larger word', () => {
    // "happy" must not match inside "happiness" or "unhappy". Intl.Segmenter
    // boundaries treat them as single word-like segments.
    const { container } = renderHighlighted(
      highlightWord('happiness is unhappy work', 'happy', 'en'),
    );
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('highlights a Chinese word mid-sentence (no whitespace boundary)', () => {
    // The original lookaround regex never matched here because surrounding
    // characters are letters; with Intl.Segmenter "zh" splits on Chinese word
    // boundaries so the match fires.
    const { container } = renderHighlighted(
      highlightWord('我今天很高兴见到你', '高兴', 'zh'),
    );
    const oranges = container.querySelectorAll('span');
    expect(oranges.length).toBeGreaterThanOrEqual(1);
    expect(oranges[0].textContent).toBe('高兴');
  });

  it('returns the input text unchanged when the word does not appear', () => {
    const { container } = renderHighlighted(
      highlightWord('hello world', 'goodbye', 'en'),
    );
    expect(container.querySelectorAll('span')).toHaveLength(0);
    expect(container.textContent).toBe('hello world');
  });

  it('falls back gracefully when the language tag is invalid', () => {
    // Should not throw; the fallback regex handles whitespace-delimited
    // languages so simple English still highlights.
    const { container } = renderHighlighted(
      highlightWord('I am very happy today', 'happy', '!!!not-a-locale!!!'),
    );
    expect(container.textContent).toBe('I am very happy today');
  });
});
