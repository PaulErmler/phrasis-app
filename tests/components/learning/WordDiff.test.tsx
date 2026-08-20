import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { WordDiff } from '@/components/app/learning/WordDiff';
import {
  alignWords,
  charDiff,
  getCompareConfig,
  toDiffOptions,
} from '@/lib/textCompare';

/**
 * Intra-word ignored-punctuation rendering in WordDiff's typo/wrong branch.
 *
 * When a word chip runs its per-character diff with `ignorePunctuation`,
 * punctuation-only chunks carry `ignored` and must render neutrally: muted,
 * no underline, no floated annotation, no strike-through. A removed/added
 * PAIR is forgiven only when BOTH sides are punctuation. A scored letter
 * paired with a forgiven mark must still read as an error.
 *
 * Each rendering test is preceded by a chunk-shape sanity check so a future
 * jsdiff/segmenter change that reshapes the chunks fails loudly here instead
 * of silently asserting against the wrong DOM.
 */

const optsIgnoring = toDiffOptions(
  getCompareConfig('en', { ignorePunctuation: true }),
);
const optsScoring = toDiffOptions(getCompareConfig('en'));

/** Innermost spans only. Wrapper spans repeat their child's textContent. */
function leafSpans(container: HTMLElement, text: string): HTMLElement[] {
  return Array.from(container.querySelectorAll('span')).filter(
    (el) => el.childElementCount === 0 && el.textContent === text,
  );
}

/** Floated user-typed annotations are the aria-hidden spans. */
function annotationTexts(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('span[aria-hidden]')).map(
    (el) => el.textContent,
  );
}

describe('WordDiff: intra-word ignored punctuation', () => {
  describe("removed apostrophe next to a real error (don't → dint)", () => {
    it('produces the expected alignment and chunk shape', () => {
      // Normalized dont vs dint is distance 1 → typo, so the chip takes the
      // per-character diff branch.
      const { words } = alignWords("don't", 'dint', optsIgnoring);
      expect(words).toHaveLength(1);
      expect(words[0].tag).toBe('typo');

      // Unpaired removed apostrophe is ignored; o→i is a real error pair.
      expect(charDiff("don't", 'dint', optsIgnoring).chunks).toEqual([
        { kind: 'equal', text: 'd' },
        { kind: 'removed', text: 'o' },
        { kind: 'added', text: 'i' },
        { kind: 'equal', text: 'n' },
        { kind: 'removed', text: "'", ignored: true },
        { kind: 'equal', text: 't' },
      ]);
    });

    it('renders the apostrophe muted, without underline or annotation', () => {
      const { container } = render(
        <WordDiff expected="don't" actual="dint" language="en" ignorePunctuation />,
      );
      const [apostrophe] = leafSpans(container, "'");
      expect(apostrophe).toBeTruthy();
      expect(apostrophe.className).toContain('text-muted-foreground');
      expect(apostrophe.className).not.toContain('underline');
      expect(apostrophe.className).not.toContain('line-through');
      // No user-typed character floats above the forgiven mark.
      expect(annotationTexts(container)).not.toContain("'");
    });

    it('still marks the real o→i error in the same word', () => {
      const { container } = render(
        <WordDiff expected="don't" actual="dint" language="en" ignorePunctuation />,
      );
      const [o] = leafSpans(container, 'o');
      expect(o).toBeTruthy();
      expect(o.className).toContain('underline');
      // The user's wrong character floats above it as an annotation.
      expect(annotationTexts(container)).toContain('i');
    });

    it('renders the apostrophe as a normal error when the setting is off', () => {
      // Without forgiveness the word is 2 edits off → wrong, same char branch.
      const { words } = alignWords("don't", 'dint', optsScoring);
      expect(words[0].tag).toBe('wrong');

      const { container } = render(
        <WordDiff expected="don't" actual="dint" language="en" />,
      );
      const [apostrophe] = leafSpans(container, "'");
      expect(apostrophe).toBeTruthy();
      expect(apostrophe.className).toContain('underline');
      expect(apostrophe.className).not.toContain('text-muted-foreground');
    });
  });

  describe("punctuation replaced by a scored letter (don't → donat)", () => {
    it('pairs the forgiven mark with a non-ignored added letter', () => {
      const { words } = alignWords("don't", 'donat', optsIgnoring);
      expect(words).toHaveLength(1);
      expect(words[0].tag).toBe('typo');

      // Only the removed side is punctuation. The added 'a' is scored, so
      // the pair must NOT be ignored.
      expect(charDiff("don't", 'donat', optsIgnoring).chunks).toEqual([
        { kind: 'equal', text: 'don' },
        { kind: 'removed', text: "'", ignored: true },
        { kind: 'added', text: 'a' },
        { kind: 'equal', text: 't' },
      ]);
    });

    it('still renders the pair as an error', () => {
      const { container } = render(
        <WordDiff expected="don't" actual="donat" language="en" ignorePunctuation />,
      );
      // The scored insertion sits where the forgiven mark was. Muting it
      // would hide a mistake that cost the user accuracy.
      const [apostrophe] = leafSpans(container, "'");
      expect(apostrophe).toBeTruthy();
      expect(apostrophe.className).toContain('underline');
      expect(apostrophe.className).not.toContain('text-muted-foreground');
      expect(annotationTexts(container)).toContain('a');
    });
  });

  describe("unpaired extra apostrophe in a wrong word (dont → din't)", () => {
    it('marks the standalone added apostrophe as ignored', () => {
      const { words } = alignWords('dont', "din't", optsIgnoring);
      expect(words).toHaveLength(1);
      expect(words[0].tag).toBe('typo');

      expect(charDiff('dont', "din't", optsIgnoring).chunks).toEqual([
        { kind: 'equal', text: 'd' },
        { kind: 'removed', text: 'o' },
        { kind: 'added', text: 'i' },
        { kind: 'equal', text: 'n' },
        { kind: 'added', text: "'", ignored: true },
        { kind: 'equal', text: 't' },
      ]);
    });

    it('renders the extra apostrophe muted, without strike-through', () => {
      const { container } = render(
        <WordDiff expected="dont" actual="din't" language="en" ignorePunctuation />,
      );
      const [apostrophe] = leafSpans(container, "'");
      expect(apostrophe).toBeTruthy();
      expect(apostrophe.className).toContain('text-muted-foreground');
      expect(apostrophe.className).not.toContain('line-through');
      // The real o→i error in the same word is still flagged.
      const [o] = leafSpans(container, 'o');
      expect(o.className).toContain('underline');
    });

    it('strikes the extra apostrophe through when the setting is off', () => {
      const { container } = render(
        <WordDiff expected="dont" actual="din't" language="en" />,
      );
      const [apostrophe] = leafSpans(container, "'");
      expect(apostrophe).toBeTruthy();
      expect(apostrophe.className).toContain('line-through');
      expect(apostrophe.className).not.toContain('text-muted-foreground');
    });
  });
});
