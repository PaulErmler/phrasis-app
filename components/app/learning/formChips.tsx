'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  distinctPolitenessForms,
  politenessFormForLevel,
  type PolitenessLevel,
} from '@/lib/languageForms';
import { getLanguageShortLabel, languageName } from '@/lib/languages';
import { axisOf } from '@/lib/preferenceResolution';

/** One chip in the card header: what the served wording is on one axis. */
export interface FormChip {
  label: string;
  /** Longer name for the title attribute (language, level and form). */
  title?: string;
  testId: string;
}

export type ChipTranslation = {
  language: string;
  isTargetLanguage: boolean;
  voiceGender?: 'male' | 'female';
  renderedGender?: 'masculine' | 'feminine';
  renderedPoliteness?: PolitenessLevel;
};

export type FormChipKey =
  | 'masculine'
  | 'feminine'
  | 'casual'
  | 'polite'
  | 'formal';

/** `LearningMode.formChips` translator: the five words plus the title. */
export type FormChipTranslator = {
  (key: FormChipKey): string;
  (
    key: 'politenessTitle',
    values: { language: string; level: string; form: string },
  ): string;
};

/**
 * How the politeness chip is worded. 'generic' (2026-09-08, Paul): every
 * two-form language reads "casual" or "formal", and only the languages in
 * `OWN_NAME_LANGUAGES` name their form (plain form / です・ます / keigo,
 * 반말 / 해요체 / 합쇼체). 'own-name' is the earlier wording, kept so it
 * can be switched back: a two-form language showed its own form (tu, Sie)
 * and a three-form language the level word.
 */
const CHIP_WORDING: 'generic' | 'own-name' = 'generic';

/** Languages whose chip names the form itself under 'generic'. */
const OWN_NAME_LANGUAGES = new Set(['ja', 'ko']);

/**
 * A form name longer than this reads as a sentence on a chip (pt_pt
 * "o senhor / a senhora", ro "dumneavoastră"); under 'own-name' the chip
 * shows the level word instead and keeps the name in the title.
 */
const MAX_CHIP_NAME_LENGTH = 14;

/**
 * The chip word for one language's rendered level: the form's own name for
 * Japanese and Korean, else "casual" for the form the casual level maps to
 * and "formal" for the other one (a two-form language has exactly those
 * two, whatever the global level that reached it was called).
 */
function politenessChipLabel(
  language: string,
  level: PolitenessLevel,
  t: FormChipTranslator,
): string {
  const form = politenessFormForLevel(language, level);
  if (!form) return t(level);
  if (CHIP_WORDING === 'own-name') {
    return distinctPolitenessForms(language).length < 3 &&
      form.name.length <= MAX_CHIP_NAME_LENGTH
      ? form.name
      : t(level);
  }
  if (OWN_NAME_LANGUAGES.has(language)) return form.name;
  const casual = politenessFormForLevel(language, 'casual');
  return t(casual && casual.id === form.id ? 'casual' : 'formal');
}

/**
 * The sentence-form chips for a card (docs/architecture/translation-
 * variants.md): the gender once, since it is one per card (the voice every
 * language is spoken in, which the wording follows), and the politeness
 * form per target language, prefixed with the language when two targets
 * disagree. A pre-feature card shows what its row IS (from the lazy
 * classifier stamps), not the course setting; an unmarked or unstamped
 * politeness row shows nothing.
 */
export function buildFormChips(
  translations: ChipTranslation[],
  t: FormChipTranslator,
): FormChip[] {
  const targets = translations.filter((tr) => tr.isTargetLanguage);
  const chips: FormChip[] = [];
  const voice = translations.find((tr) => tr.voiceGender)?.voiceGender;
  const gender = voice
    ? axisOf(voice)
    : targets.find((tr) => tr.renderedGender)?.renderedGender;
  if (gender) {
    chips.push({ label: t(gender), testId: `form-chip-${gender}` });
  }
  const polite = targets.filter((tr) => tr.renderedPoliteness);
  const disagree =
    new Set(
      polite.map((tr) =>
        politenessChipLabel(tr.language, tr.renderedPoliteness!, t),
      ),
    ).size > 1;
  for (const tr of polite) {
    const level = tr.renderedPoliteness!;
    const form = politenessFormForLevel(tr.language, level);
    const base = politenessChipLabel(tr.language, level, t);
    chips.push({
      label: disagree ? `${getLanguageShortLabel(tr.language)} ${base}` : base,
      title: form
        ? t('politenessTitle', {
            language: languageName(tr.language),
            level: t(level),
            form: form.name,
          })
        : undefined,
      testId: `form-chip-${tr.language}-${level}`,
    });
  }
  return chips;
}

/**
 * The chips of one card, rendered the same way on every surface that shows a
 * card: the review card and the library (through `CardShell`), the
 * collection preview rows and the word-cloud sentence dialog. It owns the
 * `LearningMode.formChips` lookup and the badge styling, so a new card
 * surface needs neither.
 *
 * Renders nothing when the card's rows carry neither a voice nor a marked,
 * stamped politeness axis, so a caller can drop it into a header row
 * unconditionally. With `className` the chips get their own flex row (for
 * the surfaces that put them under the sentences); without it they are a
 * bare fragment for an existing row.
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
      title={chip.title}
      data-testid={chip.testId}
    >
      {chip.label}
    </Badge>
  ));
  if (!className) return <>{badges}</>;
  return <div className={cn('flex flex-wrap gap-1', className)}>{badges}</div>;
}
