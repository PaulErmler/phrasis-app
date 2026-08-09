'use client';

import { useMemo } from 'react';
import {
  alignWords,
  charDiff,
  scoreWordAlignment,
  getCompareConfig,
  toDiffOptions,
  type AlignedWord,
  type CharChunk,
} from '@/lib/textCompare';
import { AskAboutWord } from './ClickableWords';
import { AccuracyFooter, CleanRevealedSentence } from './CleanRevealedSentence';
import { getTextDirection } from '@/lib/languages';
import { cn } from '@/lib/utils';

interface WordDiffProps {
  expected: string;
  actual: string;
  language: string;
  hideAccuracy?: boolean;
  /** Drop the accuracy footer entirely (no invisible height-keeper) — for
   * embeds like the landing demo where the reserved line reads as dead space. */
  omitAccuracy?: boolean;
  hideErrors?: boolean;
  /** User setting — punctuation is still shown, just neutral and unscored. */
  ignorePunctuation?: boolean;
}

export function computeWordAccuracy(
  expected: string,
  actual: string,
  language: string,
  ignorePunctuation = false,
): number {
  const diffOpts = toDiffOptions(getCompareConfig(language, { ignorePunctuation }));
  const result = alignWords(expected, actual, diffOpts);
  return scoreWordAlignment(result, { ignorePunctuation });
}

interface AlignedSegment {
  correct: string;
  wrong: string | null;
  equal: boolean;
  /** Punctuation-only mismatch while ignoring punctuation — it didn't cost
   * accuracy, so it renders neutrally. A removed/added pair counts only when
   * both sides are punctuation: a scored insertion next to a forgiven mark
   * must still show as an error. */
  ignored?: boolean;
}

function buildSegments(chunks: CharChunk[]): AlignedSegment[] {
  const segments: AlignedSegment[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.kind === 'equal') {
      segments.push({ correct: c.text, wrong: null, equal: true });
    } else if (c.kind === 'removed') {
      const next = chunks[i + 1];
      if (next && next.kind === 'added') {
        segments.push({
          correct: c.text,
          wrong: next.text,
          equal: false,
          ignored: c.ignored && next.ignored,
        });
        i++;
      } else {
        segments.push({
          correct: c.text,
          wrong: '',
          equal: false,
          ignored: c.ignored,
        });
      }
    } else if (c.kind === 'added') {
      segments.push({
        correct: '',
        wrong: c.text,
        equal: false,
        ignored: c.ignored,
      });
    }
  }
  return segments;
}

function PunctChip({
  word,
  ignored = false,
}: {
  word: AlignedWord;
  ignored?: boolean;
}) {
  // -ml-1 cancels the parent's gap-x-1 so punctuation hugs the preceding word
  // like natural text.
  if (ignored) {
    // Punctuation isn't scored, so it must not be flagged either — no
    // red/green marks for something that can't cost the user anything.
    return (
      <span className="-ml-1 rounded-sm bg-muted text-muted-foreground px-1 py-0.5">
        {word.expected || word.actual}
      </span>
    );
  }
  if (word.tag === 'equal') {
    return (
      <span className="-ml-1 rounded-sm bg-success/15 text-success px-1 py-0.5">
        {word.actual}
      </span>
    );
  }
  if (word.tag === 'missing') {
    return (
      <span className="-ml-1 rounded-sm border border-dashed border-amber-500/60 text-amber-700 dark:text-amber-300 px-0.5 font-medium">
        {word.expected}
      </span>
    );
  }
  if (word.tag === 'extra') {
    return (
      <span className="-ml-1 rounded-sm bg-destructive/15 text-destructive px-0.5">
        {word.actual}
      </span>
    );
  }
  // 'wrong' (or 'typo' — punctuation never tags as typo, but be safe):
  // show expected at the baseline with the user's mark floated above in red.
  return (
    <span className="-ml-1 rounded-sm bg-destructive/10 text-destructive px-0.5 relative inline-block">
      <span
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 -top-2.5 text-[0.7rem] leading-none text-destructive whitespace-pre pointer-events-none font-medium"
      >
        {word.actual}
      </span>
      <span className="underline decoration-destructive/60 decoration-2 underline-offset-2">
        {word.expected}
      </span>
    </span>
  );
}

