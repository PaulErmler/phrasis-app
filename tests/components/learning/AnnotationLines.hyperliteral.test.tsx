import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnnotationLines } from '@/components/app/learning/AnnotationLines';
import { annotationLineProps } from '@/lib/annotationDisplay';

/**
 * The gloss line and the per-language resolution that feeds it. The two
 * behaviours worth pinning are that the `''` failure sentinel renders nothing
 * at all (not an empty line that shifts the card), and that one card can show
 * the line for one of its languages and not another.
 */

describe('AnnotationLines: the gloss line', () => {
  it('renders the gloss when the setting is on', () => {
    render(
      <AnnotationLines
        hyperliteral="To-me pleases to-walk around city in-evening."
        showHyperliteral
      />,
    );
    expect(screen.getByTestId('hyperliteral-line')).toHaveTextContent(
      'To-me pleases to-walk around city in-evening.',
    );
  });

  it('is off by default', () => {
    render(<AnnotationLines hyperliteral="I not know." />);
    expect(screen.queryByTestId('hyperliteral-line')).toBeNull();
  });

  it('renders nothing for the empty-string failure sentinel', () => {
    render(<AnnotationLines hyperliteral="" showHyperliteral />);
    expect(screen.queryByTestId('hyperliteral-line')).toBeNull();
  });

  it('sits between romanization and IPA', () => {
    const { container } = render(
      <AnnotationLines
        romanization="ya ne znayu"
        hyperliteral="I not know."
        ipa="ja nʲɪ ˈznaju"
        showRomanization
        showHyperliteral
        showIpa
      />,
    );
    const order = [...container.querySelectorAll('span[class^="text-"]')].map(
      (el) => el.className.split(' ')[0],
    );
    expect(order).toEqual([
      'text-romanization',
      'text-hyperliteral',
      'text-ipa',
    ]);
  });
});

describe('annotationLineProps', () => {
  it('lets one card show a line for one language and not another', () => {
    const byLanguage = {
      ja: {
        romanization: true,
        ipa: false,
        furigana: true,
        hyperliteral: true,
      },
      ko: {
        romanization: false,
        ipa: false,
        furigana: false,
        hyperliteral: true,
      },
    };
    expect(annotationLineProps(byLanguage, 'ja').showRomanization).toBe(true);
    expect(annotationLineProps(byLanguage, 'ko').showRomanization).toBe(false);
    expect(annotationLineProps(byLanguage, 'ko').showHyperliteral).toBe(true);
  });

  it('falls back to the course-wide booleans for a caller with no record', () => {
    expect(
      annotationLineProps(undefined, 'ja', {
        showRomanization: false,
        showIpa: true,
      }),
    ).toEqual({
      showRomanization: false,
      showIpa: true,
      showHyperliteral: false,
    });
  });
});
