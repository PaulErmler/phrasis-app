import type { AlignedWord } from '@/lib/wordAlignment';

/**
 * The word-by-word mapping under a sentence: each word its own narrow column
 * with its annotations stacked beneath, wrapping at the edge like text.
 *
 * Laid out this way rather than as a table of rows because the sentence's WORD
 * ORDER is the thing a hyperliteral gloss exists to show, and a table of rows
 * throws it away. Columns keep the sentence readable left to right while still
 * pairing each word with what it became.
 *
 * A column shows only the aids that actually aligned (see
 * `alignAnnotations`), so a line whose unit count disagreed with the sentence
 * is simply absent rather than pairing the wrong words.
 *
 * Shown INSTEAD of the flat annotation lines, not under them: the two carry
 * the same content, and printing an annotation twice makes the card longer
 * while saying nothing new.
 */
export interface InterlinearStackProps {
  words: AlignedWord[];
  /** Which lines the course shows; an aid that is off here stays off here. */
  showRomanization?: boolean;
  showHyperliteral?: boolean;
  showIpa?: boolean;
}

export function InterlinearStack({
  words,
  showRomanization = true,
  showHyperliteral = false,
  showIpa = false,
}: InterlinearStackProps) {
  return (
    <div
      className="mt-0.5 flex flex-wrap gap-x-3.5 gap-y-1"
      data-testid="interlinear-stack"
    >
      {words.map((word, i) => (
        <div
          // Index, not the word: a sentence can repeat a word, and the two
          // columns are different positions with different glosses.
          key={i}
          className="flex flex-col gap-px rounded-md px-1 py-0.5"
        >
          {/* Same type as every other row in the column: the stack reads as
              one block, and a larger first row made each column look like a
              heading with captions under it. Colour alone separates the word
              from what it became. */}
          <span className="text-xs leading-tight">{word.source}</span>
          {showRomanization && word.romanization && (
            <span className="text-xs leading-tight text-muted-foreground">
              {word.romanization}
            </span>
          )}
          {showHyperliteral && word.hyperliteral && (
            <span className="text-xs leading-tight text-muted-foreground/75">
              {word.hyperliteral}
            </span>
          )}
          {showIpa && word.ipa && (
            <span className="text-xs leading-tight text-muted-foreground/75">
              {word.ipa}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
