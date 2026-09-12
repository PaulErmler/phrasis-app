'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { alignAnnotations } from '@/lib/wordAlignment';
import { InterlinearStack } from './InterlinearStack';

/**
 * The muted annotation lines under a sentence: romanization (Latin
 * transliteration), the hyperliteral word-for-word gloss, and/or IPA
 * transcription. One component so every card surface renders them identically
 * and new annotation kinds have a single place to land.
 *
 * Visibility is the AND of the per-course setting and the value existing:
 * `showRomanization` defaults ON (matching `courseSettings.showRomanization
 * ?? true` everywhere), `showIpa` defaults OFF (`?? false`). The empty-string
 * "tried, failed" sentinel is filtered by the truthiness check.
 *
 * TAPPING THE LINES swaps them for the WORD MAPPING: the same annotations,
 * but each word its own column with its annotations stacked beneath
 * (`InterlinearStack`). Tapping again swaps back. It replaces the lines rather
 * than appearing under them, so an annotation is on screen once, never twice.
 *
 * There is no separate control. The lines are the control, which is why the
 * IPA line no longer plays the row's audio on tap: one target cannot mean two
 * things, and the speaker button beside the sentence already plays it.
 *
 * The lines are only tappable where they can actually be paired with the
 * words, which needs `language` and `text` — a caller that passes neither
 * keeps exactly the behaviour it had before the mapping existed.
 */
export interface AnnotationLinesProps {
  romanization?: string;
  /**
   * Word-for-word gloss in the learner's own language, keeping the sentence's
   * order ("To-me pleases to-walk around city in-evening"). Sits between
   * romanization and IPA: it reads as words, so it belongs next to the text
   * rather than below the phonetics.
   */
  hyperliteral?: string;
  /**
   * The gloss as per-word pairs. Supersedes the recovered split, and is the
   * only way a language written without spaces can show its mapping.
   */
  hyperliteralPairs?: readonly { source: string; gloss: string }[];
  ipa?: string;
  showRomanization?: boolean;
  showHyperliteral?: boolean;
  showIpa?: boolean;
  /**
   * The sentence these lines annotate, and its language. Supplied together;
   * without both, the lines are not tappable because they cannot be paired
   * with anything.
   */
  text?: string;
  language?: string;
  /**
   * False while the row is blurred, so a tap keeps revealing the card instead
   * of swapping to the mapping underneath the blur.
   */
  interactive?: boolean;
  /** Extra classes per line (blur/transition treatment from the card). */
  className?: string;
}

export function AnnotationLines({
  romanization,
  hyperliteral,
  hyperliteralPairs,
  ipa,
  showRomanization = true,
  showHyperliteral = false,
  showIpa = false,
  text,
  language,
  interactive = true,
  className,
}: AnnotationLinesProps) {
  const t = useTranslations('LearningMode');
  const [showMapping, setShowMapping] = useState(false);
  const suffix = className ? ` ${className}` : '';

  // Only the lines the course actually shows are worth pairing: swapping to
  // the mapping must not reveal a line the learner has switched off.
  const aligned = useMemo(
    () =>
      text === undefined || language === undefined
        ? null
        : alignAnnotations({
            text,
            language,
            romanization: showRomanization ? romanization : undefined,
            hyperliteral: showHyperliteral ? hyperliteral : undefined,
            hyperliteralPairs: showHyperliteral ? hyperliteralPairs : undefined,
            ipa: showIpa ? ipa : undefined,
          }),
    [
      text,
      language,
      romanization,
      hyperliteral,
      hyperliteralPairs,
      ipa,
      showRomanization,
      showHyperliteral,
      showIpa,
    ],
  );

  // `span`s rather than `p`s: when the lines are tappable they live inside a
  // button, and a button may only contain phrasing content.
  const lines = (
    <>
      {showRomanization && romanization && (
        <span className={`text-romanization block${suffix}`}>
          {romanization}
        </span>
      )}
      {showHyperliteral && hyperliteral && (
        <span
          className={`text-hyperliteral block${suffix}`}
          data-testid="hyperliteral-line"
        >
          {hyperliteral}
        </span>
      )}
      {showIpa && ipa && (
        <span className={`text-ipa block${suffix}`} data-testid="ipa-line">
          /{ipa}/
        </span>
      )}
    </>
  );

  if (aligned === null || !interactive) return lines;

  return (
    <button
      type="button"
      // `aria-pressed`, not `aria-expanded`: this swaps one view for another
      // rather than revealing extra content below.
      aria-pressed={showMapping}
      aria-label={t('wordMapping')}
      title={t('wordMapping')}
      data-testid="word-mapping-toggle"
      onClick={() => setShowMapping((on) => !on)}
      className="block w-full cursor-pointer text-left"
    >
      {showMapping ? (
        <InterlinearStack
          words={aligned}
          showRomanization={showRomanization}
          showHyperliteral={showHyperliteral}
          showIpa={showIpa}
        />
      ) : (
        lines
      )}
    </button>
  );
}
