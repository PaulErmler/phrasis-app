import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ClickableWords } from '@/components/app/learning/ClickableWords';

// Provide a chat context so ClickableWords takes the interactive per-word
// path — the one that maps furigana chunks onto Intl.Segmenter tokens. The
// bare no-context path renders sentence-wide ruby and would leave the
// per-token mapping untested.
vi.mock('@/components/app/learning/LearningChatLayout', () => ({
  useLearningChatToggle: () => ({ openChatWithAction: vi.fn() }),
}));

/**
 * Ruby rendering inside ClickableWords: a valid furigana annotation renders
 * <ruby>/<rt> readings over the kanji runs, an annotation that no longer
 * matches the (edited) sentence falls back to plain text, and the readings
 * land inside the same clickable-word spans so the ask-AI popover keeps
 * working with furigana on. A mocked chat context routes rendering through
 * the interactive per-word path, where furigana chunks map onto word tokens.
 */

const TEXT = '毎朝七時に起きます。';
const FURIGANA = '毎朝[まいあさ]七時[しちじ]に起[お]きます。';

function renderWords(furigana?: string) {
  return render(
    <ClickableWords
      text={TEXT}
      language="ja"
      wordTimings={null}
      localTime={0}
      isActive={false}
      enabled={false}
      furigana={furigana}
    />,
  );
}

describe('ClickableWords: furigana', () => {
  it('renders ruby readings over kanji runs', () => {
    const { container } = renderWords(FURIGANA);
    const readings = [...container.querySelectorAll('ruby rt')].map(
      (rt) => rt.textContent,
    );
    expect(readings).toEqual(['まいあさ', 'しちじ', 'お']);
    // Kana runs stay bare, and the paragraph reserves reading headroom.
    expect(container.textContent).toContain('きます。');
    expect(container.querySelector('p')?.className).toContain('has-furigana');
  });

  it('falls back to plain text when the annotation is stale', () => {
    // Annotation generated for a different (pre-edit) sentence.
    const { container } = renderWords('毎晩[まいばん]寝[ね]ます。');
    expect(container.querySelectorAll('ruby')).toHaveLength(0);
    expect(container.textContent).toBe(TEXT);
    expect(container.querySelector('p')?.className).not.toContain(
      'has-furigana',
    );
  });

  it('renders plain when no annotation is provided', () => {
    const { container } = renderWords(undefined);
    expect(container.querySelectorAll('ruby')).toHaveLength(0);
    expect(container.textContent).toBe(TEXT);
  });

  it('never duplicates text when a ruby unit spans a word-segmenter boundary', () => {
    // Intl.Segmenter cuts 天気|予報 into two word tokens, but the analyzer
    // annotates the compound as ONE ruby unit. The unit renders whole inside
    // the first token; the second token's chunk is empty and must render
    // nothing — re-rendering its display would show 予報 twice.
    const { container } = render(
      <ClickableWords
        text="天気予報です。"
        language="ja"
        wordTimings={null}
        localTime={0}
        isActive={false}
        enabled={false}
        furigana="天気予報[てんきよほう]です。"
      />,
    );
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('rt').forEach((rt) => rt.remove());
    expect(clone.textContent).toBe('天気予報です。');
    expect(
      [...container.querySelectorAll('ruby rt')].map((rt) => rt.textContent),
    ).toEqual(['てんきよほう']);
  });

  it('keeps the full sentence intact with ruby on', () => {
    const { container } = renderWords(FURIGANA);
    // Strip the rt reading text; what remains must be exactly the sentence.
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('rt').forEach((rt) => rt.remove());
    expect(clone.textContent).toBe(TEXT);
  });
});
