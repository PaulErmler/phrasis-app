import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  DiffDisplay,
  computeAccuracy,
} from '@/components/app/learning/DiffDisplay';

/**
 * End-to-end coverage of the `ignorePunctuation` setting through the component
 * layer. `getCompareConfig` → word/char routing → score → rendering.
 *
 * `ja` matters most here: it has `hasWordBoundaries: false`, so it takes the
 * grapheme `charDiff` path rather than the word-alignment path that Latin
 * scripts use. A fix applied to only one of the two would pass half of these.
 */
describe('computeAccuracy: ignorePunctuation', () => {
  describe('word path (de: has word boundaries)', () => {
    it('penalizes a missing period by default', () => {
      expect(
        computeAccuracy('Das ist ein Test.', 'Das ist ein Test', 'de'),
      ).toBeLessThan(100);
    });

    it('ignores the missing period when the setting is on', () => {
      expect(
        computeAccuracy('Das ist ein Test.', 'Das ist ein Test', 'de', true),
      ).toBe(100);
    });

    it('still penalizes a wrong word when the setting is on', () => {
      expect(
        computeAccuracy('Das ist ein Test.', 'Das ist ein Buch', 'de', true),
      ).toBeLessThan(100);
    });
  });

  describe('char path (ja: no word boundaries)', () => {
    it('penalizes a missing 。 by default', () => {
      expect(
        computeAccuracy('今日は暑いですね。', '今日は暑いですね', 'ja'),
      ).toBeLessThan(100);
    });

    it('ignores the missing 。 when the setting is on', () => {
      expect(
        computeAccuracy('今日は暑いですね。', '今日は暑いですね', 'ja', true),
      ).toBe(100);
    });

    it('ignores 、 and 。 together', () => {
      expect(
        computeAccuracy('はい、そうです。', 'はいそうです', 'ja', true),
      ).toBe(100);
    });

    it('still penalizes a wrong character when the setting is on', () => {
      expect(
        computeAccuracy('今日は暑いですね。', '今日は寒いですね', 'ja', true),
      ).toBeLessThan(100);
    });
  });

  it('defaults to counting punctuation when the argument is omitted', () => {
    // The setting must be opt-in, existing courses keep today's scoring.
    expect(computeAccuracy('Hello, world!', 'Hello world', 'en')).toBeLessThan(
      100,
    );
  });
});

describe('DiffDisplay: ignorePunctuation rendering', () => {
  it('shows 100% for a missing Japanese full stop when enabled', () => {
    render(
      <DiffDisplay
        expected="今日は暑いですね。"
        actual="今日は暑いですね"
        language="ja"
        ignorePunctuation
      />,
    );
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('shows less than 100% for the same answer when disabled', () => {
    render(
      <DiffDisplay
        expected="今日は暑いですね。"
        actual="今日は暑いですね"
        language="ja"
      />,
    );
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it('still renders the ignored punctuation, but not as an error', () => {
    const { container } = render(
      <DiffDisplay
        expected="今日は暑いですね。"
        actual="今日は暑いですね"
        language="ja"
        ignorePunctuation
      />,
    );
    const mark = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '。',
    );
    expect(mark).toBeTruthy();
    // Muted, not destructive. It cost the user nothing, so it must not read
    // as a mistake.
    expect(mark?.className).toContain('text-muted-foreground');
    expect(mark?.className).not.toContain('destructive');
  });

  it('marks the punctuation as an error when the setting is off', () => {
    const { container } = render(
      <DiffDisplay
        expected="今日は暑いですね。"
        actual="今日は暑いですね"
        language="ja"
      />,
    );
    const mark = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '。',
    );
    expect(mark?.className).not.toContain('text-muted-foreground');
  });

  it('greys the punctuation chip on the word path too', () => {
    const { container } = render(
      <DiffDisplay
        expected="Das ist ein Test."
        actual="Das ist ein Test"
        language="de"
        ignorePunctuation
      />,
    );
    const mark = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '.',
    );
    expect(mark).toBeTruthy();
    expect(mark?.className).toContain('text-muted-foreground');
  });
});

describe('DiffDisplay: afterText', () => {
  function orderOf(haystack: string, needles: string[]): number[] {
    return needles.map((n) => haystack.indexOf(n));
  }

  it('renders romanization between the sentence and accuracy (char path)', () => {
    const { container } = render(
      <DiffDisplay
        expected="やあ、みんな。"
        actual="やあ"
        language="ja"
        afterText={<p>{"Yā, min'na."}</p>}
      />,
    );
    const text = container.textContent ?? '';
    const [sentence, romanization, accuracy] = orderOf(text, [
      'やあ',
      "Yā, min'na.",
      'accuracy',
    ]);
    expect(sentence).toBeGreaterThanOrEqual(0);
    expect(romanization).toBeGreaterThan(sentence);
    expect(accuracy).toBeGreaterThan(romanization);
  });

  it('renders romanization between the sentence and accuracy (word path)', () => {
    const { container } = render(
      <DiffDisplay
        expected="Das Wetter ist schön."
        actual="Das Wetter"
        language="de"
        afterText={<p>romanization-slot</p>}
      />,
    );
    const text = container.textContent ?? '';
    const [sentence, slot, accuracy] = orderOf(text, [
      'Wetter',
      'romanization-slot',
      'accuracy',
    ]);
    expect(sentence).toBeGreaterThanOrEqual(0);
    expect(slot).toBeGreaterThan(sentence);
    expect(accuracy).toBeGreaterThan(slot);
  });
});
