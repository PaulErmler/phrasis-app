import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HighlightedText } from '@/components/app/learning/HighlightedText';

/**
 * Furigana in HighlightedText's plain branch — the branch every Japanese
 * sentence takes (ja has supportsKaraoke: false), and the render path of the
 * deck list, collection preview, and word-sentences dialog. Covers the ruby
 * render, the stale-annotation fallback, and composition with the word-cloud
 * highlightTerm (both ruby AND the orange word at once).
 */

const TEXT = '日本語を勉強しています。';
const FURIGANA = '日本語[にほんご]を勉強[べんきょう]しています。';

function renderText(props: { furigana?: string; highlightTerm?: string }) {
  return render(
    <HighlightedText
      text={TEXT}
      language="ja"
      wordTimings={null}
      localTime={0}
      isActive={false}
      enabled={false}
      {...props}
    />,
  );
}

describe('HighlightedText: furigana', () => {
  it('renders ruby readings over kanji runs', () => {
    const { container } = renderText({ furigana: FURIGANA });
    expect(
      [...container.querySelectorAll('ruby rt')].map((rt) =>
        rt.getAttribute('data-reading'),
      ),
    ).toEqual(['にほんご', 'べんきょう']);
    expect(container.querySelector('p')?.className).toContain('has-furigana');
  });

  it('falls back to plain text when the annotation is stale', () => {
    const { container } = renderText({ furigana: '古[ふる]い文。' });
    expect(container.querySelectorAll('ruby')).toHaveLength(0);
    expect(container.textContent).toBe(TEXT);
  });

  it('composes ruby with the highlight term', () => {
    const { container } = renderText({
      furigana: FURIGANA,
      highlightTerm: '勉強',
    });
    // The matched word is orange AND keeps its reading.
    const orange = [...container.querySelectorAll('span')].find((el) =>
      el.getAttribute('style')?.includes('--accent-orange'),
    );
    expect(orange).toBeDefined();
    expect(orange!.querySelector('rt')?.getAttribute('data-reading')).toBe(
      'べんきょう',
    );
    // The rest of the sentence keeps its ruby too.
    expect(
      [...container.querySelectorAll('ruby rt')].map((rt) =>
        rt.getAttribute('data-reading'),
      ),
    ).toEqual(['にほんご', 'べんきょう']);
    // Readings are attribute-painted, so the document text (= what copy
    // yields) is exactly the sentence.
    expect(container.textContent).toBe(TEXT);
  });

  it('keeps the plain highlight behavior when no furigana is given', () => {
    const { container } = renderText({ highlightTerm: '勉強' });
    expect(container.querySelectorAll('ruby')).toHaveLength(0);
    const orange = [...container.querySelectorAll('span')].find((el) =>
      el.getAttribute('style')?.includes('--accent-orange'),
    );
    expect(orange?.textContent).toBe('勉強');
  });
});
