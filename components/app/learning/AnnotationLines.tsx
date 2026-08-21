/**
 * The muted annotation lines under a sentence: romanization (Latin
 * transliteration) and/or IPA transcription. One component so every card
 * surface renders the pair identically and new annotation kinds have a
 * single place to land.
 *
 * Visibility is the AND of the per-course setting and the value existing:
 * `showRomanization` defaults ON (matching `courseSettings.showRomanization
 * ?? true` everywhere), `showIpa` defaults OFF (`?? false`). The empty-string
 * "tried, failed" sentinel is filtered by the truthiness check.
 */
export interface AnnotationLinesProps {
  romanization?: string;
  ipa?: string;
  showRomanization?: boolean;
  showIpa?: boolean;
  /** Extra classes per line (blur/transition treatment from the card). */
  className?: string;
}

export function AnnotationLines({
  romanization,
  ipa,
  showRomanization = true,
  showIpa = false,
  className,
}: AnnotationLinesProps) {
  const suffix = className ? ` ${className}` : '';
  return (
    <>
      {showRomanization && romanization && (
        <p className={`text-romanization${suffix}`}>{romanization}</p>
      )}
      {showIpa && ipa && (
        <p className={`text-ipa${suffix}`}>/{ipa}/</p>
      )}
    </>
  );
}
