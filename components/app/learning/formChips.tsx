'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { axisOf } from '@/lib/preferenceResolution';

/** One chip in the card header: what the served wording is on one axis. */
export interface FormChip {
  label: string;
  testId: string;
}

export type ChipTranslation = {
  language: string;
  isTargetLanguage: boolean;
  voiceGender?: 'male' | 'female';
};

export type FormChipKey = 'masculine' | 'feminine';

/** `LearningMode.formChips` translator: the two speaker words. */
export type FormChipTranslator = (key: FormChipKey) => string;

/**
 * The speaker chip for a card: the voice once, since a sentence has one
 * voice (the voice every language is spoken in, which the wording follows
 * in the languages that mark it).
 */
export function buildFormChips(
  translations: ChipTranslation[],
  t: FormChipTranslator,
): FormChip[] {
  // The chip reads "male speaker" / "female speaker" rather than
  // "masculine" / "feminine", so it never claims to describe grammar it is
  // not reading.
  const voice = translations.find((tr) => tr.voiceGender)?.voiceGender;
  if (!voice) return [];
  const gender = axisOf(voice);
  return [{ label: t(gender), testId: `form-chip-${gender}` }];
}

/**
 * The chips of one card, rendered the same way on every surface that shows a
 * card: the review card and the library (through `CardShell`), the
 * collection preview rows and the word-cloud sentence dialog. It owns the
 * `LearningMode.formChips` lookup and the badge styling, so a new card
 * surface needs neither.
 *
 * Renders nothing when the card's rows carry no voice, so a caller can drop
 * it into a header row unconditionally. With `className` the chips get their
 * own flex row (for the surfaces that put them under the sentences);
 * without it they are a bare fragment for an existing row.
 */
export function FormChips({
  translations,
  className,
}: {
  translations: ChipTranslation[];
  className?: string;
}) {
  const t = useTranslations('LearningMode.formChips');
  const chips = buildFormChips(translations, t);
  if (chips.length === 0) return null;
  const badges = chips.map((chip) => (
    <Badge
      key={chip.testId}
      variant="outline"
      className="text-xs font-normal text-muted-foreground"
      data-testid={chip.testId}
    >
      {chip.label}
    </Badge>
  ));
  if (!className) return <>{badges}</>;
  return <div className={cn('flex flex-wrap gap-1', className)}>{badges}</div>;
}