function WordChip({
  word,
  language,
  ignorePunctuation = false,
}: {
  word: AlignedWord;
  language: string;
  ignorePunctuation?: boolean;
}) {
  if (word.kind === 'punct') {
    return <PunctChip word={word} ignored={ignorePunctuation} />;
  }

  if (word.tag === 'equal') {
    return (
      <span className="rounded-sm bg-success/15 text-success px-1 py-0.5">
        {word.actual}
      </span>
    );
  }

  if (word.tag === 'extra') {
    return (
      <span className="rounded-sm bg-destructive/15 text-destructive line-through px-1 py-0.5">
        {word.actual}
      </span>
    );
  }

  if (word.tag === 'missing') {
    return (
      <span className="rounded-sm border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1 py-0.5 font-medium">
        {word.expected}
      </span>
    );
  }

  // typo or wrong: render expected word inline at baseline; for each diverging
  // character, float the user's incorrect characters above as a small annotation.
  const diffOpts = toDiffOptions(
    getCompareConfig(language, { ignorePunctuation }),
  );
  const { chunks } = charDiff(word.expected, word.actual, diffOpts);
  const segments = buildSegments(chunks);

  const wrapperClass =
    word.tag === 'typo'
      ? 'rounded-sm bg-amber-500/15 text-amber-800 dark:text-amber-200 px-1 py-0.5'
      : 'rounded-sm bg-destructive/10 text-destructive px-1 py-0.5';

  const underlineClass =
    word.tag === 'typo'
      ? 'underline decoration-amber-500/60 decoration-2 underline-offset-2'
      : 'underline decoration-destructive/60 decoration-2 underline-offset-2';

  return (
    <span className={wrapperClass}>
      {segments.map((s, i) => {
        // Unpaired extra char (user typed something that wasn't in the expected word).
        // Render inline as small strike-through so we don't leave an annotation floating
        // above empty space.
        if (s.correct === '' && s.wrong) {
          return (
            <span
              key={i}
              className={
                s.ignored
                  ? 'text-muted-foreground text-[0.75em]'
                  : 'text-destructive line-through text-[0.75em]'
              }
            >
              {s.wrong}
            </span>
          );
        }
        return (
          <span key={i} className="relative inline-block">
            {s.wrong !== null && s.wrong.length > 0 && !s.ignored && (
              <span
                aria-hidden
                className="absolute left-1/2 -translate-x-1/2 -top-2.5 text-[0.7rem] leading-none text-destructive line-through whitespace-pre pointer-events-none font-medium"
              >
                {s.wrong}
              </span>
            )}
            <span
              className={
                s.ignored ? 'text-muted-foreground' : s.equal ? '' : underlineClass
              }
            >
              {s.correct}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function WordDiff({
  expected,
  actual,
  language,
  hideAccuracy = false,
  omitAccuracy = false,
  hideErrors = false,
  ignorePunctuation = false,
}: WordDiffProps) {
  const diffOpts = useMemo(
    () => toDiffOptions(getCompareConfig(language, { ignorePunctuation })),
    [language, ignorePunctuation],
  );

  const { words, accuracy } = useMemo(() => {
    const result = alignWords(expected, actual, diffOpts);
    return {
      words: result.words,
      accuracy: Math.round(
        scoreWordAlignment(result, { ignorePunctuation }) * 100,
      ),
    };
  }, [expected, actual, diffOpts, ignorePunctuation]);

  const dir = getTextDirection(language);

  if (hideErrors) {
    return (
      <CleanRevealedSentence
        text={expected}
        language={language}
        accuracy={accuracy}
        hideAccuracy={hideAccuracy}
      />
    );
  }

  return (
    <div>
      {/* dir flips the flex main axis so RTL word chips lay out right-to-left
          in reading order; justify-end then packs the lines against the LEFT
          edge (main-axis end in RTL), keeping the block left-aligned like the
          rest of the layout. */}
      <p
        dir={dir}
        className={cn(
          'leading-relaxed flex flex-wrap items-baseline gap-x-1 gap-y-3 pt-3',
          dir === 'rtl' && 'justify-end',
        )}
      >
        {words.map((w, i) => (
          // Chips whose baseline shows a sentence word (equal / missing /
          // typo / wrong) get the ask-AI popover for it. `expected` is ''
          // exactly for `extra` chips (the user's stray word isn't part of
          // the sentence), and punctuation-only chips fall back to a plain
          // wrapper inside AskAboutWord.
          <AskAboutWord
            key={`${i}-${w.tag}-${w.expected ?? ''}-${w.actual ?? ''}`}
            word={w.expected}
            language={language}
          >
            <WordChip
              word={w}
              language={language}
              ignorePunctuation={ignorePunctuation}
            />
          </AskAboutWord>
        ))}
      </p>
      {!omitAccuracy && (
        <AccuracyFooter accuracy={accuracy} hideAccuracy={hideAccuracy} />
      )}
    </div>
  );
}
